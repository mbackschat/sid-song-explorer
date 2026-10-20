import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertCandidate, assertUnitResults, reconcileBrowserCoverage, runStage} from '../scripts/release-check.ts';

test('release evidence rejects dirty or changed candidates', () => {
  assert.doesNotThrow(() => assertCandidate({commit:'a', status:''}, {commit:'a', status:''}));
  assert.throws(() => assertCandidate({commit:'a', status:' M src/ui.ts'}, {commit:'a', status:''}), /clean/);
  assert.throws(() => assertCandidate({commit:'a', status:''}, {commit:'b', status:''}), /changed/);
  assert.throws(() => assertCandidate({commit:'a', status:''}, {commit:'a', status:'?? new.ts'}), /clean/);
});

test('unit evidence requires completed passing native results without skips or todos', () => {
  const result = '# tests 12\n# pass 12\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  assert.equal(assertUnitResults(result), 12);
  for (const bad of ['', result.replace('# fail 0', '# fail 1'), result.replace('# skipped 0', '# skipped 1'), result.replace('# todo 0', '# todo 1'), result.replace('# pass 12', '# pass 11')]) {
    assert.throws(() => assertUnitResults(bad));
  }
});

test('browser coverage rejects missing shards, duplicate tests, changed candidates and skipped execution', () => {
  const reports = ['one', 'two'].map((id, index) => ({
    schemaVersion:1, platform:process.platform, project:'chrome', shard:{current:index + 1,total:2},
    commit:'a', artifactDigest:'d', status:'passed', errors:[], browsers:[{project:'chrome',version:'123'}],
    discovered:[{id,project:'chrome',file:'tests/browser/example.spec.ts',titlePath:[],expectedStatus:'passed',annotations:[]}],
    results:[{id,project:'chrome',status:'passed',expectedStatus:'passed',retry:0,annotations:[{type:'browser-version',description:'123'}]}],
  }));
  const inventory = new Map([['chrome', ['one', 'two']]]);
  const check = (values: unknown[]) => reconcileBrowserCoverage(values, inventory, {commit:'a',digest:'d'}, 2);
  assert.doesNotThrow(() => check(reports));
  assert.throws(() => check(reports.slice(1)), /shard/);
  assert.throws(() => check([reports[0], {...reports[1],discovered:[{id:'one'}]}]), /inventory|duplicate/);
  assert.throws(() => check([reports[0], {...reports[1],commit:'b'}]), /candidate/);
  assert.throws(() => check([reports[0], {...reports[1],results:[]}]), /execution/);
  assert.throws(() => check([reports[0], {...reports[1],status:'failed'}]), /failed/);
  assert.throws(() => check([...reports, reports[0]]), /shard/);
  assert.throws(() => check([reports[0], {...reports[1],results:[{...reports[1]!.results[0],status:'skipped'}]}]), /execution/);
  assert.throws(() => check([reports[0], {...reports[1],errors:['global setup failed']}]), /errors/);
  assert.throws(() => check([reports[0], {...reports[1],browsers:[]}]), /version/);
  assert.throws(() => check([reports[0], {...reports[1],platform:'win32'}]), /platform/);
});

test('interruption rejects even a zero exit and reaps detached descendants used by browser launchers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-release-interrupt-'));
  let pid: number | undefined;
  try {
    const log = join(directory, 'command.log');
    const script = `
      const {spawn} = require('node:child_process');
      process.on('SIGTERM', () => process.exit(0));
      const child = spawn(process.execPath, ['-e',
        'process.on("SIGTERM", () => {}); process.send("ready"); setInterval(() => {}, 1000);'],
        {detached:true,stdio:['ignore','ignore','ignore','ipc']});
      child.on('message', () => console.log(child.pid));
    `;
    const result = runStage('interrupted', process.execPath, ['-e', script], 3000, log);
    const rejected = assert.rejects(result, /interrupted/);
    const deadline = Date.now() + 2000;
    while (!pid && Date.now() < deadline) {
      pid = Number(await readFile(log, 'utf8').catch(() => '')) || undefined;
      if (!pid) await new Promise(done => setTimeout(done, 10));
    }
    assert.ok(pid, 'Child must report readiness before interruption');
    process.emit('SIGTERM');
    await rejected;
    let alive = true;
    while (alive && Date.now() < deadline) {
      try { process.kill(pid, 0); await new Promise(done => setTimeout(done, 10)); }
      catch (error) { assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH'); alive = false; }
    }
    assert.equal(alive, false, 'No orphan process may survive stage cancellation');
  } finally {
    if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    await rm(directory, {recursive:true,force:true});
  }
});

test('bounded stages retain diagnostics and reject nonzero exits and expired commands', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-release-'));
  try {
    const log = join(directory, 'command.log');
    await assert.rejects(runStage('failed', process.execPath, ['-e', 'console.error("diagnostic"); process.exit(2)'], 1000, log), /failed/);
    assert.match(await readFile(log, 'utf8'), /diagnostic/);
    await assert.rejects(runStage('deadline', process.execPath, ['-e', 'setInterval(() => {}, 1000)'], 100, log), /deadline/);
  } finally { await rm(directory, {recursive:true,force:true}); }
});

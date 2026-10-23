import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertCandidate, assertUnitCoverage, assertUnitResults, reconcileBrowserCoverage, runChecks, runStage, unitFileStages} from '../scripts/release-check.ts';

test('independent checks all execute and preserve each failure without retrying', async () => {
  const calls: number[] = [];
  const first = new Error('first failure');
  const last = new Error('last failure');
  await assert.rejects(runChecks([
    async () => { calls.push(1); throw first; },
    async () => { calls.push(2); },
    async () => { calls.push(3); throw last; },
  ]), error => error instanceof AggregateError && error.errors[0] === first && error.errors[1] === last);
  assert.deepEqual(calls, [1, 2, 3]);
  await assert.doesNotReject(runChecks([async () => {}]));
});

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

test('unit stages isolate each discovered file independently of inventory insertion or order', () => {
  const files = ['tests/stereo-engine.test.ts', 'tests/cached-session.test.ts', 'tests/engine.test.ts'];
  const stages = unitFileStages(files);
  assert.deepEqual(stages, [
    {name:'units-cached-session', file:'tests/cached-session.test.ts'},
    {name:'units-engine', file:'tests/engine.test.ts'},
    {name:'units-stereo-engine', file:'tests/stereo-engine.test.ts'},
  ]);
  const expanded = unitFileStages(['tests/aaa-new.test.ts', ...[...files].reverse(), 'tests/zzz-new.test.ts']);
  assert.deepEqual(expanded.filter(stage => files.includes(stage.file)), stages);
  assert.equal(new Set(expanded.map(stage => stage.name)).size, expanded.length);
  assert.throws(() => unitFileStages([]), /inventory/i);
  assert.throws(() => unitFileStages([...files, files[0]!]), /inventory/i);
});

test('unit coverage requires exactly one completed native result per discovered file', () => {
  const files = ['tests/cached-session.test.ts', 'tests/stereo-engine.test.ts'];
  const results = [{file:files[0]!, tests:14}, {file:files[1]!, tests:10}];
  assert.doesNotThrow(() => assertUnitCoverage(files, [...results].reverse()));
  for (const incomplete of [[], results.slice(1), [...results, results[0]!], [...results, {file:'tests/extra.test.ts', tests:1}]]) {
    assert.throws(() => assertUnitCoverage(files, incomplete), /inventory/i);
  }
  assert.throws(() => assertUnitCoverage([], []), /inventory/i);
  assert.throws(() => assertUnitCoverage([...files, files[0]!], results), /inventory/i);
  for (const tests of [0, -1, 1.5, NaN]) {
    assert.throws(() => assertUnitCoverage(files, [{...results[0]!, tests}, results[1]!]), /result/i);
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
    let continued = false;
    const result = runChecks([
      () => runStage('interrupted', process.execPath, ['-e', script], 3000, log),
      async () => { continued = true; },
    ]);
    const rejected = assert.rejects(result, /interrupted/);
    const deadline = Date.now() + 2000;
    while (!pid && Date.now() < deadline) {
      pid = Number(await readFile(log, 'utf8').catch(() => '')) || undefined;
      if (!pid) await new Promise(done => setTimeout(done, 10));
    }
    assert.ok(pid, 'Child must report readiness before interruption');
    process.emit('SIGTERM');
    await rejected;
    assert.equal(continued, false, 'Interruption must stop further checks');
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

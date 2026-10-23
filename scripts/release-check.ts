import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {closeSync, openSync} from 'node:fs';
import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sealArtifact, verifyArtifact} from './release-artifact.ts';
import {BROWSER_SHARDS, BROWSER_GLOBAL_TIMEOUT_MS, releaseBrowserMatrix} from './release-settings.ts';
import {validateReleaseInventory, type ReleaseBrowserReceipt} from './release-browser-reporter.ts';

interface Candidate {commit: string; status: string}
class ValidationInterrupted extends Error {}

export function assertCandidate(before: Candidate, after: Candidate): void {
  assert.equal(before.status.trim(), '', 'Release evidence requires a clean committed candidate');
  assert.equal(after.status.trim(), '', 'Release evidence requires a clean committed candidate');
  assert.equal(after.commit, before.commit, 'Candidate changed during validation');
}

export function assertUnitResults(tap: string): number {
  const value = (key: string) => {
    const matches = [...tap.matchAll(new RegExp(`^# ${key} (\\d+)\\r?$`, 'gm'))];
    assert.equal(matches.length, 1, `Missing or ambiguous native unit summary: ${key}`);
    return Number(matches[0]![1]);
  };
  const count = value('tests');
  assert.ok(count > 0, 'Empty unit execution');
  assert.equal(value('pass'), count, 'Incomplete passing unit execution');
  for (const key of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(value(key), 0, `Unexpected unit ${key}`);
  return count;
}

interface UnitFileResult {file: string; tests: number}

export function unitFileStages(files: readonly string[]): {name: string; file: string}[] {
  assert.ok(files.length > 0 && new Set(files).size === files.length, 'Empty or duplicate unit inventory');
  return [...files].sort().map(file => {
    assert.match(file, /^tests\/[^/]+\.test\.ts$/, 'Invalid unit inventory file');
    return {name:`units-${file.slice('tests/'.length, -'.test.ts'.length)}`, file};
  });
}

export function assertUnitCoverage(files: readonly string[], results: readonly UnitFileResult[]): void {
  const expected = unitFileStages(files).map(stage => stage.file);
  assert.deepEqual(results.map(result => result.file).sort(), expected, 'Missing, extra or duplicate unit inventory');
  for (const result of results) assert.ok(Number.isSafeInteger(result.tests) && result.tests > 0, 'Invalid completed unit result');
}

export async function runChecks(checks: (() => Promise<void>)[]): Promise<void> {
  const failures: unknown[] = [];
  for (const check of checks) {
    try { await check(); }
    catch (error) {
      if (error instanceof ValidationInterrupted) throw error;
      failures.push(error);
      console.error(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, `${failures.length} independent validation checks failed`);
}

export function reconcileBrowserCoverage(
  values: unknown[], inventories: Map<string, string[]>, artifact: {commit: string; digest: string}, shards: number,
): void {
  const reports = values as ReleaseBrowserReceipt[];
  assert.equal(reports.length, inventories.size * shards, 'Missing or extra browser shard receipts');
  for (const [project, inventory] of inventories) {
    assert.ok(inventory.length > 0 && new Set(inventory).size === inventory.length, 'Invalid native inventory');
    const selected = reports.filter(report => report.project === project);
    assert.deepEqual(selected.map(report => report.shard.current).sort((a, b) => a - b),
      Array.from({length:shards}, (_, index) => index + 1), `Missing or duplicate ${project} shards`);
    const discovered: string[] = [];
    for (const report of selected) {
      assert.equal(report.shard.total, shards, 'Wrong shard count');
      assert.equal(report.commit, artifact.commit, 'Wrong candidate commit');
      assert.equal(report.artifactDigest, artifact.digest, 'Wrong candidate artifact');
      assert.equal(report.status, 'passed', 'Browser shard failed');
      assert.equal(report.schemaVersion, 1, 'Unknown browser receipt version');
      assert.deepEqual(report.errors, [], 'Browser receipt contains errors');
      assert.equal(report.platform, project === 'webkit' ? 'darwin' : process.platform, 'Wrong browser/platform evidence');
      const ids = report.discovered.map(test => test.id);
      assert.deepEqual(report.results.map(result => result.id).sort(), [...ids].sort(), 'Incomplete or duplicate execution');
      assert.deepEqual(validateReleaseInventory(report.discovered, report.results), [], 'Invalid browser execution');
      for (const result of report.results.filter(result => result.status === 'passed')) {
        const version = result.annotations.find(annotation => annotation.type === 'browser-version')?.description;
        assert.ok(version && report.browsers.some(browser => browser.project === project && browser.version === version),
          'Actual executing browser version is missing');
      }
      discovered.push(...ids);
    }
    assert.deepEqual(discovered.sort(), [...inventory].sort(), `Missing, extra or duplicate ${project} inventory`);
  }
}

export async function runStage(name: string, command: string, args: string[], budget: number, log: string, jsonOutput = false): Promise<void> {
  await mkdir(dirname(log), {recursive:true});
  const output = openSync(log, 'w');
  const errorOutput = jsonOutput ? openSync(`${log}.stderr`, 'w') : output;
  console.log(`${name}: started; log ${log}`);
  try {
    await new Promise<void>((done, fail) => {
      const child = spawn(command, args, {stdio:['ignore', output, errorOutput], detached:true});
      let stopped: string | undefined;
      let force: NodeJS.Timeout | undefined;
      const groups = new Set<number>();
      if (child.pid) groups.add(child.pid);
      const kill = (signal: NodeJS.Signals) => {
        for (const group of groups) {
          try { process.kill(-group, signal); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
        }
      };
      const stop = (reason = 'interrupted') => {
        if (stopped) return;
        stopped = reason;
        // Playwright's processLauncher creates detached browser/server groups; capture ancestry before terminating their parent.
        try {
          const processes = execFileSync('ps', ['-eo', 'pid=,ppid=,pgid='], {encoding:'utf8', timeout:1000})
            .trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
          const descendants = new Set<number>(child.pid ? [child.pid] : []);
          let changed = true;
          while (changed) {
            changed = false;
            for (const [pid, parent] of processes) {
              if (descendants.has(parent!) && !descendants.has(pid!)) { descendants.add(pid!); changed = true; }
            }
          }
          for (const [pid, , group] of processes) if (descendants.has(pid!) && descendants.has(group!)) groups.add(group!);
        } catch (error) { stopped += `; descendant discovery failed: ${String(error)}`; }
        kill('SIGTERM');
        force = setTimeout(() => kill('SIGKILL'), 2000);
      };
      const interrupt = () => stop('interrupted');
      process.once('SIGINT', interrupt);
      process.once('SIGTERM', interrupt);
      const timer = setTimeout(() => {
        stop(`deadline exceeded (${budget} ms)`);
      }, budget);
      const cleanup = () => {
        clearTimeout(timer);
        if (force) clearTimeout(force);
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', interrupt);
      };
      child.once('error', error => { cleanup(); fail(error); });
      child.once('close', (code, signal) => {
        kill('SIGKILL');
        cleanup();
        if (stopped?.startsWith('interrupted')) fail(new ValidationInterrupted(`${name}: ${stopped}; see ${log}`));
        else if (stopped) fail(new Error(`${name}: ${stopped}; see ${log}`));
        else if (code !== 0) fail(new Error(`${name}: failed (${signal ?? code}); see ${log}`));
        else done();
      });
    });
  } finally {
    closeSync(output);
    if (errorOutput !== output) closeSync(errorOutput);
  }
  console.log(`${name}: passed`);
}

const candidate = (): Candidate => ({
  commit:execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(),
  status:execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {encoding:'utf8'}),
});
const outputDirectory = 'build/release';
const logPath = (name: string) => resolve(outputDirectory, `${name}.log`);
const save = (name: string, data: unknown) => writeFile(resolve(outputDirectory, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);

function nativeInventory(value: unknown, project: string): string[] {
  const ids: string[] = [];
  const visit = (suite: {specs?: {id:string; tests:{projectName:string}[]}[]; suites?: typeof suite[]}) => {
    for (const spec of suite.specs ?? []) if (spec.tests.some(test => test.projectName === project)) ids.push(spec.id);
    for (const child of suite.suites ?? []) visit(child);
  };
  visit(value as Parameters<typeof visit>[0]);
  assert.ok(ids.length > 0, `Empty native inventory for ${project}`);
  return ids;
}

async function software(): Promise<void> {
  const files = (await readdir('tests')).filter(file => file.endsWith('.test.ts')).sort().map(file => `tests/${file}`);
  const groups: UnitFileResult[] = [];
  let status = 'failed';
  try {
    await runChecks(unitFileStages(files).map(({name, file}) => async () => {
      await runStage(name, process.execPath, ['--experimental-strip-types', '--test', '--test-concurrency=1',
        '--test-reporter=tap', file], 60_000, logPath(name));
      groups.push({file, tests:assertUnitResults(await readFile(logPath(name), 'utf8'))});
    }));
    assertUnitCoverage(files, groups);
    status = 'passed';
  } finally {
    await save('software', {commit:candidate().commit, platform:process.platform, node:process.version, files, groups, status});
  }
}

async function build(): Promise<void> {
  await runStage('prepare-assets', 'pnpm', ['prepare:assets'], 120_000, logPath('prepare-assets'));
  await runStage('build', 'pnpm', ['build'], 120_000, logPath('build'));
  await sealArtifact(process.cwd(), candidate().commit);
}

async function docs(): Promise<void> {
  await runStage('docs', 'python3', ['scripts/check-docs.py'], 60_000, logPath('docs'));
  await runStage('whitespace', 'git', ['show', '--format=', '--check', 'HEAD'], 10_000, logPath('whitespace'));
}

async function browser(project: string, shard: string): Promise<void> {
  assert.ok(project === 'chrome' || project === 'webkit' && process.platform === 'darwin', 'Unsupported browser/platform pairing');
  const [index, count] = shard.split('/').map(Number);
  assert.ok(count === BROWSER_SHARDS && Number.isInteger(index) && index! >= 1 && index! <= count, 'Invalid release shard');
  await verifyArtifact(process.cwd(), candidate().commit);
  process.env.EXPLORER_RELEASE_CHECK = '1';
  const cli = 'node_modules/@playwright/test/cli.js';
  await runStage(`inventory-${project}`, process.execPath, [cli, 'test', '--list', '--fully-parallel', '--project', project, '--reporter=json'],
    30_000, resolve(outputDirectory, `inventory-${project}.json`), true);
  await rm(resolve(outputDirectory, `browser-${project}-${index}.json`), {force:true});
  await runStage(`browser-${project}-${index}`, process.execPath,
    [cli, 'test', '--project', project, '--fully-parallel', '--shard', shard, `--global-timeout=${BROWSER_GLOBAL_TIMEOUT_MS}`],
    BROWSER_GLOBAL_TIMEOUT_MS + 5000, logPath(`browser-${project}-${index}`));
  await verifyArtifact(process.cwd(), candidate().commit);
}

async function coverage(directory: string): Promise<void> {
  const manifest = await verifyArtifact(process.cwd(), candidate().commit);
  const files: string[] = [];
  const visit = async (path: string) => {
    for (const entry of await readdir(path, {withFileTypes:true})) {
      const name = resolve(path, entry.name);
      if (entry.isDirectory()) await visit(name);
      else if (/^(inventory-(chrome|webkit)|browser-(chrome|webkit)-\d+)\.json$/.test(entry.name)) files.push(name);
    }
  };
  await visit(directory);
  const inventories = new Map<string, string[]>();
  for (const project of ['chrome', 'webkit']) {
    const copies = files.filter(file => file.endsWith(`/inventory-${project}.json`));
    assert.ok(copies.length, `Missing native ${project} inventory`);
    for (const file of copies) {
      const ids = nativeInventory(JSON.parse(await readFile(file, 'utf8')), project).sort();
      if (inventories.has(project)) assert.deepEqual(ids, inventories.get(project), `Inconsistent native ${project} inventories`);
      else inventories.set(project, ids);
    }
  }
  const reports = await Promise.all(files.filter(file => /\/browser-(chrome|webkit)-\d+\.json$/.test(file))
    .map(async file => JSON.parse(await readFile(file, 'utf8'))));
  reconcileBrowserCoverage(reports, inventories, manifest, BROWSER_SHARDS);
  await save('coverage', {commit:manifest.commit, artifactDigest:manifest.digest, projects:[...inventories.keys()], shards:BROWSER_SHARDS, status:'passed'});
}

async function main(args: string[]): Promise<void> {
  const command = args.shift() ?? 'all';
  if (command === 'matrix') { console.log(JSON.stringify(releaseBrowserMatrix())); return; }
  const option = (name: string) => {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    assert.ok(args[index + 1] && !args[index + 1]!.startsWith('--'), `Missing ${name} value`);
    const value = args[index + 1]!;
    args.splice(index, 2);
    return value;
  };
  const project = option('--project');
  const shard = option('--shard');
  const receipts = option('--receipts') ?? outputDirectory;
  assert.equal(args.length, 0, `Unknown arguments: ${args.join(' ')}`);
  for (const key of ['EXPLORER_TEST_URL', 'EXPLORER_README_CAPTURE', 'EXPLORER_FULL_SONG']) {
    assert.equal(process.env[key], undefined, `${key} is incompatible with release validation`);
  }
  const nodeVersion = (await readFile('.node-version', 'utf8')).trim().replace(/^v/, '');
  assert.equal(process.versions.node, nodeVersion, `Use pinned Node ${nodeVersion}`);
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const pnpmVersion = execFileSync('pnpm', ['--version'], {encoding:'utf8', timeout:10_000}).trim();
  assert.equal(`pnpm@${pnpmVersion}`, pkg.packageManager, 'Use pinned pnpm');
  const before = candidate();
  assertCandidate(before, before);
  if (command === 'all') {
    assert.equal(process.platform, 'darwin', 'Complete local release preflight requires macOS for WebKit; CI covers Linux Chrome separately');
    await rm(outputDirectory, {recursive:true,force:true});
  }
  await mkdir(outputDirectory, {recursive:true});
  try {
    switch (command) {
      case 'software': await software(); break;
      case 'build': await build(); break;
      case 'docs': await docs(); break;
      case 'browser':
        assert.ok(project && shard, 'browser requires --project and --shard');
        await browser(project, shard);
        break;
      case 'coverage': await coverage(receipts); break;
      case 'verify': await verifyArtifact(process.cwd(), before.commit); break;
      case 'all':
        await runStage('dependencies', 'pnpm', ['install', '--frozen-lockfile'], 60_000, logPath('dependencies'));
        await build();
        await runChecks([
          software, docs,
          ...['chrome', 'webkit'].flatMap(selected => Array.from({length:BROWSER_SHARDS},
            (_, index) => () => browser(selected, `${index + 1}/${BROWSER_SHARDS}`))),
          () => coverage(outputDirectory),
        ]);
        break;
      default: throw new Error(`Unknown release command: ${command}`);
    }
    assertCandidate(before, candidate());
    await save(`check-${command}${project ? `-${project}-${shard!.replace('/', '-')}` : ''}`,
      {commit:before.commit, status:'passed', platform:process.platform, node:process.version, pnpm:pnpmVersion});
  } catch (error) {
    await save(`check-${command}-failure`, {commit:before.commit, status:'failed', error:String(error)});
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
}

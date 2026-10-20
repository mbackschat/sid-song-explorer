import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {basename} from 'node:path';

type ListedSpec = {id: string; file: string; tags: string[]; tests: {projectName: string}[]};
type ListedSuite = {specs?: ListedSpec[]; suites?: ListedSuite[]};
type ListedTest = {id: string; project: string; file: string; tags: string[]};

function discover(release: boolean): ListedTest[] {
  const env = {...process.env};
  for (const name of ['EXPLORER_RELEASE_CHECK', 'EXPLORER_TEST_URL', 'EXPLORER_README_CAPTURE', 'EXPLORER_FULL_SONG']) delete env[name];
  if (release) env.EXPLORER_RELEASE_CHECK = '1';
  const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--list', '--reporter=json'], {
    env, encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as {suites: ListedSuite[]; errors: unknown[]};
  assert.deepEqual(report.errors, []);
  const tests: ListedTest[] = [];
  const visit = (suite: ListedSuite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) tests.push({id: spec.id, project: test.projectName, file: basename(spec.file), tags: spec.tags});
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites) visit(suite);
  return tests;
}

test('native release discovery narrows POC coverage while ordinary discovery retains the full browser suite', {timeout: 60_000}, () => {
  const ordinary = discover(false);
  const release = discover(true);
  const scopes = process.platform === 'darwin' ? [['chrome', 'poc', 6], ['webkit', 'webkit-compat', 3]] as const : [['chrome', 'poc', 6]] as const;
  const projects = scopes.map(([project]) => project).sort();
  assert.deepEqual([...new Set(ordinary.map(test => test.project))].sort(), projects);
  assert.deepEqual([...new Set(release.map(test => test.project))].sort(), projects);
  const files = readdirSync('tests/browser').filter(name => name.endsWith('.spec.ts')).sort();
  for (const [project, tag, count] of scopes) {
    const complete = ordinary.filter(test => test.project === project);
    const selected = release.filter(test => test.project === project);
    assert.equal(selected.length, count, `${project} release scope`);
    assert.ok(complete.length > selected.length);
    assert.deepEqual([...new Set(complete.map(test => test.file))].sort(), files);
    assert.ok(selected.every(test => test.tags.includes(tag)), `${project} release tags`);
    assert.deepEqual(selected.map(test => test.id).sort(), complete.filter(test => test.tags.includes(tag)).map(test => test.id).sort());
  }
});

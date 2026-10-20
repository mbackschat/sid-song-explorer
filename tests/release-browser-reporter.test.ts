import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {FullConfig, Suite, TestCase, TestResult} from '@playwright/test/reporter';
import ReleaseBrowserReporter, {validateReleaseInventory, type ReleaseTest, type ReleaseResult} from '../scripts/release-browser-reporter.ts';

const discovered: ReleaseTest = {
  id: 'native-test-id', project: 'chrome', file: 'tests/browser/player.spec.ts',
  titlePath: ['chrome', 'player.spec.ts', 'plays'], expectedStatus: 'passed', annotations: [],
};
const passed: ReleaseResult = {
  id: discovered.id, project: discovered.project, status: 'passed', retry: 0,
  expectedStatus: 'passed', annotations: [],
};
const fullSong: ReleaseTest = {...discovered, id: 'native-full-song-id', file: 'tests/browser/full-song.spec.ts'};
const skipped: ReleaseResult = {
  ...passed, id: fullSong.id, status: 'skipped', expectedStatus: 'skipped',
  annotations: [{type: 'skip', description: 'Opt in to full-duration real-time playback checks.'}],
};

test('release inventory accepts one real passing result for every native discovered test', () => {
  assert.deepEqual(validateReleaseInventory([discovered], [passed]), []);
});

test('release inventory accepts only the declared opt-in full-song exclusion', () => {
  assert.deepEqual(validateReleaseInventory([discovered, fullSong], [passed, skipped]), []);
});

test('release inventory rejects a missing discovered result and an empty inventory', () => {
  assert.match(validateReleaseInventory([discovered], []).join('\n'), /missing.*native-test-id/i);
  assert.match(validateReleaseInventory([], []).join('\n'), /empty.*inventory/i);
});

test('release inventory rejects results outside discovery and duplicate native IDs', () => {
  assert.match(validateReleaseInventory([discovered], [passed, {...passed, id: 'unexpected'}]).join('\n'), /undiscovered.*unexpected/i);
  assert.match(validateReleaseInventory([discovered, discovered], [passed]).join('\n'), /duplicate.*native-test-id/i);
});

test('release inventory rejects an extra skipped test even if Playwright expects the skip', () => {
  assert.match(validateReleaseInventory([discovered], [{...skipped, id: discovered.id}]).join('\n'), /unexpected skip.*native-test-id/i);
});

test('release inventory rejects a changed full-song skip reason or a fixme annotation', () => {
  for (const annotations of [[{type: 'skip', description: 'temporarily broken'}], [{type: 'fixme'}]]) {
    assert.match(validateReleaseInventory([fullSong], [{...skipped, annotations}]).join('\n'), /unexpected skip/i);
  }
});

test('release inventory rejects both retry indices and repeated result attempts', () => {
  assert.match(validateReleaseInventory([discovered], [{...passed, retry: 1}]).join('\n'), /retry.*native-test-id/i);
  assert.match(validateReleaseInventory([discovered], [passed, passed]).join('\n'), /multiple.*native-test-id/i);
});

for (const status of ['failed', 'timedOut', 'interrupted'] as const) {
  test(`release inventory rejects ${status} results`, () => {
    assert.match(validateReleaseInventory([discovered], [{...passed, status}]).join('\n'), /not pass.*native-test-id/i);
  });
}

test('release inventory rejects test.fail masking at discovery or runtime', () => {
  assert.match(validateReleaseInventory([{...discovered, expectedStatus: 'failed'}], [{...passed, status: 'failed', expectedStatus: 'failed'}]).join('\n'), /expected.failure.*native-test-id/i);
  assert.match(validateReleaseInventory([discovered], [{...passed, annotations: [{type: 'fail'}]}]).join('\n'), /expected.failure.*native-test-id/i);
});

test('release inventory requires the result to retain its discovered project', () => {
  assert.match(validateReleaseInventory([discovered], [{...passed, project: 'webkit'}]).join('\n'), /project.*native-test-id/i);
});

async function reporterFixture(t: {after(callback: () => Promise<void>): void}) {
  const root = await mkdtemp(join(tmpdir(), 'explorer-browser-reporter-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const project = {name: 'chrome', use: {browserName: 'chromium', channel: 'chrome'}};
  const nativeTest = {
    id: discovered.id, location: {file: join(root, discovered.file)},
    titlePath: () => discovered.titlePath, expectedStatus: 'passed', annotations: [],
    parent: {project: () => project},
  } as unknown as TestCase;
  const config = {
    configFile: join(root, 'playwright.config.ts'), shard: {current: 2, total: 7},
    projects: [project], metadata: {releaseBrowser: {commit: 'candidate-commit', artifactDigest: 'candidate-digest'}},
  } as unknown as FullConfig;
  const reporter = new ReleaseBrowserReporter();
  reporter.onBegin(config, {allTests: () => [nativeTest]} as unknown as Suite);
  return {root, reporter, nativeTest};
}

test('native reporter writes artifact-bound shard inventory with the actual browser version', async t => {
  const {root, reporter, nativeTest} = await reporterFixture(t);
  reporter.onTestEnd(nativeTest, {
    status: 'passed', retry: 0, annotations: [{type: 'browser-version', description: '142.0.7444.60'}],
  } as TestResult);
  assert.equal(await reporter.onEnd({status: 'passed', startTime: new Date(), duration: 10}), undefined);
  const receipt = JSON.parse(await readFile(join(root, 'build/release/browser-chrome-2.json'), 'utf8'));
  assert.equal(receipt.commit, 'candidate-commit');
  assert.equal(receipt.artifactDigest, 'candidate-digest');
  assert.deepEqual(receipt.shard, {current: 2, total: 7});
  assert.equal(receipt.platform, process.platform);
  assert.equal(receipt.project, 'chrome');
  assert.equal(receipt.discovered[0].id, discovered.id);
  assert.equal(receipt.results[0].id, discovered.id);
  assert.deepEqual(receipt.browsers, [{project: 'chrome', browserName: 'chromium', channel: 'chrome', version: '142.0.7444.60'}]);
  assert.deepEqual(receipt.errors, []);
});

test('native reporter fails a successful Playwright outcome with a missing browser result', async t => {
  const {root, reporter} = await reporterFixture(t);
  assert.deepEqual(await reporter.onEnd({status: 'passed', startTime: new Date(), duration: 10}), {status: 'failed'});
  const receipt = JSON.parse(await readFile(join(root, 'build/release/browser-chrome-2.json'), 'utf8'));
  assert.equal(receipt.status, 'failed');
  assert.match(receipt.errors.join('\n'), /missing result/i);
});

test('native reporter rejects passing results without an actual browser version annotation', async t => {
  const {reporter, nativeTest} = await reporterFixture(t);
  reporter.onTestEnd(nativeTest, {status: 'passed', retry: 0, annotations: []} as unknown as TestResult);
  assert.deepEqual(await reporter.onEnd({status: 'passed', startTime: new Date(), duration: 10}), {status: 'failed'});
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {BROWSER_GLOBAL_TIMEOUT_MS, BROWSER_SHARDS, releaseBrowserMatrix} from '../scripts/release-settings.ts';

const workflow = readFileSync('.github/workflows/app.yml', 'utf8');
const jobs = new Map([...workflow.split('\njobs:\n')[1]!.matchAll(/^  ([a-z][a-z-]*):\n([\s\S]*?)(?=^  [a-z][a-z-]*:\n|$(?![\s\S]))/gm)].map(match => [match[1], match[2]]));

function job(name: string): string {
  const body = jobs.get(name);
  assert.ok(body, `Missing required release job: ${name}`);
  return body;
}

function steps(body: string): string[] {
  return body.split(/^      - /m).slice(1);
}

function downloadsCandidate(name: string): void {
  assert.ok(steps(job(name)).some(step => step.includes('uses: actions/download-artifact@v4') && step.includes('name: release-candidate') && /path: \.\s*$/m.test(step)), `${name} must download the entire sealed candidate`);
}

test('POC CI runs software and docs once on Linux without standalone setup jobs', () => {
  assert.deepEqual([...jobs.keys()], ['check', 'browsers', 'publish']);
  const check = job('check');
  assert.match(check, /runs-on: ubuntu-24\.04/);
  assert.doesNotMatch(check, /matrix:/);
  for (const command of ['build', 'software', 'docs']) {
    assert.equal([...workflow.matchAll(new RegExp(`run: pnpm release:check ${command}\\s*$`, 'gm'))].length, 1);
    assert.match(check, new RegExp(`run: pnpm release:check ${command}`));
  }
  assert.equal(existsSync('.github/workflows/docs.yml'), false, 'Documentation must not run twice per push');
  assert.match(workflow, /cancel-in-progress: true/);
});

test('engine reuse requires an exact input key and retains runtime verification', () => {
  const check = job('check');
  const cache = steps(check).find(step => step.includes('uses: actions/cache@v4'));
  assert.ok(cache);
  assert.match(cache, /path: build\/stereo-gate\/output/);
  for (const input of ['pnpm-lock.yaml', 'package.json', 'scripts/experiments/stereo/**', 'scripts/generate-test-sid.ts', 'LICENSE']) assert.ok(cache.includes(`'${input}'`), input);
  assert.doesNotMatch(cache, /restore-keys:/);
  const engine = steps(check).find(step => step.includes('run: pnpm prepare:engine'));
  assert.ok(engine);
  assert.match(engine, /if: steps\.engine\.outputs\.cache-hit != 'true'/);
  assert.ok(check.indexOf('run: pnpm prepare:engine') < check.indexOf('run: pnpm release:check build'));
  // prepare:assets in the build command independently checks provenance and runtime hashes.
  assert.match(readFileSync('scripts/release-check.ts', 'utf8'), /runStage\('prepare-assets', 'pnpm', \['prepare:assets'\]/);
});

test('CI builds one candidate and runs only the supported small browser matrix', () => {
  assert.equal(BROWSER_SHARDS, 1);
  assert.ok(BROWSER_GLOBAL_TIMEOUT_MS < 180_000);
  const browsers = job('browsers');
  assert.match(browsers, /needs: check/);
  for (const row of releaseBrowserMatrix().include) {
    assert.match(browsers, new RegExp(`project: ${row.project}\\n\\s+os: ${row.os}\\n\\s+install: ${row.install}`));
  }
  assert.equal([...browsers.matchAll(/- project:/g)].length, 2);
  assert.match(browsers, /run: pnpm release:check browser --project \$\{\{ matrix\.project \}\} --shard 1\/1/);
  assert.doesNotMatch(browsers, /release:check software|pnpm test(?:\s|:)|pnpm build|prepare:assets|prepare:engine/);
  downloadsCandidate('browsers');
  const upload = steps(job('check')).find(step => step.includes('name: release-candidate'));
  assert.ok(upload);
  for (const path of ['dist/', 'public/generated/', 'build/release/artifact.json']) assert.ok(upload.includes(path));
  assert.match(upload, /if-no-files-found: error/);
});

test('publication verifies both browser receipts and deploys the tested candidate', () => {
  const publish = job('publish');
  assert.match(publish, /needs: \[check, browsers\]/);
  assert.match(publish, /if: github\.ref == 'refs\/heads\/main' && github\.event_name != 'pull_request'/);
  downloadsCandidate('publish');
  assert.match(publish, /pattern: browser-receipts-/);
  assert.match(publish, /run: pnpm release:check coverage --receipts build\/release\/receipts/);
  assert.doesNotMatch(publish, /pnpm build|release:check build|prepare:assets|prepare:engine/);
  assert.ok(publish.indexOf('run: pnpm release:check coverage') < publish.indexOf('uses: actions/upload-pages-artifact@v3'));
  assert.match(publish, /path: dist/);
  assert.match(publish, /uses: actions\/deploy-pages@v4/);
});

test('CI retains failure diagnostics and browser receipts without retries', () => {
  for (const name of jobs.keys()) {
    assert.ok(steps(job(name)).some(step => step.includes('uses: actions/upload-artifact@v4') && step.includes('if: always()') && step.includes('build/release/')), `${name} must retain diagnostics`);
  }
  const browsers = job('browsers');
  const receipts = steps(browsers).find(step => step.includes('name: browser-receipts-'));
  assert.ok(receipts);
  assert.match(receipts, /if: always\(\)/);
  assert.match(receipts, /build\/release\/browser-\*\.json/);
  assert.match(receipts, /build\/release\/inventory-\*\.json/);
  assert.match(browsers, /set -o pipefail/);
  assert.match(browsers, /playwright install --with-deps/);
  assert.doesNotMatch(workflow, /retry|continue-on-error/);
});

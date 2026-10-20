import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BROWSER_GLOBAL_TIMEOUT_MS, BROWSER_SHARDS, releaseBrowserMatrix, UNIT_SHARDS} from '../scripts/release-settings.ts';

const workflow = readFileSync('.github/workflows/app.yml', 'utf8');
const jobs = new Map([...workflow.matchAll(/^  ([a-z][a-z-]*):\n([\s\S]*?)(?=^  [a-z][a-z-]*:\n|$(?![\s\S]))/gm)].map(match => [match[1], match[2]]));

function job(name: string): string {
  const body = jobs.get(name);
  assert.ok(body, `Missing required release job: ${name}`);
  return body;
}

function steps(body: string): string[] {
  return body.split(/^      - /m).slice(1);
}

function dependencies(name: string): string[] {
  const value = job(name).match(/^    needs: (.+)$/m)?.[1];
  return value ? value.replace(/[\[\]]/g, '').split(',').map(name => name.trim()) : [];
}

function ancestors(name: string, seen = new Set<string>()): Set<string> {
  for (const dependency of dependencies(name)) {
    if (!seen.has(dependency)) {
      seen.add(dependency);
      ancestors(dependency, seen);
    }
  }
  return seen;
}

function downloadsCandidate(name: string): void {
  assert.ok(steps(job(name)).some(step => step.includes('uses: actions/download-artifact@v4') && step.includes('name: release-candidate') && /path: \.\s*$/m.test(step)), `${name} must download the entire sealed candidate into the workspace`);
}

test('the release matrix covers every native shard with its supported browser and host', () => {
  const matrix = releaseBrowserMatrix();
  assert.equal(UNIT_SHARDS, 7);
  assert.equal(BROWSER_SHARDS, 1, 'POC release checks need one runner per browser');
  assert.ok(BROWSER_GLOBAL_TIMEOUT_MS < 180_000);
  assert.equal(matrix.include.length, BROWSER_SHARDS * 2);
  for (const [project, os, install] of [['chrome', 'ubuntu-24.04', 'chrome'], ['webkit', 'macos-26', 'webkit']]) {
    const rows = matrix.include.filter(row => row.project === project);
    assert.deepEqual(rows.map(row => row.shard), Array.from({length: BROWSER_SHARDS}, (_, index) => `${index + 1}/${BROWSER_SHARDS}`));
    assert.deepEqual(rows.map(row => row.index), Array.from({length: BROWSER_SHARDS}, (_, index) => index + 1));
    assert.ok(rows.every(row => row.os === os && row.install === install));
  }
});

test('CI builds and seals one candidate containing deployment output and browser fixtures', () => {
  assert.equal([...workflow.matchAll(/run: pnpm release:check build\s*$/gm)].length, 1);
  assert.doesNotMatch(workflow, /run: pnpm build\s*$/m);
  assert.deepEqual(dependencies('build'), ['engine', 'samples']);
  const upload = steps(job('build')).find(step => step.includes('uses: actions/upload-artifact@v4') && step.includes('name: release-candidate'));
  assert.ok(upload);
  for (const path of ['dist/', 'public/generated/', 'build/release/artifact.json']) assert.ok(upload.includes(path), `Candidate is missing ${path}`);
  assert.match(upload, /if-no-files-found: error/);
});

test('CI runs software once on each supported host outside the browser matrix', () => {
  const software = job('software');
  assert.match(software, /os: \[ubuntu-24\.04, macos-26\]/);
  assert.doesNotMatch(software, /(?:project|browser|shard):/);
  assert.match(software, /run: pnpm release:check software/);
  downloadsCandidate('software');
  assert.match(software, /name: verified-raw-chip-engine/);
  const browsers = job('browsers');
  assert.doesNotMatch(browsers, /release:check software|pnpm test(?:\s|:)|pnpm build|prepare:assets|prepare:engine/);
  assert.equal([...workflow.matchAll(/run: pnpm prepare:engine\s*$/gm)].length, 1);
  assert.equal([...workflow.matchAll(/run: pnpm prepare:samples\s*$/gm)].length, 1);
});

test('CI browser consumers use the shared matrix and retain installation failures separately', () => {
  assert.match(job('matrix'), /pnpm --silent release:check matrix/);
  const browsers = job('browsers');
  assert.match(browsers, /matrix: \$\{\{ fromJSON\(needs\.matrix\.outputs\.browsers\) \}\}/);
  assert.match(browsers, /fail-fast: false/);
  assert.match(browsers, /run: pnpm release:check browser --project \$\{\{ matrix\.project \}\} --shard \$\{\{ matrix\.shard \}\}/);
  downloadsCandidate('browsers');
  const install = steps(browsers).find(step => step.startsWith('name: Install browser dependencies'));
  assert.ok(install);
  assert.match(install, /timeout-minutes: 2/);
  assert.match(install, /set -o pipefail/);
  assert.match(install, /playwright install --with-deps/);
  assert.match(install, /tee build\/release\/browser-install-/);
  assert.ok(steps(browsers).indexOf(install) < steps(browsers).findIndex(step => step.includes('run: pnpm release:check browser')));
  const receipts = steps(browsers).find(step => step.includes('name: browser-receipts-'));
  assert.ok(receipts);
  assert.match(receipts, /if: always\(\)/);
  assert.match(receipts, /build\/release\/browser-\*\.json/);
  assert.match(receipts, /build\/release\/inventory-\*\.json/);
});

test('CI publishes the same verified candidate only after software browser coverage and docs gates', () => {
  assert.deepEqual(dependencies('coverage'), ['build', 'browsers']);
  assert.match(job('coverage'), /run: pnpm release:check coverage --receipts build\/release\/receipts/);
  assert.match(job('coverage'), /pattern: browser-receipts-/);
  assert.match(job('docs'), /run: pnpm release:check docs/);
  for (const gate of ['build', 'software', 'browsers', 'coverage', 'docs']) assert.ok(ancestors('deploy').has(gate), `Pages deployment is missing the ${gate} gate`);
  assert.deepEqual(dependencies('deploy'), ['publish']);
  downloadsCandidate('publish');
  const publish = job('publish');
  assert.match(publish, /run: pnpm release:check verify/);
  assert.doesNotMatch(publish, /pnpm build|release:check build|prepare:assets|prepare:engine/);
  assert.ok(publish.indexOf('run: pnpm release:check verify') < publish.indexOf('uses: actions/upload-pages-artifact@v3'));
  assert.equal([...workflow.matchAll(/uses: actions\/upload-pages-artifact@v3/g)].length, 1);
  assert.match(publish, /path: dist/);
});

test('CI keeps release diagnostics on success and failure without automatic retries', () => {
  for (const name of ['build', 'software', 'browsers', 'coverage', 'docs', 'publish']) {
    assert.ok(steps(job(name)).some(step => step.includes('uses: actions/upload-artifact@v4') && step.includes('if: always()') && step.includes('build/release/')), `${name} must retain release diagnostics`);
  }
  assert.doesNotMatch(workflow, /retry|continue-on-error/);
  assert.equal([...workflow.matchAll(/^      pages: write$/gm)].length, 1);
  assert.equal([...workflow.matchAll(/^      id-token: write$/gm)].length, 1);
});

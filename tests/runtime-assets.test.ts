import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { prepareRuntime } from '../scripts/prepare-runtime.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const patchSha256 = digest(await readFile(path.join(root, 'scripts/experiments/stereo/render-raw.inc')));
const runnerSha256 = digest(await readFile(path.join(root, 'scripts/experiments/stereo/run.py')));
const verifierSha256 = digest(await readFile(path.join(root, 'scripts/experiments/stereo/verify.mjs')));
const sourceSha256 = 'd0a3fa551bde2b55733b3c2bfd8ebd6f886ec9d81407c069d2ded15600eef0fb';
const artifactNames = ['libsidplayfp.js', 'libsidplayfp.wasm', 'libsidplayfp.d.ts', 'LICENSE',
  'THIRD-PARTY-NOTICES.md', 'MODIFICATIONS.md', 'EXPLORER-LICENSE.txt', 'complete-source.tar.gz'];

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function fixture() {
  await mkdir(path.join(root, 'build'), {recursive: true});
  const directory = await mkdtemp(path.join(root, 'build/runtime-assets-test-'));
  const artifactDirectory = path.join(directory, 'artifacts');
  const engineDirectory = path.join(directory, 'engine');
  const publicDirectory = path.join(directory, 'public');
  await mkdir(artifactDirectory);
  const files = [];
  for (const file of artifactNames) {
    const bytes = Buffer.from(`synthetic packaging fixture: ${file}`);
    await writeFile(path.join(artifactDirectory, file), bytes);
    files.push({file, bytes: bytes.length, sha256: digest(bytes)});
  }
  const provenance = {
    basePackage: 'libsidplayfp-wasm', baseVersion: '1.1.0', engine: 'SIDLite',
    sourceArchiveSha256: sourceSha256, bindingPatchSha256: patchSha256, buildRunnerSha256: runnerSha256, files,
  };
  const result = {
    status: 'passed', shippedMonoCompared: true, provenanceSha256: '', verifierSha256,
    checks: ['MOS6581', 'MOS8580'].flatMap(model => [0, 1].map(activeChip => ({
      model, activeChip, frames: 44100, pcmSha256: '1'.repeat(64), traceWrites: 3,
      seekFrame: 12347, continuationFrames: 4093,
    }))),
  };
  const value = {directory, artifactDirectory, engineDirectory, publicDirectory, provenance, result};
  await receipts(value);
  return value;
}

async function receipts(value: Fixture) {
  const bytes = Buffer.from(JSON.stringify(value.provenance));
  await writeFile(path.join(value.artifactDirectory, 'provenance.json'), bytes);
  value.result.provenanceSha256 = digest(bytes);
  await writeFile(path.join(value.artifactDirectory, 'result.json'), JSON.stringify(value.result));
}

test('packages only hash-verified runtime and corresponding-source artifacts from a passing receipt', async () => {
  const value = await fixture();
  try {
    await prepareRuntime(value);
    assert.deepEqual((await readdir(value.engineDirectory)).sort(), ['libsidplayfp.d.ts', 'libsidplayfp.js', 'libsidplayfp.wasm']);
    assert.deepEqual((await readdir(value.publicDirectory)).sort(), [
      'engine-EXPLORER-LICENSE.txt', 'engine-LICENSE.txt', 'engine-MODIFICATIONS.txt', 'engine-NOTICES.txt',
      'engine-complete-source.tar.gz', 'engine-provenance.json', 'engine-verification.json',
    ]);
    assert.deepEqual(await readFile(path.join(value.engineDirectory, 'libsidplayfp.wasm')),
      await readFile(path.join(value.artifactDirectory, 'libsidplayfp.wasm')));
    assert.deepEqual(await readFile(path.join(value.publicDirectory, 'engine-complete-source.tar.gz')),
      await readFile(path.join(value.artifactDirectory, 'complete-source.tar.gz')));
  } finally { await rm(value.directory, {recursive: true, force: true}); }
});

test('rejects missing, stale, altered or insufficiently verified runtime artifacts before copying', async () => {
  const mutations: ((value: Fixture) => Promise<void>)[] = [
    async value => { await rm(path.join(value.artifactDirectory, 'libsidplayfp.wasm')); },
    async value => { await writeFile(path.join(value.artifactDirectory, 'libsidplayfp.js'), 'changed'); },
    async value => { value.provenance.baseVersion = '1.2.0'; await receipts(value); },
    async value => { value.provenance.basePackage = 'other-engine'; await receipts(value); },
    async value => { value.provenance.sourceArchiveSha256 = '0'.repeat(64); await receipts(value); },
    async value => { value.provenance.bindingPatchSha256 = '0'.repeat(64); await receipts(value); },
    async value => { value.provenance.buildRunnerSha256 = '0'.repeat(64); await receipts(value); },
    async value => { value.provenance.engine = 'ReSID'; await receipts(value); },
    async value => { value.provenance.files.pop(); await receipts(value); },
    async value => { value.provenance.files.push({...value.provenance.files[0]}); await receipts(value); },
    async value => { value.provenance.files[0].file = '../escape'; await receipts(value); },
    async value => { value.provenance.files[0].bytes = 0; await receipts(value); },
    async value => { value.result.status = 'red'; await receipts(value); },
    async value => { value.result.shippedMonoCompared = false; await receipts(value); },
    async value => { value.result.verifierSha256 = '0'.repeat(64); await receipts(value); },
    async value => { value.result.checks.pop(); await receipts(value); },
    async value => { value.result.checks[0].traceWrites = 0; await receipts(value); },
    async value => { value.result.checks[0].continuationFrames = 0; await receipts(value); },
    async value => {
      const bytes = Buffer.from('rebuilt synthetic module with new provenance and an old passing receipt');
      await writeFile(path.join(value.artifactDirectory, 'libsidplayfp.js'), bytes);
      Object.assign(value.provenance.files[0], {bytes: bytes.length, sha256: digest(bytes)});
      await writeFile(path.join(value.artifactDirectory, 'provenance.json'), JSON.stringify(value.provenance));
    },
    async value => { value.result.provenanceSha256 = '0'.repeat(64); await writeFile(path.join(value.artifactDirectory, 'result.json'), JSON.stringify(value.result)); },
    async value => { await rm(path.join(value.artifactDirectory, 'result.json')); },
  ];
  for (const mutate of mutations) {
    const value = await fixture();
    try {
      await mutate(value);
      await assert.rejects(prepareRuntime(value), /prepare:engine/);
      await assert.rejects(readdir(value.engineDirectory), {code: 'ENOENT'});
      await assert.rejects(readdir(value.publicDirectory), {code: 'ENOENT'});
    } finally { await rm(value.directory, {recursive: true, force: true}); }
  }
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseCatalog } from '../src/catalog.ts';
import { prepareSamples } from '../scripts/prepare-samples.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const snapshot = JSON.parse(await readFile(new URL('../config/catalog.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(snapshot);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('the POC pins the cleared mono main-entry files and scoped listening verdict', () => {
  const catalog = parseCatalog(snapshot);
  assert.equal(catalog.source.revision, '3db086b6963676ef75f34d7f77c3b67232a777fb');
  assert.equal(catalog.entries.length, 1);
  const entry = catalog.entries[0];
  assert.equal(entry.id, 'rambo-loader-main');
  assert.equal(entry.files.sid.sha256, '99c61d30de4a27e800d185709192de0af92e6d1f2b2350ff8b80f47d8dc4a8cc');
  assert.equal(entry.files.reference.sha256, '4d3f3c78a89a384a14244f4ca6a36efe0022ea2f636327619ebc00be93909544');
  assert.match(entry.listening.scope, /cold-start.*not separately/i);
  assert.equal(entry.target.sidCount, 1);
  assert.equal(entry.analysis.timeBasis, 'seconds-from-init');
  assert.equal(entry.analysis.annotations.length, 3);
  assert.ok(entry.analysis.annotations.every((annotation) => annotation.voices.every((voice) => voice >= 1 && voice <= 3)));
});

test('rejects incompatible or undeclared contracts', () => {
  const mutations = [
    (value: any) => { value.schemaVersion = 2; },
    (value: any) => { value.extra = true; },
    (value: any) => { value.entries[0].target.clock = 'NTSC'; },
    (value: any) => { value.entries[0].target.sidCount = 2; },
    (value: any) => { value.entries[0].analysis.subtune = 2; },
    (value: any) => { value.entries[0].analysis.sidSha256 = '0'.repeat(64); },
    (value: any) => { value.entries[0].durationSeconds = Infinity; },
    (value: any) => { value.entries[0].rights.license = ''; },
  ];
  for (const mutate of mutations) {
    const value = clone();
    mutate(value);
    assert.throws(() => parseCatalog(value), /catalog/i);
  }
});

test('rejects unsafe files, moving source pins, duplicate identities and invalid annotation ranges', () => {
  const mutations = [
    (value: any) => { value.entries[0].files.sid.filename = '../escape.sid'; },
    (value: any) => { value.entries[0].files.sid.bytes = 0; },
    (value: any) => { value.entries[0].files.sid.sha256 = 'not-a-hash'; },
    (value: any) => { value.entries[0].files.sid.url = 'http://example.com/song.sid'; },
    (value: any) => { value.entries[0].files.sid.url = value.entries[0].files.sid.url.replace(value.source.revision, 'main'); },
    (value: any) => { value.entries.push(structuredClone(value.entries[0])); },
    (value: any) => { value.entries[0].files.license.filename = value.entries[0].files.sid.filename; },
    (value: any) => { value.entries[0].analysis.annotations[0].voices = [0]; },
    (value: any) => { value.entries[0].analysis.annotations[0].voices = [1, 1]; },
    (value: any) => { value.entries[0].analysis.annotations[0].startSeconds = -1; },
    (value: any) => { value.entries[0].analysis.annotations[0].endSeconds = value.entries[0].durationSeconds + 1; },
    (value: any) => { value.entries[0].analysis.annotations[0].endSeconds = value.entries[0].analysis.annotations[0].startSeconds; },
    (value: any) => { value.entries[0].analysis.annotations[0].evidenceLevel = 'accepted'; },
    (value: any) => { value.entries[0].analysis.annotations.push(structuredClone(value.entries[0].analysis.annotations[0])); },
  ];
  for (const mutate of mutations) {
    const value = clone();
    mutate(value);
    assert.throws(() => parseCatalog(value), /catalog/i);
  }
});

async function fixture() {
  await mkdir(path.join(root, 'build'), { recursive: true });
  const directory = await mkdtemp(path.join(root, 'build/catalog-test-'));
  const catalog = clone();
  const data = new Map<string, Uint8Array>();
  for (const [kind, file] of Object.entries(catalog.entries[0].files) as [string, any][]) {
    const bytes = Buffer.from(`verified ${kind} fixture`);
    file.bytes = bytes.length;
    file.sha256 = sha256(bytes);
    data.set(file.url, bytes);
    const sourcePath = new URL(file.url).pathname.split('/').slice(4).join('/');
    await mkdir(path.dirname(path.join(directory, 'source', sourcePath)), { recursive: true });
    await writeFile(path.join(directory, 'source', sourcePath), bytes);
  }
  catalog.entries[0].analysis.sidSha256 = catalog.entries[0].files.sid.sha256;
  return { directory, catalog: parseCatalog(catalog), data, outputDirectory: path.join(directory, 'output'), sourceRoot: path.join(directory, 'source') };
}

test('prepares only verified local bytes and verifies reuse without needing a sibling checkout', async () => {
  const value = await fixture();
  try {
    const first = await prepareSamples(value.catalog, value);
    assert.equal(first.filter((file) => file.status === 'written').length, 3);
    const reused = await prepareSamples(value.catalog, { outputDirectory: value.outputDirectory, sourceRoot: '/does-not-exist' });
    assert.ok(reused.every((file) => file.status === 'verified'));
    const file = value.catalog.entries[0].files.sid;
    assert.equal(sha256(await readFile(path.join(value.outputDirectory, file.filename))), file.sha256);
    await writeFile(path.join(value.outputDirectory, file.filename), Buffer.alloc(file.bytes, 1));
    await assert.rejects(prepareSamples(value.catalog, value), /SHA-256 mismatch/);
  } finally {
    await rm(value.directory, { recursive: true, force: true });
  }
});

test('refuses mismatched local bytes before publishing them', async () => {
  const value = await fixture();
  try {
    const file = value.catalog.entries[0].files.sid;
    const sourcePath = new URL(file.url).pathname.split('/').slice(4).join('/');
    await writeFile(path.join(value.sourceRoot, sourcePath), Buffer.alloc(file.bytes, 2));
    await assert.rejects(prepareSamples(value.catalog, value), /SHA-256 mismatch/);
    await assert.rejects(readFile(path.join(value.outputDirectory, file.filename)), { code: 'ENOENT' });
  } finally {
    await rm(value.directory, { recursive: true, force: true });
  }
});

test('downloads pinned bytes with a cancellation deadline and verifies each digest', async () => {
  const value = await fixture();
  const requests: string[] = [];
  try {
    const fetcher: typeof fetch = async (input, init) => {
      assert.ok(init?.signal instanceof AbortSignal);
      const url = String(input);
      requests.push(url);
      return new Response(new Uint8Array(value.data.get(url) ?? []));
    };
    const result = await prepareSamples(value.catalog, { outputDirectory: value.outputDirectory, fetcher });
    assert.equal(requests.length, 3);
    assert.ok(result.every((file) => file.status === 'written'));
  } finally {
    await rm(value.directory, { recursive: true, force: true });
  }
});

test('checks decoded byte counts when fetch retains a compressed HTTP Content-Length', async () => {
  const value = await fixture();
  try {
    await prepareSamples(value.catalog, {
      outputDirectory: value.outputDirectory,
      fetcher: async (input) => new Response(new Uint8Array(value.data.get(String(input)) ?? []), {
        headers: { 'content-encoding': 'gzip', 'content-length': '4' },
      }),
    });
    const file = value.catalog.entries[0].files.license;
    assert.equal(sha256(await readFile(path.join(value.outputDirectory, file.filename))), file.sha256);
  } finally {
    await rm(value.directory, { recursive: true, force: true });
  }
});

test('rejects failed, oversized and truncated downloads without publishing an asset', async () => {
  for (const response of [
    () => new Response('missing', { status: 404 }),
    () => new Response('too long', { headers: { 'content-length': '99999999' } }),
    () => new Response(new Uint8Array(1000)),
    () => new Response(new Uint8Array(1)),
  ]) {
    const value = await fixture();
    try {
      await assert.rejects(prepareSamples(value.catalog, {
        outputDirectory: value.outputDirectory,
        fetcher: async () => response(),
      }), /HTTP|byte length|size limit/);
      await assert.rejects(readFile(path.join(value.outputDirectory, value.catalog.entries[0].files.sid.filename)), { code: 'ENOENT' });
    } finally {
      await rm(value.directory, { recursive: true, force: true });
    }
  }
});

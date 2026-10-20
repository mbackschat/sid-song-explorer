import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { MAX_ASSET_BYTES } from '../src/catalog.ts';
import { adaptProducerCatalog, parseProducerCatalog, parseProducerJson, parseProducerPin, producerIndexUrl } from '../src/producer-catalog.ts';
import { importCatalog, loadPinnedCatalog } from '../scripts/import-catalog.ts';

const snapshot = JSON.parse(await readFile(new URL('./fixtures/catalog-migration.json', import.meta.url), 'utf8'));
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const execute = promisify(execFile);

function fixture() {
  const source = structuredClone(snapshot.source);
  const entry = structuredClone(snapshot.entries[0]);
  delete entry.stereo;
  const prefix = `${source.repository}/blob/${source.revision}/`;
  const ownerPath = (url: string) => url.slice(prefix.length);
  const files = Object.fromEntries(Object.entries(entry.files).map(([kind, value]) => {
    const file = value as any;
    const { url, ...metadata } = file;
    return [kind, { ...metadata, path: new URL(url).pathname.split('/').slice(4).join('/'), transport: 'raw', delivery: 'prepared' }];
  }));
  const { sourceUrl, licenseUrl, correspondingSourceUrl: _, ...rights } = entry.rights;
  const { sourceUrl: listeningSource, ...listening } = entry.listening;
  return {
    schemaVersion: 1,
    source,
    entries: [{
      ...entry,
      publication: 'cleared',
      files,
      target: { ...entry.target, routing: 'mono' },
      rights: { ...rights, sourcePath: ownerPath(sourceUrl), licensePath: ownerPath(licenseUrl) },
      listening: { ...listening, sourcePath: ownerPath(listeningSource) },
      analysis: { ...entry.analysis, annotations: entry.analysis.annotations.map(({ sourceUrl: url, ...annotation }: any) => ({ ...annotation, sourcePath: ownerPath(url) })) },
    }],
    materials: [],
  };
}

function pinned(value: unknown = fixture()) {
  const bytes = Buffer.from(JSON.stringify(value));
  return {
    bytes,
    pin: { schemaVersion: 1, repository: snapshot.source.repository, revision: '1'.repeat(40), path: 'catalog/explorer.json', bytes: bytes.length, sha256: sha256(bytes) },
  };
}

test('adapts relative producer metadata into the unchanged runtime contract', () => {
  const expected = structuredClone(snapshot);
  expected.entries = [expected.entries[0]];
  delete expected.entries[0].stereo;
  expected.materials = [];
  assert.deepEqual(adaptProducerCatalog(fixture()), expected);
});

test('the actual Crafter producer preserves the complete frozen migration oracle', async () => {
  const indexFile = new URL('../config/catalog-index.json', import.meta.url);
  const pin = parseProducerPin(parseProducerJson(await readFile(new URL('../config/catalog-pin.json', import.meta.url), 'utf8')));
  assert.notEqual(pin.revision, snapshot.source.revision);
  assert.deepEqual(await loadPinnedCatalog(pin, { indexFile: fileURLToPath(indexFile) }), snapshot);
});

test('validates delivery and routing without relaxing the prepared asset cap', () => {
  const value = fixture();
  const reference = value.entries[0].files.reference as any;
  delete value.entries[0].files.reference;
  (value.entries[0] as any).externalReference = { ...reference, bytes: MAX_ASSET_BYTES + 1, delivery: 'link-only' };
  assert.equal(adaptProducerCatalog(value).entries[0].referenceUrl, snapshot.entries[0].files.reference.url);
  const media = structuredClone(value);
  (media.entries[0] as any).externalReference.transport = 'media';
  assert.match(adaptProducerCatalog(media).entries[0].referenceUrl!, /^https:\/\/media\.githubusercontent\.com\/media\//);
});

test('rejects unknown fields, unsafe paths, publication changes, ambiguous identities and unsupported targets', () => {
  const mutations: ((value: any) => void)[] = [
    (v) => { v.schemaVersion = 2; },
    (v) => { v.extra = true; },
    (v) => { v.source.extra = true; },
    (v) => { v.entries[0].extra = true; },
    (v) => { v.entries[0].publication = 'materials-only'; },
    (v) => { v.entries[0].files.sid.extra = true; },
    (v) => { v.entries[0].files.sid.delivery = 'link-only'; },
    (v) => { v.entries[0].files.sid.transport = 'https'; },
    (v) => { v.entries[0].files.sid.bytes = MAX_ASSET_BYTES + 1; },
    (v) => { v.entries[0].target.routing = 'sid-a-left-sid-b-right'; },
    (v) => { v.entries[0].target.extra = true; },
    (v) => { v.entries[0].analysis.sidSha256 = '0'.repeat(64); },
    (v) => { v.entries[0].analysis.annotations[0].extra = true; },
    (v) => { v.entries[0].rights.extra = true; },
    (v) => { v.entries[0].listening.extra = true; },
    (v) => { v.entries[0].files.license.filename = v.entries[0].files.sid.filename; },
    (v) => { v.entries.push(structuredClone(v.entries[0])); },
    (v) => { v.entries[0].externalReference = { ...v.entries[0].files.reference, delivery: 'link-only' }; },
    (v) => { delete v.entries[0].files.reference; },
  ];
  for (const invalidPath of ['../escape.sid', '/absolute.sid', 'a//b.sid', 'a/./b.sid', 'a/../b.sid', 'https://example.com/file', 'a\\b.sid', 'a/%2e%2e/b.sid', 'a.sid#fragment', 'a.sid?query']) {
    mutations.push((v) => { v.entries[0].files.sid.path = invalidPath; });
  }
  for (const invalidPath of ['../README.md', 'README.md#', 'README.md#fragment#second', 'README.md#%2e%2e', 'README.md?query']) {
    mutations.push((v) => { v.entries[0].rights.sourcePath = invalidPath; });
  }
  for (const mutate of mutations) {
    const value = fixture();
    mutate(value);
    assert.throws(() => parseProducerCatalog(value), /catalog/i);
  }
});

test('binds the rights license owner to the prepared license bytes', () => {
  const value = fixture();
  value.entries[0].rights.licensePath = 'another/LICENSE';
  assert.throws(() => parseProducerCatalog(value), /license/i);
});

test('rejects duplicate JSON keys including escaped aliases in both index and pin documents', async () => {
  for (const json of ['{"schemaVersion":1,"schemaVersion":1}', '{"source":{"revision":"one","revision":"two"}}', '{"key":1,"\\u006bey":2}']) {
    assert.throws(() => parseProducerJson(json), /duplicate JSON key/);
  }
  assert.deepEqual(parseProducerJson('{"key":{"value":"escaped \\\" key"},"values":[{"key":1},{"key":2}]}'), { key: { value: 'escaped " key' }, values: [{ key: 1 }, { key: 2 }] });
  const value = fixture();
  const json = JSON.stringify(value).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1');
  const bytes = Buffer.from(json);
  const { pin } = pinned();
  Object.assign(pin, { bytes: bytes.length, sha256: sha256(bytes) });
  await assert.rejects(loadPinnedCatalog(pin, { fetcher: async () => new Response(bytes) }), /duplicate JSON key/);
});

test('bounds producer entry and materials arrays at 1000 records each', () => {
  const entries = fixture();
  entries.entries = Array.from({ length: 1001 }, () => structuredClone(entries.entries[0]));
  assert.throws(() => parseProducerCatalog(entries), /1000/);
  const materials: any = fixture();
  materials.materials = Array.from({ length: 1001 }, (_, index) => ({ id: `material-${index}`, title: 'Title', description: 'Description', publication: 'materials-only', sourcePath: 'README.md' }));
  assert.throws(() => parseProducerCatalog(materials), /1000/);
});

test('checks shared asset fingerprints while allowing link-only aliases and materials without files', () => {
  const value: any = fixture();
  const sid = { ...value.entries[0].files.sid, delivery: 'link-only' };
  const reference = { ...value.entries[0].files.reference, delivery: 'link-only' };
  value.entries[0].stereo = { sid, reference };
  value.materials = [{ id: 'notes', title: 'Notes', description: 'Source materials', sourcePath: 'README.md#notes', publication: 'materials-only' }];
  assert.equal(adaptProducerCatalog(value).materials[0].sourceUrl, `${value.source.repository}/blob/${value.source.revision}/README.md#notes`);
  for (const mutate of [
    (v: any) => { v.entries[0].stereo.sid.sha256 = '0'.repeat(64); },
    (v: any) => { v.entries[0].stereo.sid.bytes += 1; },
    (v: any) => { v.entries[0].stereo.sid.transport = 'media'; },
    (v: any) => { v.entries[0].stereo.reference.filename = v.entries[0].stereo.sid.filename; },
    (v: any) => { v.entries[0].stereo.sid.delivery = 'prepared'; },
    (v: any) => { v.materials[0].publication = 'cleared'; },
    (v: any) => { v.materials[0].files = {}; },
    (v: any) => { v.materials[0].id = v.entries[0].id; },
  ]) {
    const invalid = structuredClone(value);
    mutate(invalid);
    assert.throws(() => parseProducerCatalog(invalid), /catalog/i);
  }
});

test('requires an exact immutable pin and keeps producer and asset revisions separate', () => {
  const { pin } = pinned();
  assert.equal(parseProducerPin(pin).revision, '1'.repeat(40));
  assert.equal(producerIndexUrl(pin), `${pin.repository.replace('github.com', 'raw.githubusercontent.com')}/${pin.revision}/${pin.path}`);
  for (const change of [{ schemaVersion: 2 }, { revision: 'main' }, { path: '../index.json' }, { bytes: 0 }, { bytes: 2 ** 30 }, { sha256: 'no' }, { extra: true }]) {
    assert.throws(() => parseProducerPin({ ...pin, ...change }), /pin/i);
  }
});

test('verifies exact bytes before parsing or adapting the producer JSON', async () => {
  const { bytes, pin } = pinned();
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(String(input), producerIndexUrl(pin));
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(init.redirect, 'error');
    return new Response(bytes);
  };
  const catalog = await loadPinnedCatalog(pin, { fetcher });
  assert.equal(catalog.source.revision, snapshot.source.revision);
  await assert.rejects(loadPinnedCatalog({ ...pin, sha256: '0'.repeat(64) }, { fetcher }), /SHA-256 mismatch/);
  const malformed = Buffer.alloc(bytes.length, 32);
  await assert.rejects(loadPinnedCatalog(pin, { fetcher: async () => new Response(malformed) }), /SHA-256 mismatch/);
  const wrongRepository = pinned({ ...fixture(), source: { ...snapshot.source, repository: 'https://github.com/another/repository' } });
  await assert.rejects(loadPinnedCatalog(wrongRepository.pin, { fetcher: async () => new Response(wrongRepository.bytes) }), /repository/);
});

test('rejects failed, redirected, oversized, truncated and corrupt downloads', async () => {
  const { pin, bytes } = pinned();
  const redirected = new Response(bytes);
  Object.defineProperty(redirected, 'redirected', { value: true });
  for (const response of [
    new Response('missing', { status: 404 }),
    new Response(null, { status: 302 }),
    redirected,
    new Response(bytes, { headers: { 'content-length': String(bytes.length + 1) } }),
    new Response(Buffer.alloc(bytes.length + 1)),
    new Response(bytes.subarray(1)),
    new Response(Buffer.alloc(bytes.length)),
  ]) {
    await assert.rejects(loadPinnedCatalog(pin, { fetcher: async () => response }), /HTTP|redirect|byte length|size limit|SHA-256/);
  }
});

test('rejects malformed UTF-8 and JSON even when the pinned byte fingerprint matches', async () => {
  for (const bytes of [Buffer.from([0xff]), Buffer.from('{')]) {
    const { pin } = pinned();
    Object.assign(pin, { bytes: bytes.length, sha256: sha256(bytes) });
    await assert.rejects(loadPinnedCatalog(pin, { fetcher: async () => new Response(bytes) }), /encoded data|JSON|property name/);
  }
});

test('bounds requests and streamed bodies with an abort deadline', async () => {
  const { pin } = pinned();
  const fetcher: typeof fetch = async (_, init) => new Promise((_, reject) => {
    init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
  });
  await assert.rejects(loadPinnedCatalog(pin, { fetcher, timeoutMs: 5 }), /abort|timeout/i);
  await assert.rejects(loadPinnedCatalog(pin, {
    fetcher: async () => new Response(new ReadableStream({ start() {} })),
    timeoutMs: 5,
  }), /abort|timeout/i);
});

test('a response with nonsettling cancellation cannot block rejection', async () => {
  const { pin } = pinned();
  const body = new ReadableStream({ cancel: () => new Promise(() => {}) });
  await assert.rejects(loadPinnedCatalog(pin, {
    fetcher: async () => new Response(body, { status: 404 }),
    timeoutMs: 5,
  }), /HTTP 404/);
});

test('handles decoded HTTP bytes and explicit local input without a sibling dependency', async () => {
  const { pin, bytes } = pinned();
  await loadPinnedCatalog(pin, { fetcher: async () => new Response(bytes, { headers: { 'content-encoding': 'gzip', 'content-length': '4' } }) });
  await mkdir(new URL('../build/catalog-migration/', import.meta.url), { recursive: true });
  const directory = await mkdtemp(fileURLToPath(new URL('../build/catalog-migration/import-', import.meta.url)));
  try {
    const indexFile = path.join(directory, pin.path);
    await mkdir(path.dirname(indexFile), { recursive: true });
    await writeFile(indexFile, bytes);
    const fetcher: typeof fetch = async () => { throw new Error('unexpected network access'); };
    const expected = adaptProducerCatalog(fixture());
    assert.deepEqual(await loadPinnedCatalog(pin, { indexFile, fetcher }), expected);
    assert.deepEqual(await loadPinnedCatalog(pin, { sourceRoot: directory, fetcher }), expected);
    await assert.rejects(loadPinnedCatalog(pin, { sourceRoot: directory, indexFile }), /exclusive|both/);
    const outputFile = path.join(directory, 'output.json');
    await importCatalog(pin, { indexFile, outputFile });
    const before = await readFile(outputFile);
    await importCatalog(pin, { indexFile, outputFile, check: true });
    assert.deepEqual(await readFile(outputFile), before);
    const duplicatePin = path.join(directory, 'duplicate-pin.json');
    await writeFile(duplicatePin, JSON.stringify(pin).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'));
    await assert.rejects(execute(process.execPath, [fileURLToPath(new URL('../scripts/import-catalog.ts', import.meta.url)), '--pin', duplicatePin, '--index', indexFile, '--output', path.join(directory, 'rejected.json')], { timeout: 5000 }), /duplicate JSON key/);
    await assert.rejects(readFile(path.join(directory, 'rejected.json')), { code: 'ENOENT' });
    const confinedRoot = path.join(directory, 'confined');
    await mkdir(confinedRoot);
    await symlink(path.dirname(indexFile), path.join(confinedRoot, 'catalog'));
    await assert.rejects(loadPinnedCatalog(pin, { sourceRoot: confinedRoot }), /escapes/);
    await writeFile(outputFile, JSON.stringify({ ...expected, materials: [{ id: 'changed' }] }));
    await assert.rejects(importCatalog(pin, { indexFile, outputFile, check: true }), /differs/);
    await writeFile(indexFile, Buffer.alloc(bytes.length));
    await assert.rejects(loadPinnedCatalog(pin, { indexFile }), /SHA-256 mismatch/);
    await writeFile(indexFile, bytes.subarray(1));
    await assert.rejects(loadPinnedCatalog(pin, { indexFile }), /byte length/);
    const linkedIndex = path.join(directory, 'linked-index.json');
    await symlink(indexFile, linkedIndex);
    await assert.rejects(loadPinnedCatalog(pin, { indexFile: linkedIndex }), /non-regular/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

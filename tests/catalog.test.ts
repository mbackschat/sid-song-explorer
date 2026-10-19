import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MAX_ASSET_BYTES, parseCatalog } from '../src/catalog.ts';
import { prepareSamples } from '../scripts/prepare-samples.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const snapshot = JSON.parse(await readFile(new URL('../config/catalog.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(snapshot);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('the snapshot retains all four cleared mono downloads and their scoped listening verdicts', () => {
  const catalog = parseCatalog(snapshot);
  const mono = catalog.entries.filter((entry) => entry.target.sidCount === 1);
  assert.equal(catalog.source.revision, '3db086b6963676ef75f34d7f77c3b67232a777fb');
  assert.deepEqual(mono.map((entry) => entry.id), ['rambo-loader-main', 'bach-toccata', 'mozart-minuet', 'instrument-mix']);
  assert.deepEqual(mono.map((entry) => entry.target.model), ['MOS6581', 'MOS8580', 'MOS8580', 'MOS8580']);
  assert.deepEqual(mono.map((entry) => entry.durationSeconds), [193.35884353741497, 88.12292517006803, 146.37780045351474, 10]);
  assert.deepEqual(catalog.materials.map((material) => material.id), ['moon-river', 'pink-panther', 'axel-f', 'ghostbusters']);
  assert.ok(mono.every((entry) => entry.stereo));
  assert.ok(mono.slice(1).every((entry) => entry.analysis.annotations.length === 0 && entry.files.notices));
  const entry = catalog.entries[0];
  assert.equal(entry.id, 'rambo-loader-main');
  assert.equal(entry.files.sid.sha256, '99c61d30de4a27e800d185709192de0af92e6d1f2b2350ff8b80f47d8dc4a8cc');
  assert.equal(entry.files.reference!.sha256, '4d3f3c78a89a384a14244f4ca6a36efe0022ea2f636327619ebc00be93909544');
  assert.match(entry.listening.scope, /cold-start.*not separately/i);
  assert.equal(entry.target.sidCount, 1);
  assert.equal(entry.analysis.timeBasis, 'seconds-from-init');
  assert.equal(entry.analysis.annotations.length, 3);
  assert.ok(entry.analysis.annotations.every((annotation) => annotation.voices.every((voice) => voice >= 1 && voice <= 3)));
});

test('the snapshot adds pinned two-chip performances without inheriting mono evidence', () => {
  const catalog = parseCatalog(snapshot);
  const stereo = catalog.entries.filter((entry) => entry.target.sidCount === 2);
  assert.deepEqual(stereo.map((entry) => entry.id), ['rambo-stereo-main', 'bach-toccata-stereo']);
  assert.deepEqual(stereo.map((entry) => entry.target.model), ['MOS6581', 'MOS8580']);
  assert.ok(stereo.every((entry) => entry.target.secondSidAddress === 54304 && entry.target.baseAddress === 54272));
  assert.ok(stereo.every((entry) => entry.analysis.annotations.length === 0 && entry.analysis.sidSha256 === entry.files.sid.sha256));
  assert.ok(stereo.every((entry) => /2026-10-16/.test(entry.listening.scope) && /stereo WAV/.test(entry.listening.scope)));
  const [rambo, bach] = stereo;
  assert.equal(rambo.durationSeconds, 193.35884353741497);
  assert.equal(rambo.files.sid.bytes, 17937);
  assert.equal(rambo.files.sid.sha256, '0998646302f2f89090976b0d2cfee6b141885f378c10242c3a009ce5741d3727');
  assert.equal(rambo.files.reference, undefined);
  assert.equal(rambo.referenceUrl, `${catalog.source.repository.replace('github.com', 'raw.githubusercontent.com')}/${catalog.source.revision}/samples/rambo-stereo/rambo-stereo-main.wav`);
  assert.match(rambo.rights.license, /GPL-3.0-only/);
  assert.match(rambo.listening.sourceUrl, /rambo-stereo\/main-manifest.json$/);
  assert.equal(bach.durationSeconds, 88.12292517006803);
  assert.equal(bach.files.sid.bytes, 9602);
  assert.equal(bach.files.sid.sha256, '96ba9684c3eea789bab1262bfd233ec87666791d40e8d8ccf8aaeb7a9e151bc4');
  assert.equal(bach.files.reference!.bytes, 15544928);
  assert.equal(bach.files.reference!.sha256, '51796c32439bf93c20d0aa85fcb91e76cdf3e4150bcbe4beb6370ce9953a835c');
  assert.ok(bach.files.notices);
  assert.match(bach.listening.sourceUrl, /bach-toccata\/stereo-manifest.json$/);
  assert.ok(catalog.entries.every((entry) => Object.values(entry.files).every((file) => file.bytes <= MAX_ASSET_BYTES)));
});

test('accepts the bounded two-SID target with six hash-bound annotation voices', () => {
  const value = clone();
  value.entries = [value.entries[0]];
  Object.assign(value.entries[0].target, { sidCount: 2, secondSidAddress: 54304 });
  value.entries[0].analysis.annotations[0].voices = [1, 4, 6];
  assert.equal(parseCatalog(value).entries[0].target.sidCount, 2);
});

test('requires exactly one prepared or pinned external reference and preserves the asset cap', () => {
  const value = clone();
  const entry = value.entries[0];
  entry.referenceUrl = entry.files.reference.url;
  delete entry.files.reference;
  assert.equal(parseCatalog(value).entries[0].referenceUrl, entry.referenceUrl);
  const mutations = [
    (entry: any) => { delete entry.referenceUrl; },
    (entry: any) => { entry.files.reference = structuredClone(snapshot.entries[0].files.reference); },
    (entry: any) => { entry.referenceUrl = 'http://example.com/reference.wav'; },
    (entry: any) => { entry.referenceUrl = entry.referenceUrl.replace(value.source.revision, 'main'); },
    (entry: any) => { entry.referenceUrl = 'https://example.com/reference.wav'; },
    (entry: any) => { entry.files.sid.bytes = MAX_ASSET_BYTES + 1; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(value);
    mutate(invalid.entries[0]);
    assert.throws(() => parseCatalog(invalid), /catalog/i);
  }
});

test('rejects missing, unsupported or contradictory second-chip addresses', () => {
  const mutations = [
    (target: any) => { target.sidCount = 2; },
    (target: any) => { target.secondSidAddress = 54304; },
    (target: any) => { Object.assign(target, { sidCount: 2, secondSidAddress: 54272 }); },
    (target: any) => { Object.assign(target, { sidCount: 2, secondSidAddress: 54336 }); },
    (target: any) => { Object.assign(target, { sidCount: 3, secondSidAddress: 54304 }); },
  ];
  for (const mutate of mutations) {
    const value = clone();
    mutate(value.entries[0].target);
    assert.throws(() => parseCatalog(value), /catalog/i);
  }
});

test('schema 1 keeps the original mono-only snapshot compatible with optional additions', () => {
  const legacy = clone();
  delete legacy.materials;
  legacy.entries = [legacy.entries[0]];
  delete legacy.entries[0].stereo;
  const catalog = parseCatalog(legacy);
  assert.deepEqual(catalog.materials, []);
  assert.equal(catalog.entries[0].stereo, undefined);
  assert.equal(Object.hasOwn(legacy, 'materials'), false);
});

test('rejects unsafe, unpinned or ambiguous stereo and materials metadata', () => {
  const mutations = [
    (value: any) => { value.entries[0].stereo.extra = true; },
    (value: any) => { value.entries[0].stereo.sidUrl = 'http://example.com/stereo.sid'; },
    (value: any) => { value.entries[0].stereo.sidUrl = value.entries[0].stereo.sidUrl.replace(value.source.revision, 'main'); },
    (value: any) => { value.entries[0].stereo.referenceUrl = 'https://example.com/stereo.wav'; },
    (value: any) => { value.materials = {}; },
    (value: any) => { value.materials[0].sourceUrl = value.materials[0].sourceUrl.replace(value.source.revision, 'main'); },
    (value: any) => { value.materials[0].sourceUrl = 'https://example.com/README.md'; },
    (value: any) => { value.materials[0].description = ''; },
    (value: any) => { value.materials[0].audioUrl = 'https://example.com/uncleared.wav'; },
    (value: any) => { value.materials[0].id = value.entries[0].id; },
    (value: any) => { value.materials.push(structuredClone(value.materials[0])); },
    (value: any) => { value.entries[1].files.notices.sha256 = 'not-a-hash'; },
    (value: any) => { value.entries[1].files.notices.filename = '../notices'; },
  ];
  for (const mutate of mutations) {
    const value = clone();
    mutate(value);
    assert.throws(() => parseCatalog(value), /catalog/i);
  }
});

test('rejects incompatible or undeclared contracts', () => {
  const mutations = [
    (value: any) => { value.schemaVersion = 2; },
    (value: any) => { value.extra = true; },
    (value: any) => { value.entries[0].target.clock = 'NTSC'; },
    (value: any) => { value.entries[0].target.sidCount = 2; },
    (value: any) => { value.entries[0].target.model = 'MOS9999'; },
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
    (value: any) => { value.entries[0].analysis.annotations[0].voices = [4]; },
    (value: any) => { Object.assign(value.entries[0].target, { sidCount: 2, secondSidAddress: 54304 }); value.entries[0].analysis.annotations[0].voices = [7]; },
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

async function fixture(entryId = 'rambo-loader-main') {
  await mkdir(path.join(root, 'build'), { recursive: true });
  const directory = await mkdtemp(path.join(root, 'build/catalog-test-'));
  const catalog = clone();
  catalog.entries = [catalog.entries.find((entry: any) => entry.id === entryId)];
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

test('prepares the SID-Wizard license and player notices without fetching stereo or materials links', async () => {
  const value = await fixture('bach-toccata');
  const requests: string[] = [];
  try {
    const result = await prepareSamples(value.catalog, {
      outputDirectory: value.outputDirectory,
      fetcher: async (input) => {
        requests.push(String(input));
        return new Response(new Uint8Array(value.data.get(String(input)) ?? []));
      },
    });
    assert.equal(result.length, 4);
    assert.deepEqual(requests, Object.values(value.catalog.entries[0].files).map((file) => file.url));
    const notices = value.catalog.entries[0].files.notices!;
    assert.equal(sha256(await readFile(path.join(value.outputDirectory, notices.filename))), notices.sha256);
  } finally {
    await rm(value.directory, { recursive: true, force: true });
  }
});

test('prepares a playable two-SID entry without downloading its external reference', async () => {
  const value = await fixture('rambo-stereo-main');
  const requests: string[] = [];
  try {
    const result = await prepareSamples(value.catalog, {
      outputDirectory: value.outputDirectory,
      fetcher: async (input) => {
        requests.push(String(input));
        return new Response(new Uint8Array(value.data.get(String(input)) ?? []));
      },
    });
    assert.equal(result.length, 2);
    assert.deepEqual(requests, Object.values(value.catalog.entries[0].files).map((file) => file.url));
    assert.ok(!requests.includes(value.catalog.entries[0].referenceUrl!));
    const reused = await prepareSamples(value.catalog, { outputDirectory: value.outputDirectory, sourceRoot: '/does-not-exist' });
    assert.ok(reused.every((file) => file.status === 'verified'));
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

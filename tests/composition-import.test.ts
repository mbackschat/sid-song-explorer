import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {importComposition, verifyCompositionTiming} from '../scripts/import-composition.ts';
import {parseCatalog} from '../src/catalog.ts';
import {parseProducerJson} from '../src/producer-catalog.ts';
import {parseCompositionPackage} from '../src/composition-package.ts';

test('composition import is offline, byte-preserving and bound to the catalog', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'composition-import-'));
  try {
    const bytes = await readFile(new URL('../config/composition.json', import.meta.url));
    const catalog = parseCatalog(JSON.parse(await readFile(new URL('../config/catalog.json', import.meta.url), 'utf8')));
    const pin = {schemaVersion: 1, repository: catalog.source.repository, revision: 'a'.repeat(40), path: 'composition.json', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
    const inputFile = path.join(directory, 'input.json');
    const outputFile = path.join(directory, 'output.json');
    await writeFile(inputFile, bytes);
    const pkg = await importComposition(pin, catalog, {inputFile, outputFile});
    assert.equal(pkg.catalogEntryId, 'rambo-loader-main');
    assert.deepEqual(await readFile(outputFile), bytes);
    await assert.rejects(importComposition(pin, catalog, {inputFile, sourceRoot: directory}), /mutually exclusive/);
    await assert.rejects(importComposition({...pin, sha256: '0'.repeat(64)}, catalog, {inputFile}), /SHA-256 mismatch/);
    await assert.rejects(importComposition({...pin, bytes: bytes.length - 1}, catalog, {inputFile}), /byte length/);
    const wrongCatalog = structuredClone(catalog);
    wrongCatalog.entries[0]!.files.sid.sha256 = 'f'.repeat(64);
    await assert.rejects(importComposition(pin, wrongCatalog, {inputFile}), /catalog/);
    await assert.rejects(importComposition({...pin, repository: 'https://github.com/example/other'}, catalog, {inputFile}), /repository/);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('strict composition JSON input rejects duplicate keys before parsing into musical data', () => {
  assert.throws(() => parseProducerJson('{"schemaVersion":1,"schemaVersion":2}'), /duplicate/);
});

test('playback timing is bound to exact package, engine assets, adapter and complete event coverage', async () => {
  const json = async (filename: string) => JSON.parse(await readFile(new URL(`../config/${filename}`, import.meta.url), 'utf8'));
  const pin = await json('composition-pin.json');
  const timing = await json('composition-timing.json');
  const pkg = parseCompositionPackage(await json('composition.json'));
  await verifyCompositionTiming(timing, pin, pkg);
  for (const field of ['moduleSha256', 'wasmSha256', 'sessionSha256']) {
    await assert.rejects(verifyCompositionTiming({...timing, engine: {...timing.engine, [field]: '0'.repeat(64)}}, pin, pkg), /stale/);
  }
  await assert.rejects(verifyCompositionTiming({...timing, packageSha256: '0'.repeat(64)}, pin, pkg), /fingerprint/);
  await assert.rejects(verifyCompositionTiming({...timing, checkedEvents: timing.checkedEvents - 1}, pin, pkg), /coverage/);
});

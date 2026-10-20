import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCatalog} from '../src/catalog.ts';
import {parseCompositionPackage, matchingCompositionPackage, compositionSourceUrl} from '../src/composition-package.ts';
import type {Profile, TuneDetails} from '../src/player-types.ts';

const catalog = parseCatalog(JSON.parse(readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8')));
const entry = catalog.entries[0]!;
const profile: Profile = {clock: 'PAL', model: 'MOS6581', subtune: 1};
const info: TuneDetails = {title: '', author: '', released: '', songs: 1, subtune: 1, clock: 'PAL', model: 'MOS6581', installedSids: 1, channels: 1, sidChipBases: [54272], sampleRate: 44100, registers: []};
const sourcePath = 'docs/research/composition/rambo-preparation.md';
const seconds = (call: number) => (call - 1586) * 19656 / (17734475 / 18);

function fixture() {
  return {
    schemaVersion: 1, id: 'rambo-main', catalogEntryId: entry.id, title: 'Rambo composition',
    source: {...catalog.source, scorePath: 'songs/rambo-loader.json', evidencePath: sourcePath, rightsPath: 'samples/rambo-loader/README.md'},
    binding: {sidSha256: entry.files.sid.sha256, subtune: 1, clock: 'PAL', sidModel: 'MOS6581', sidCount: 1, baseAddress: 54272, routing: 'mono'},
    timing: {sourceStartCall: 1586, callCycles: 19656, clockHz: 17734475 / 18, timeBasis: 'source-call-grid', rule: '(sourceCall-sourceStartCall)*callCycles/clockHz'},
    coverage: {scope: 'selected-passages', wholeSong: false, description: 'Two documented passages.'},
    parts: [{id: 'lead', title: 'Lead', role: 'Melody', evidenceLevel: 'derived', sourcePath}],
    instruments: [{id: 'pulse', title: 'Pulse program', description: 'Source state.', evidenceLevel: 'derived', behavior: ['Pulse motion'], kind: 'source-program-state', program: {data: Array(49).fill(0)}, sourcePath}],
    allocations: [{partId: 'lead', chip: 1, voice: 1}],
    passages: [1700, 1900].map((call, i) => ({
      id: `phrase-${i}`, title: `Phrase ${i + 1}`, sourceStartCall: call, sourceEndCall: call + 100,
      startSeconds: seconds(call), endSeconds: seconds(call + 100), recurrence: i ? {of: 'phrase-0', partIds: ['lead'], relationship: 'same-source-phrase', description: 'Same lead phrase.'} : null,
      description: 'Compare the returning phrase.', evidenceLevel: 'derived', sourcePath,
      events: [{id: `event-${i}`, partId: 'lead', instrumentId: 'pulse', sourceCall: call, endSourceCall: call + 10, startSeconds: seconds(call), endSeconds: seconds(call + 10), pitchIndex: 20, frequencyWord: 3000, nodeId: 'voice-1-row-0001', sourceAddress: 4096, entrySound: Array(39).fill(0), evidenceLevel: 'verified'}],
      dependencies: [{kind: 'shared-chip-filter', partIds: ['lead'], description: 'Chip-wide filter.', sourcePath, evidenceLevel: 'verified'}],
    })),
    rights: {license: 'GPL-3.0-only', attribution: 'Martin Galway; independent Crafter reconstruction.', sourcePath: 'samples/rambo-loader/README.md'},
  };
}

test('accepts a bounded composition and builds immutable evidence links', () => {
  const pkg = parseCompositionPackage(fixture());
  assert.equal(pkg.passages.length, 2);
  assert.equal(compositionSourceUrl(pkg, sourcePath), `${catalog.source.repository}/blob/${catalog.source.revision}/${sourcePath}`);
  assert.equal(matchingCompositionPackage(pkg, entry, profile, info), pkg);
});

test('rejects unsupported schema, unknown fields and unsafe source paths', () => {
  for (const mutate of [
    (x: any) => { x.schemaVersion = 2; },
    (x: any) => { x.instruments[0].recoveredIntent = 'invented'; },
    (x: any) => { x.source.scorePath = '../private.json'; },
    (x: any) => { x.passages[0].sourcePath = 'https://example.com'; },
    (x: any) => { x.source.revision = 'main'; },
    (x: any) => { x.rights.license = 'unknown'; },
  ]) {
    const data = fixture();
    mutate(data);
    assert.throws(() => parseCompositionPackage(data), /composition/i);
  }
});

test('rejects broken musical relationships, recurrence cycles and duplicate identities', () => {
  for (const mutate of [
    (x: any) => { x.passages[0].events[0].instrumentId = 'missing'; },
    (x: any) => { x.passages[0].events[0].partId = 'missing'; },
    (x: any) => { x.passages[0].dependencies[0].partIds = ['missing']; },
    (x: any) => { x.allocations[0].voice = 4; },
    (x: any) => { x.allocations = []; },
    (x: any) => { x.passages[0].recurrence = {of: 'phrase-1', partIds: ['lead'], relationship: 'same-source-phrase', description: 'Cycle.'}; },
    (x: any) => { x.passages[1].events[0].id = x.passages[0].events[0].id; },
    (x: any) => { x.instruments.push(x.instruments[0]); },
    (x: any) => { x.instruments[0].program.data[0] = 256; },
  ]) {
    const data = fixture();
    mutate(data);
    assert.throws(() => parseCompositionPackage(data), /composition/i);
  }
});

test('source-call alignment and coverage are enforced at both passage and event level', () => {
  for (const mutate of [
    (x: any) => { x.passages[0].startSeconds += seconds(1587); },
    (x: any) => { x.passages[0].events[0].endSeconds += 0.02; },
    (x: any) => { x.passages[0].events[0].sourceCall = 1800; x.passages[0].events[0].startSeconds = seconds(1800); },
    (x: any) => { x.passages[0].events[0].endSourceCall = 1700; x.passages[0].events[0].endSeconds = seconds(1700); },
    (x: any) => { x.passages[0].endSeconds = Infinity; },
    (x: any) => { x.coverage.wholeSong = true; },
    (x: any) => { x.timing.sourceStartCall += 1; },
  ]) {
    const data = fixture();
    mutate(data);
    assert.throws(() => parseCompositionPackage(data), /composition/i);
  }
});

test('retains actual onset boundaries of carry-in notes and rejects conflicting shared events', () => {
  const data = fixture();
  const event = data.passages[0]!.events[0]!;
  event.sourceCall = 1695;
  event.startSeconds = seconds(1695);
  event.endSourceCall = 1905;
  event.endSeconds = seconds(1905);
  data.passages[1]!.events.push(structuredClone(event));
  const pkg = parseCompositionPackage(data);
  assert.ok(pkg.passages[0]!.events[0]!.startSeconds < pkg.passages[0]!.startSeconds);
  assert.ok(pkg.passages[0]!.events[0]!.endSeconds > pkg.passages[0]!.endSeconds);
  data.passages[1]!.events[1]!.frequencyWord++;
  assert.throws(() => parseCompositionPackage(data), /conflicting event identity/);
});

test('only the exact loaded catalog export and actual playback profile receive musical labels', () => {
  const pkg = parseCompositionPackage(fixture());
  assert.equal(matchingCompositionPackage(pkg, null, profile, info), null);
  assert.equal(matchingCompositionPackage(pkg, entry, null, info), null);
  assert.equal(matchingCompositionPackage(pkg, entry, profile, null), null);
  for (const mismatch of [
    {...entry, id: 'another-song'},
    {...entry, files: {...entry.files, sid: {...entry.files.sid, sha256: '0'.repeat(64)}}},
    {...entry, durationSeconds: 1},
  ]) assert.equal(matchingCompositionPackage(pkg, mismatch, profile, info), null);
  for (const mismatch of [
    {...profile, model: 'MOS8580' as const}, {...profile, clock: 'NTSC' as const}, {...profile, subtune: 2},
  ]) assert.equal(matchingCompositionPackage(pkg, entry, mismatch, info), null);
  for (const mismatch of [
    {...info, model: 'MOS8580' as const}, {...info, clock: 'NTSC' as const}, {...info, subtune: 2},
    {...info, installedSids: 2}, {...info, sidChipBases: [54304]}, {...info, channels: 2 as const},
  ]) assert.equal(matchingCompositionPackage(pkg, entry, profile, mismatch), null);
});

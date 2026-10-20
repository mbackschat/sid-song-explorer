import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCompositionTiming, projectCompositionPackage, type CompositionTiming} from '../src/composition-time.ts';
import type {CompositionEvent, CompositionPackage} from '../src/composition-package.ts';

function timing(): CompositionTiming {
  return {
    schemaVersion: 1,
    packageSha256: 'a'.repeat(64),
    engine: {moduleSha256: 'b'.repeat(64), wasmSha256: 'c'.repeat(64), sessionSha256: 'd'.repeat(64)},
    sampleRate: 44100,
    cyclesPerSecond: 983981.25,
    anchor: {sourceCall: 5430, timeSeconds: 77.1},
    maxOnsetErrorSeconds: 0.004,
    checkedEvents: 80,
  };
}

function sourcePackage(): CompositionPackage {
  const clockHz = 17_734_475 / 18;
  const timeAt = (sourceCall: number) => (sourceCall - 1586) * 19656 / clockHz;
  const event = (id: string, sourceCall: number, endSourceCall: number): CompositionEvent => ({
    id, partId: 'lead', instrumentId: 'pulse', sourceCall, endSourceCall,
    startSeconds: timeAt(sourceCall), endSeconds: timeAt(endSourceCall), pitchIndex: 40, frequencyWord: 1000,
    nodeId: 'source-node', sourceAddress: 4096, entrySound: Array<number>(39).fill(0), evidenceLevel: 'derived',
  });
  return {
    schemaVersion: 1, id: 'timing-regression', catalogEntryId: 'rambo-loader-main', title: 'Source timing fixture',
    source: {repository: 'https://github.com/example/crafter', revision: 'a'.repeat(40), scorePath: 'songs/score.json', evidencePath: 'docs/study.md', rightsPath: 'LICENSE'},
    binding: {sidSha256: 'e'.repeat(64), subtune: 1, clock: 'PAL', sidModel: 'MOS6581', sidCount: 1, baseAddress: 54272, routing: 'mono'},
    timing: {sourceStartCall: 1586, callCycles: 19656, clockHz, timeBasis: 'source-call-grid', rule: '(sourceCall-sourceStartCall)*callCycles/clockHz'},
    coverage: {scope: 'selected-passages', wholeSong: false, description: 'Two selected source phrases.'},
    parts: [{id: 'lead', title: 'Lead', role: 'Foreground line', evidenceLevel: 'derived', sourcePath: 'docs/study.md#lead'}],
    instruments: [{id: 'pulse', title: 'Pulse state', description: 'Exact source program state.', evidenceLevel: 'derived', behavior: ['The source controls a pulse voice.'], kind: 'source-program-state', program: {data: Array<number>(49).fill(1)}, sourcePath: 'docs/programs.md#pulse'}],
    allocations: [{partId: 'lead', chip: 1, voice: 1}],
    passages: [
      {
        id: 'statement', title: 'Statement', sourceStartCall: 5426, sourceEndCall: 5554,
        startSeconds: timeAt(5426), endSeconds: timeAt(5554), recurrence: null, description: 'First phrase.', evidenceLevel: 'derived',
        events: [event('carry-in', 5425, 5430), event('lead-init', 5430, 5555)], dependencies: [], sourcePath: 'docs/study.md#statement',
      },
      {
        id: 'return', title: 'Return', sourceStartCall: 5554, sourceEndCall: 5682,
        startSeconds: timeAt(5554), endSeconds: timeAt(5682), recurrence: {of: 'statement', partIds: ['lead'], relationship: 'same-source-phrase', description: 'The phrase returns.'}, description: 'Second phrase.', evidenceLevel: 'derived',
        events: [event('lead-init', 5430, 5555), event('next-init', 5555, 5683)], dependencies: [], sourcePath: 'docs/study.md#return',
      },
    ],
    rights: {license: 'GPL-3.0-only', attribution: 'Source fixture attribution', sourcePath: 'LICENSE'},
  };
}

test('calibration accepts only the bounded PAL SIDLite PCM profile and exact fingerprint fields', () => {
  assert.deepEqual(parseCompositionTiming(timing()), timing());
  const invalid: ((value: any) => void)[] = [
    value => { value.schemaVersion = 2; },
    value => { value.sampleRate = 48000; },
    value => { value.cyclesPerSecond = 17_734_475 / 18; },
    value => { value.packageSha256 = 'a'.repeat(63); },
    value => { value.engine.wasmSha256 = 'C'.repeat(64); },
    value => { delete value.engine.sessionSha256; },
    value => { value.engine.extra = 'unbound'; },
    value => { value.extra = true; },
    value => { value.anchor.extra = 1; },
    value => { value.anchor.sourceCall = -1; },
    value => { value.anchor.sourceCall = 1.5; },
    value => { value.anchor.sourceCall = 1_000_001; },
    value => { value.anchor.timeSeconds = -0.01; },
    value => { value.anchor.timeSeconds = Infinity; },
    value => { value.anchor.timeSeconds = 600.01; },
    value => { value.maxOnsetErrorSeconds = -0.001; },
    value => { value.maxOnsetErrorSeconds = 0.010001; },
    value => { value.maxOnsetErrorSeconds = NaN; },
    value => { value.checkedEvents = 0; },
    value => { value.checkedEvents = 1.5; },
    value => { value.checkedEvents = 100_001; },
  ];
  for (const mutate of invalid) {
    const value = structuredClone(timing());
    mutate(value);
    assert.throws(() => parseCompositionTiming(value), /Invalid composition timing/);
  }
  for (const value of [null, [], true, 'timing']) assert.throws(() => parseCompositionTiming(value), /Invalid composition timing/);
});

test('projection derives every endpoint from source calls without mutating nominal source evidence', () => {
  const pkg = sourcePackage();
  const before = structuredClone(pkg);
  const calibration = timing();
  const projected = projectCompositionPackage(pkg, calibration);
  const expected = (call: number) => 77.1 + (call - 5430) * 19656 / 983981.25;
  for (const passage of projected.passages) {
    assert.equal(passage.startSeconds, expected(passage.sourceStartCall));
    assert.equal(passage.endSeconds, expected(passage.sourceEndCall));
    for (const event of passage.events) {
      assert.equal(event.startSeconds, expected(event.sourceCall));
      assert.equal(event.endSeconds, expected(event.endSourceCall));
    }
  }
  assert.equal(projected.passages[0]!.events[1]!.startSeconds, calibration.anchor.timeSeconds);
  assert.equal(projected.passages[0]!.endSeconds, projected.passages[1]!.startSeconds);
  assert.ok(projected.passages[0]!.events[0]!.startSeconds < projected.passages[0]!.startSeconds);
  assert.ok(projected.passages[0]!.events[1]!.endSeconds > projected.passages[0]!.endSeconds);
  assert.ok(projected.passages[1]!.events[0]!.startSeconds < projected.passages[1]!.startSeconds);
  assert.deepEqual(pkg, before);
  assert.deepEqual(projected.source, pkg.source);
  assert.deepEqual(projected.sourceTiming, pkg.timing);
  assert.deepEqual(projected.timing, {timeBasis: 'sidlite-pcm', sampleRate: calibration.sampleRate, maxOnsetErrorSeconds: calibration.maxOnsetErrorSeconds});
  assert.equal(pkg.timing.timeBasis, 'source-call-grid');
  assert.notEqual(projected.instruments[0]!.program.data, pkg.instruments[0]!.program.data);
  assert.notEqual(projected.passages[0]!.startSeconds, pkg.passages[0]!.startSeconds);
});

test('projection rejects unsupported source profiles, invalid calibration and non-positive intervals', () => {
  const changes: ((value: any) => void)[] = [
    value => { value.binding.clock = 'NTSC'; },
    value => { value.binding.sidModel = 'MOS8580'; },
    value => { value.binding.sidCount = 2; },
    value => { value.binding.routing = 'sid-a-left-sid-b-right'; },
    value => { value.binding.subtune = 2; },
    value => { value.binding.baseAddress = 54304; },
    value => { value.timing.callCycles = 19655; },
    value => { value.timing.clockHz = 985248; },
    value => { value.passages[0].sourceEndCall = value.passages[0].sourceStartCall; },
    value => { value.passages[0].events[0].endSourceCall = value.passages[0].events[0].sourceCall; },
    value => { value.passages[0].events[0].sourceCall = NaN; },
  ];
  for (const change of changes) {
    const pkg = sourcePackage();
    change(pkg);
    assert.throws(() => projectCompositionPackage(pkg, timing()), /Invalid composition timing/);
  }
  const negative = timing();
  negative.anchor = {sourceCall: 10_000, timeSeconds: 0};
  assert.throws(() => projectCompositionPackage(sourcePackage(), negative), /Invalid composition timing/);
  const uncalibrated = timing();
  uncalibrated.checkedEvents = 0;
  assert.throws(() => projectCompositionPackage(sourcePackage(), uncalibrated), /Invalid composition timing/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { positionAt, trimHistory, validateLoop, followingWindow, visibleTimelineFrames, fittedWindow, observationRegistersAt, composeTimelineObservations } from '../src/timeline.ts';
import type { DisplayedObservation } from '../src/timeline.ts';

test('heard position follows audio time, not the emulation cursor, across a loop', () => {
  const segments = [
    {contextStart: 1, contextEnd: 2, mediaStart: 9, mediaEnd: 10},
    {contextStart: 2.3, contextEnd: 3.3, mediaStart: 4, mediaEnd: 5},
  ];
  assert.equal(positionAt(segments, 0.9, 9), 9);
  assert.equal(positionAt(segments, 1.5, 9), 9.5);
  assert.equal(positionAt(segments, 2.15, 9), 10);
  assert.equal(positionAt(segments, 2.5, 9), 4.2);
  assert.equal(positionAt(segments, 4, 9), 5);
});

test('retention bounds writes while keeping a held copy independent', () => {
  const live = [1, 2, 3, 4];
  const held = live.slice();
  assert.equal(trimHistory(live, 2), 2);
  assert.deepEqual(live, [3, 4]);
  assert.deepEqual(held, [1, 2, 3, 4]);
});

test('loop admission rejects invalid ranges before emulator work', () => {
  for (const loop of [{start: -1, end: 2}, {start: 2, end: 2}, {start: 3, end: 2}, {start: 0, end: Infinity}, {start: NaN, end: 2}, {start: 0, end: 12}]) {
    assert.throws(() => validateLoop(loop, 10));
  }
  assert.deepEqual(validateLoop({start: 1, end: 2}, 10), {start: 1, end: 2});
  assert.equal(validateLoop(null, 10), null);
});


test('the following window centers heard time across startup, ending and backwards seeks', () => {
  for (const position of [0, 5, 10, 30, 193, 2]) {
    const window = followingWindow(position);
    assert.equal(window.end - window.start, 10);
    assert.equal(window.start, position - 5);
    assert.equal((position - window.start) / (window.end - window.start), .5);
    assert.ok(position >= window.start && position <= window.end);
  }
});

test('timeline density preserves time scale across widths and zoom levels', () => {
  for (const pixelsPerSecond of [16, 32, 64, 128, 256, 512, 1024]) {
    for (const width of [240, 640, 1280]) {
      const span = width / pixelsPerSecond;
      const window = followingWindow(30, span);
      assert.equal(window.end - window.start, span);
      assert.equal((window.start + window.end) / 2, 30);
      const doubled = followingWindow(30, width * 2 / pixelsPerSecond);
      assert.equal(doubled.end - doubled.start, span * 2);
    }
  }
});

test('visible drawing retains its boundary state without losing resolution to older history', () => {
  const recent = [{time: 19, value: 1}, {time: 22, value: 2}, {time: 26, value: 3}, {time: 31, value: 4}];
  const older = Array.from({length: 1500}, (_, index) => ({time: index / 100, value: 0}));
  const expected = [{time: 20, value: 1}, {time: 22, value: 2}, {time: 26, value: 3}, {time: 30, value: 3}];
  assert.deepEqual(visibleTimelineFrames(recent, 20, 30), expected);
  assert.deepEqual(visibleTimelineFrames([...older, ...recent], 20, 30), expected);
  assert.deepEqual(visibleTimelineFrames(recent, 27, 30), [{time: 27, value: 3}, {time: 30, value: 3}]);
  assert.deepEqual(visibleTimelineFrames(recent, 0, 10), []);
  assert.equal(recent[0].time, 19);
});


test('fit history expands with retained playback and includes a held selection', () => {
  assert.deepEqual(fittedWindow(0, 5), {start: 0, end: 10});
  assert.deepEqual(fittedWindow(0, 30), {start: 0, end: 30});
  assert.deepEqual(fittedWindow(12, 45), {start: 12, end: 45});
  assert.deepEqual(fittedWindow(30, 32), {start: 30, end: 40});
  assert.deepEqual(fittedWindow(30, 40, {start: 5, end: 50}), {start: 5, end: 50});
});

test('inspection reconstructs ordered settings without extrapolating unavailable preview time', () => {
  const observation = {
    start: 10, end: 12, dropped: 0,
    frames: [{time:10, registers:Array<number>(32).fill(0)}],
    writes: [
      {timeSeconds:10.5, cyclePhi1:1, address:4, value:17, sidNumber:0},
      {timeSeconds:10.5, cyclePhi1:2, address:4, value:33, sidNumber:0},
      {timeSeconds:11, cyclePhi1:3, address:0xd404, value:65, sidNumber:0},
    ],
  };
  assert.equal(observationRegistersAt(observation, 9), null);
  assert.equal(observationRegistersAt(observation, 12), null);
  assert.equal(observationRegistersAt(observation, 13, true), null);
  assert.equal(observationRegistersAt(observation, 10.4)?.[4], 0);
  assert.equal(observationRegistersAt(observation, 10.5)?.[4], 33);
  assert.equal(observationRegistersAt(observation, 11.5)?.[4], 65);
  assert.equal(observationRegistersAt(observation, 12, true)?.[4], 65);
  assert.equal(observation.frames[0].registers[4], 0);
});

test('inspection keeps each chip’s ordered writes inside its own register bank', () => {
  const observation = {
    start: 10, end: 12, dropped: 0,
    frames: [{time: 10, registers: Array<number>(64).fill(0)}],
    writes: [
      {timeSeconds: 10.5, cyclePhi1: 1, address: 4, value: 33, sidNumber: 0},
      {timeSeconds: 10.5, cyclePhi1: 2, address: 4, value: 65, sidNumber: 1},
      {timeSeconds: 11, cyclePhi1: 3, address: 22, value: 127, sidNumber: 1},
      {timeSeconds: 11, cyclePhi1: 4, address: 32, value: 255, sidNumber: 0},
      {timeSeconds: 11, cyclePhi1: 5, address: 4, value: 255, sidNumber: 2},
    ],
  };
  const registers = observationRegistersAt(observation, 11)!;
  assert.equal(registers[4], 33);
  assert.equal(registers[36], 65);
  assert.equal(registers[54], 127);
  assert.equal(registers[22], 0);
  assert.equal(registers[32], 0);
  assert.deepEqual(observation.frames[0].registers, Array<number>(64).fill(0));
});

function observedRange(start: number, end: number, frameTimes: number[], dropped = 0): DisplayedObservation {
  const writes = Array.from({length: 20}, (_, index) => ({
    timeSeconds: index / 2, cyclePhi1: index + 1, address: 4,
    value: index + 1, sidNumber: index % 2,
  }));
  const registersAt = (time: number) => {
    const registers = Array<number>(64).fill(0);
    for (const write of writes) if (write.timeSeconds < time) registers[write.sidNumber * 32 + write.address] = write.value;
    return registers;
  };
  return {
    start, end, endInclusive: false, dropped,
    frames: frameTimes.map(time => ({time, registers: registersAt(time)})),
    writes: writes.filter(write => write.timeSeconds >= start && write.timeSeconds < end),
  };
}

test('live observations retain scheduled history when the PCM preview starts ahead of heard playback', () => {
  const retained = observedRange(0, 6.25, [0, 1, 2, 3, 4, 5, 6]);
  const prepared = observedRange(6, 9, [6, 7, 8, 9]);
  const combined = composeTimelineObservations(retained, prepared);
  const continuous = observedRange(0, 9, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(combined.start, 0);
  assert.equal(combined.end, 9);
  assert.equal(combined.endInclusive, false);
  assert.deepEqual(combined.writes, continuous.writes);
  for (const time of [0, 2.25, 5.5, 6, 6.25, 6.5, 8.99]) {
    assert.deepEqual(observationRegistersAt(combined, time), observationRegistersAt(continuous, time));
  }
  assert.equal(observationRegistersAt(combined, 6.5)?.[36], 14);
  assert.equal(observationRegistersAt(combined, 9), null);
  assert.equal(new Set(combined.frames.map(frame => frame.time)).size, combined.frames.length);
});

test('adjacent and enclosing observation ranges preserve boundaries without duplicate writes', () => {
  for (const [retained, prepared] of [
    [observedRange(0, 4, [0, 1, 2, 3, 4]), observedRange(4, 8, [4, 5, 6, 7, 8])],
    [observedRange(2, 6, [2, 3, 4, 5, 6]), observedRange(0, 8, [0, 1, 2, 3, 4, 5, 6, 7, 8])],
    [observedRange(0, 8, [0, 1, 2, 3, 4, 5, 6, 7, 8]), observedRange(2, 6, [2, 3, 4, 5, 6])],
  ]) {
    const combined = composeTimelineObservations(retained, prepared);
    const continuous = observedRange(0, 8, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(combined.writes, continuous.writes);
    assert.equal(new Set(combined.frames.map(frame => frame.time)).size, combined.frames.length);
    for (const time of [0, 2, 3.5, 4, 5.5, 6, 7.99]) {
      assert.deepEqual(observationRegistersAt(combined, time), observationRegistersAt(continuous, time));
    }
  }
});

test('disjoint or incompatible observations cannot fabricate a bridge', () => {
  const prepared = observedRange(6, 9, [6, 7, 8, 9]);
  for (const retained of [observedRange(0, 5, [0, 1, 2, 3, 4, 5]), observedRange(9.5, 10, [9.5, 10])]) {
    const combined = composeTimelineObservations(retained, prepared);
    assert.equal(combined, prepared);
    assert.equal(observationRegistersAt(combined, 5.5), null);
    assert.equal(observationRegistersAt(combined, 9.25), null);
  }
  const mono = observedRange(0, 7, [0, 1, 2, 3, 4, 5, 6, 7]);
  mono.frames = mono.frames.map(frame => ({...frame, registers: frame.registers.slice(0, 32)}));
  assert.equal(composeTimelineObservations(mono, prepared), prepared);
});

test('composed observations retain loss warnings and independent held snapshots within their source bounds', () => {
  const retained = observedRange(2, 6, [2, 3, 4, 5, 6], 7);
  retained.start = 2.25;
  const prepared = observedRange(5, 8, [5, 6, 7, 8], 3);
  const combined = composeTimelineObservations(retained, prepared);
  const held = structuredClone(combined);
  const expected = observedRange(2.25, 8, [2.25, 3, 4, 5, 6, 7, 8]);
  assert.equal(combined.dropped, 7);
  assert.equal(combined.start, 2.25);
  assert.deepEqual(observationRegistersAt(combined, 2.25), observationRegistersAt(expected, 2.25));
  assert.equal(observationRegistersAt(combined, 2.24), null);
  retained.frames[0].registers[4] = 255;
  prepared.frames[0].registers[36] = 255;
  assert.deepEqual(observationRegistersAt(held, 5.5), observationRegistersAt(expected, 5.5));
  assert.equal(retained.frames.length, 5);
  assert.equal(prepared.frames.length, 4);
});

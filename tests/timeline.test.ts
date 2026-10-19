import test from 'node:test';
import assert from 'node:assert/strict';
import { positionAt, trimHistory, validateLoop, followingWindow, visibleTimelineFrames, fittedWindow, observationRegistersAt } from '../src/timeline.ts';

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

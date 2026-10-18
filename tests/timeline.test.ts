import test from 'node:test';
import assert from 'node:assert/strict';
import { positionAt, trimHistory, validateLoop } from '../src/timeline.ts';

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

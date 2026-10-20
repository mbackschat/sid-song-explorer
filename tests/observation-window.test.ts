import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectObservationWindow } from '../src/engine/observation-window.ts';
import type { TimelineObservation, WriteObservation } from '../src/player-types.ts';
import { observationRegistersAt } from '../src/timeline.ts';

const observedWrites: WriteObservation[] = [0, 0.1, 0.499, 0.5, 0.99, 1, 1.001, 1.9, 2, 2.1, 2.999].map((timeSeconds, index) => ({
  timeSeconds, cyclePhi1: index + 1, address: index % 3, value: index + 1, sidNumber: index % 2,
}));

function registersAt(time: number, inclusive = false): number[] {
  const registers = Array<number>(64).fill(0);
  for (const write of observedWrites) {
    if (write.timeSeconds < time || inclusive && write.timeSeconds === time) {
      registers[write.sidNumber * 32 + write.address] = write.value;
    }
  }
  return registers;
}

function packet(start: number, end: number, continuationStart?: number): TimelineObservation {
  return {
    start, end, dropped: 0,
    frames: Array.from({length: 5}, (_, index) => {
      const time = start + (end - start) * index / 4;
      return {time, registers: registersAt(time)};
    }),
    writes: observedWrites.filter(write => write.timeSeconds >= start && write.timeSeconds < end),
    ...(continuationStart === undefined ? {} : {continuationStart}),
  };
}

test('a complete observation preserves its response object and fixed request end', async () => {
  const observation = packet(0, 3);
  const calls: number[][] = [];
  const result = await collectObservationWindow(0, 3, async (start, end) => {
    calls.push([start, end]);
    return observation;
  }, () => true);
  assert.equal(result, observation);
  assert.deepEqual(calls, [[0, 3]]);
});

test('explicit packet continuations retain exact writes and register inspection across seams', async () => {
  const packets = [packet(0, 1, 1), packet(1, 2, 2), packet(2, 3)];
  packets[0].dropped = 7;
  packets[1].dropped = 7;
  packets[2].dropped = 3;
  const original = structuredClone(packets);
  const calls: number[][] = [];
  const result = await collectObservationWindow(0, 3, async (start, end) => {
    calls.push([start, end]);
    return packets[calls.length - 1];
  }, () => true);
  assert.ok(result);
  assert.deepEqual(calls, [[0, 3], [1, 3], [2, 3]]);
  assert.equal(result.start, 0);
  assert.equal(result.end, 3);
  assert.equal(result.dropped, 7);
  assert.equal(result.continuationStart, undefined);
  assert.deepEqual(result.writes, observedWrites);
  assert.equal(new Set(result.frames.map(frame => frame.time)).size, result.frames.length);
  assert.equal(result.frames[0], packets[0].frames[0]);
  assert.equal(result.frames.at(-1), packets[2].frames.at(-1));
  for (const time of [0, 0.333, 0.999, 1, 1.0001, 1.123, 1.999, 2, 2.5, 2.999]) {
    assert.deepEqual(observationRegistersAt(result, time), registersAt(time, true), `inspection at ${time}`);
  }
  assert.deepEqual(result.frames.at(-1)!.registers, registersAt(3));
  assert.equal(observationRegistersAt(result, 3), null);
  assert.deepEqual(packets, original, 'collection must not alter packet arrays or register baselines');
});

test('a partial source frontier does not imply another page is available', async () => {
  const observation = packet(2, 3);
  let calls = 0;
  const result = await collectObservationWindow(0, 10, async () => {
    calls++;
    return observation;
  }, () => true);
  assert.equal(result, observation);
  assert.equal(calls, 1);
});

test('a cold observation returns null without retrying', async () => {
  let calls = 0;
  const result = await collectObservationWindow(0, 10, async () => {
    calls++;
    return null;
  }, () => true);
  assert.equal(result, null);
  assert.equal(calls, 1);
});

test('a source frontier after a continuation replaces the packet marker with its actual coverage', async () => {
  let calls = 0;
  const result = await collectObservationWindow(0, 3, async () => ++calls === 1 ? packet(0, 1, 1) : packet(1, 1.5), () => true);
  assert.ok(result);
  assert.equal(calls, 2);
  assert.equal(result.end, 1.5);
  assert.equal(result.continuationStart, undefined);
  assert.deepEqual(result.writes, observedWrites.filter(write => write.timeSeconds < 1.5));
});

for (const [name, next] of [
  ['missing source', null],
  ['a source gap', packet(1.1, 2)],
  ['an overlapping packet', packet(0.9, 2)],
  ['no progress', packet(1, 1, 1)],
] as const) {
  test(`pagination retains its honest prefix after ${name}`, async () => {
    const first = packet(0, 1, 1);
    let calls = 0;
    const result = await collectObservationWindow(0, 3, async () => ++calls === 1 ? first : next, () => true);
    assert.equal(calls, 2);
    assert.equal(result, first);
    assert.equal(result.end, 1);
    assert.equal(result.continuationStart, 1);
  });
}

test('an obsolete window does not start an observation request', async () => {
  let calls = 0;
  const result = await collectObservationWindow(0, 3, async () => {
    calls++;
    return packet(0, 1, 1);
  }, () => false);
  assert.equal(result, null);
  assert.equal(calls, 0);
});

for (const obsoleteAfter of [1, 2]) {
  test(`an obsolete reply after packet ${obsoleteAfter} discards the accumulator without requesting another packet`, async () => {
    let calls = 0;
    let current = true;
    const result = await collectObservationWindow(0, 3, async () => {
      const observation = packet(calls, calls + 1, calls + 1);
      calls++;
      if (calls === obsoleteAfter) current = false;
      return observation;
    }, () => current);
    assert.equal(result, null);
    assert.equal(calls, obsoleteAfter);
  });
}

test('ten bounded packets retain every write while selecting at most 1001 exact register frames', async () => {
  const packets: TimelineObservation[] = [];
  const calls: number[][] = [];
  const result = await collectObservationWindow(0, 20, async (start, end) => {
    calls.push([start, end]);
    const writes = Array.from({length: 20_000}, (_, index) => ({
      timeSeconds: start + (index + 1) / 20_001, cyclePhi1: start * 20_000 + index,
      address: index % 25, value: index % 256, sidNumber: index % 2,
    }));
    const registers = packets.at(-1)?.frames.at(-1)!.registers.slice() ?? Array<number>(64).fill(0);
    let offset = 0;
    const observation: TimelineObservation = {
      start, end: start + 1, continuationStart: start + 1, dropped: 0,
      frames: Array.from({length: 201}, (_, index) => {
        const time = start + index / 200;
        while (offset < writes.length && writes[offset].timeSeconds < time) {
          const write = writes[offset++];
          registers[write.sidNumber * 32 + write.address] = write.value;
        }
        return {time, registers: registers.slice()};
      }),
      writes,
    };
    packets.push(observation);
    return observation;
  }, () => true);
  assert.ok(result);
  assert.equal(calls.length, 10);
  assert.ok(calls.every(([start, end], index) => start === index && end === 20));
  assert.equal(result.start, 0);
  assert.equal(result.end, 10);
  assert.equal(result.continuationStart, 10);
  assert.equal(result.writes.length, 200_000);
  const sourceWrites = packets.flatMap(observation => observation.writes);
  assert.ok(result.writes.every((write, index) => write === sourceWrites[index]));
  assert.equal(result.frames.length, 1001);
  assert.equal(result.frames[0], packets[0].frames[0]);
  assert.equal(result.frames.at(-1), packets[9].frames.at(-1));
  assert.ok(result.frames.every((frame, index, frames) => !index || frames[index - 1].time < frame.time));
  const sourceFrames = new Set(packets.flatMap(observation => observation.frames));
  assert.ok(result.frames.every(frame => sourceFrames.has(frame)), 'downsampling must select exact source baselines');
  for (const time of [0, 0.49, 0.999, 1, 4.456789, 8.999, 9.999]) {
    const expected = Array<number>(64).fill(0);
    for (const write of sourceWrites) {
      if (write.timeSeconds > time) break;
      expected[write.sidNumber * 32 + write.address] = write.value;
    }
    assert.deepEqual(observationRegistersAt(result, time), expected, `downsampled inspection at ${time}`);
  }
});

test('the request budget stops pagination even when packet write counts remain small', async () => {
  let calls = 0;
  const result = await collectObservationWindow(0, 20, async start => {
    calls++;
    return packet(start, start + 1, start + 1);
  }, () => true);
  assert.ok(result);
  assert.equal(calls, 10);
  assert.equal(result.end, 10);
  assert.equal(result.continuationStart, 10);
  assert.equal(result.writes.length, observedWrites.length);
});

for (const continuationStart of [0, 0.5, 1.5, NaN, Infinity]) {
  test(`an inconsistent continuation ${continuationStart} does not trigger another request`, async () => {
    let calls = 0;
    const first = packet(0, 1, continuationStart);
    const result = await collectObservationWindow(0, 3, async () => {
      calls++;
      return first;
    }, () => true);
    assert.equal(calls, 1);
    assert.equal(result, first);
  });
}

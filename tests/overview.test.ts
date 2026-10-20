import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CachedSidSession } from '../src/engine/cached-session.ts';
import { collectObservationWindow } from '../src/engine/observation-window.ts';
import { SAMPLE_RATE, SidSession } from '../src/engine/session.ts';
import type { PlaybackOptions, SidWrite } from '../src/engine/session.ts';

const options: PlaybackOptions = {clock: 'PAL', model: 'MOS6581', subtune: 1};
const sample = () => new Uint8Array(readFileSync('public/generated/rambo-loader-main.sid'));
const cacheState = (cached: CachedSidSession) => [
  cached.positionFrame, cached.renderedFrame, cached.cacheStartFrame, cached.cacheEndFrame, cached.cacheBytes,
];

test('sampled overview reaches the complete prepared frontier beyond the exact-write window cap', async context => {
  const cached = await CachedSidSession.create();
  try {
    const info = await cached.load(sample(), options);
    const initial = info.registers.slice();
    const registers = initial.slice();
    const continuousWrites: SidWrite[] = [];
    let producedFrame = 0;
    let forbidExecution = false;
    context.mock.method(SidSession.prototype, 'render', (frames: number) => {
      assert.equal(forbidExecution, false, 'overview must not execute the source');
      const startFrame = producedFrame;
      producedFrame += frames;
      const writes = Array.from({length: 625}, (_, index) => {
        const ordinal = continuousWrites.length + index;
        return {
          timeSeconds: startFrame / SAMPLE_RATE + (index + 0.5) / 2500,
          cyclePhi1: ordinal * 32, address: ordinal % 32, value: ordinal * 37 % 256, sidNumber: 0,
        };
      });
      for (const write of writes) registers[write.address] = write.value;
      continuousWrites.push(...writes);
      return {startFrame, endFrame: producedFrame, pcm: new Int16Array(frames), writes, registers: registers.slice(), dropped: startFrame === SAMPLE_RATE / 4 ? 7 : 0};
    });
    while (cached.renderedFrame < 88 * SAMPLE_RATE) assert.ok(cached.prefetch(SAMPLE_RATE / 4));
    assert.equal(continuousWrites.length, 220_000);
    const before = cacheState(cached);
    forbidExecution = true;
    context.mock.method(SidSession.prototype, 'seek', async () => { throw new Error('overview must not seek the source'); });
    const exactWindow = await collectObservationWindow(0, 88, async (start, end) => cached.observe(start, end), () => true);
    assert.ok(exactWindow);
    assert.ok(exactWindow.end < 88);
    assert.equal(exactWindow.writes.length, 200_000);
    const started = performance.now();
    const overview = cached.overview(0, 88);
    const elapsed = performance.now() - started;
    assert.ok(overview);
    assert.equal(overview.start, 0);
    assert.equal(overview.end, 88);
    assert.equal(overview.dropped, 7);
    assert.equal(overview.frames.length, 1001);
    assert.equal(overview.frames[0].time, 0);
    assert.equal(overview.frames.at(-1)!.time, 88);
    assert.equal('writes' in overview, false);
    assert.equal('pcm' in overview, false);
    const expected = initial.slice();
    let nextWrite = 0;
    for (const frame of overview.frames) {
      while (nextWrite < continuousWrites.length && continuousWrites[nextWrite].timeSeconds < frame.time) {
        const write = continuousWrites[nextWrite++];
        expected[write.address] = write.value;
      }
      assert.deepEqual(frame.registers, expected, `continuous register state immediately before ${frame.time}`);
    }
    assert.deepEqual(cacheState(cached), before);
    const original = structuredClone(overview);
    overview.frames[0].registers.fill(255);
    overview.frames[0].time = 10;
    assert.deepEqual(cached.overview(0, 88), original);
    assert.deepEqual(cacheState(cached), before);
    context.diagnostic(`88-second overview=${elapsed.toFixed(3)}ms; frames=${original.frames.length}; response JSON=${Buffer.byteLength(JSON.stringify(original))} bytes; retained writes=${continuousWrites.length}; exact window ends=${exactWindow.end}`);
  } finally {
    cached.dispose();
  }
});

test('overview exposes only retained coverage and preserves cache and lifecycle bounds', async context => {
  const cached = await CachedSidSession.create({maxCacheBytes: 8192});
  try {
    assert.throws(() => cached.overview(0, 1), /load/i);
    await cached.load(sample(), options);
    assert.equal(cached.overview(0, 600), null);
    cached.prefetch(11025);
    const partial = cached.overview(0, 600)!;
    assert.equal(partial.start, 0);
    assert.equal(partial.end, cached.cacheEndFrame / SAMPLE_RATE);
    assert.equal(cached.overview(partial.end, partial.end + 1), null);
    await cached.seek(0.217319);
    cached.render(317);
    assert.ok(cached.cacheStartFrame > 0);
    const before = cacheState(cached);
    context.mock.method(SidSession.prototype, 'render', () => { throw new Error('overview must not execute the source'); });
    context.mock.method(SidSession.prototype, 'seek', async () => { throw new Error('overview must not seek the source'); });
    const retained = cached.overview(0, 1)!;
    assert.equal(retained.start, cached.cacheStartFrame / SAMPLE_RATE);
    assert.equal(retained.end, cached.cacheEndFrame / SAMPLE_RATE);
    assert.equal(cached.overview(0, retained.start), null);
    const exact = cached.observe(0, 1)!;
    assert.deepEqual(retained.frames, exact.frames);
    assert.equal(retained.dropped, exact.dropped);
    for (const [start, end] of [[-1, 1], [0, 0], [1, 0], [NaN, 1], [0, Infinity], [0, 600.001], [599, 601]]) {
      assert.throws(() => cached.overview(start, end), /range|seconds/i);
    }
    assert.deepEqual(cacheState(cached), before);
  } finally {
    cached.dispose();
  }
  assert.throws(() => cached.overview(0, 1), /disposed/);
});

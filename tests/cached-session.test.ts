import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CachedSidSession } from '../src/engine/cached-session.ts';
import { SAMPLE_RATE, SidSession } from '../src/engine/session.ts';
import type { PlaybackOptions, RenderResult } from '../src/engine/session.ts';
import type { TimelineObservation } from '../src/player-types.ts';

const options: PlaybackOptions = { clock: 'PAL', model: 'MOS6581', subtune: 1 };
const sample = () => new Uint8Array(readFileSync('public/generated/rambo-loader-main.sid'));

async function loaded(maxCacheBytes?: number) {
  const cached = await CachedSidSession.create({ maxCacheBytes });
  const oracle = await SidSession.create();
  await cached.load(sample(), options);
  await oracle.load(sample(), options);
  return { cached, oracle };
}

function sameRender(actual: RenderResult, expected: RenderResult): void {
  assert.deepEqual(actual, expected);
}

test('prepared observations match continuous rendering without executing or changing the audio cache', async (context) => {
  const { cached, oracle } = await loaded();
  const originalRender = SidSession.prototype.render;
  const originalSeek = SidSession.prototype.seek;
  try {
    assert.equal(cached.observe(0, 10), null);
    for (let index = 0; index < 5; index++) cached.prefetch(11025);
    const continuous = oracle.render(cached.renderedFrame);
    const before = [cached.positionFrame, cached.renderedFrame, cached.cacheStartFrame, cached.cacheEndFrame, cached.cacheBytes];
    SidSession.prototype.render = () => { throw new Error('observation must not render'); };
    SidSession.prototype.seek = async () => { throw new Error('observation must not seek'); };
    const started = performance.now();
    const observation = cached.observe(0.173219, 1.017319);
    const elapsed = performance.now() - started;
    assert.ok(observation);
    assert.equal(observation.start, 0.173219);
    assert.equal(observation.end, 1.017319);
    assert.deepEqual(observation.writes, continuous.writes.filter((write) => write.timeSeconds >= observation.start && write.timeSeconds < observation.end));
    for (const frame of observation.frames) {
      const registers = Array<number>(32).fill(0);
      for (const write of continuous.writes) {
        if (write.timeSeconds >= frame.time) break;
        registers[write.address] = write.value;
      }
      assert.deepEqual(frame.registers, registers, `continuous register state at ${frame.time}`);
    }
    assert.equal(observation.frames[0].time, observation.start);
    assert.equal(observation.frames.at(-1)!.time, observation.end);
    assert.ok(observation.frames.every((frame, index, frames) => !index || frame.time - frames[index - 1].time <= 0.020001));
    assert.equal('pcm' in observation, false);
    assert.deepEqual([cached.positionFrame, cached.renderedFrame, cached.cacheStartFrame, cached.cacheEndFrame, cached.cacheBytes], before);
    const repeated = structuredClone(observation);
    observation.frames[0].registers[0] ^= 255;
    observation.writes[0].value ^= 255;
    assert.deepEqual(cached.observe(repeated.start, repeated.end), repeated, 'observers own their returned arrays');
    context.diagnostic(`preview=${elapsed.toFixed(3)}ms; response JSON=${Buffer.byteLength(JSON.stringify(repeated))} bytes; cache=${cached.cacheBytes} bytes`);
    SidSession.prototype.render = originalRender;
    SidSession.prototype.seek = originalSeek;
    sameRender(cached.render(cached.renderedFrame), continuous);
    sameRender(cached.render(5001), oracle.render(5001));
  } finally {
    SidSession.prototype.render = originalRender;
    SidSession.prototype.seek = originalSeek;
    cached.dispose();
    oracle.dispose();
  }
});

test('observations advertise only retained coverage and reject invalid or oversized ranges', async () => {
  const { cached, oracle } = await loaded(8192);
  try {
    assert.equal(cached.observe(0, 10), null);
    cached.prefetch(11025);
    const partial = cached.observe(0, 10)!;
    assert.equal(partial.start, 0);
    assert.equal(partial.end, cached.renderedFrame / SAMPLE_RATE);
    assert.equal(cached.observe(partial.end, partial.end + 1), null);
    await cached.seek(0.217319);
    cached.render(317);
    assert.ok(cached.cacheStartFrame > 0);
    const retained = cached.observe(0, 1)!;
    assert.equal(retained.start, cached.cacheStartFrame / SAMPLE_RATE);
    assert.equal(retained.end, cached.cacheEndFrame / SAMPLE_RATE);
    assert.equal(cached.observe(0, retained.start), null);
    const before = [cached.positionFrame, cached.renderedFrame, cached.cacheBytes];
    for (const [start, end] of [[-1, 1], [0, 0], [1, 0], [NaN, 1], [0, Infinity], [0, 600.001], [599, 601]]) {
      assert.throws(() => cached.observe(start, end), /observ|range|seconds/i);
    }
    assert.deepEqual([cached.positionFrame, cached.renderedFrame, cached.cacheBytes], before);
  } finally {
    cached.dispose();
    oracle.dispose();
  }
  assert.throws(() => cached.observe(0, 1), /disposed/);
});

test('dense observation responses crop coverage before omitted writes and preserve source drop warnings', async () => {
  const { cached, oracle } = await loaded();
  const originalRender = SidSession.prototype.render;
  try {
    SidSession.prototype.render = function(frames) {
      const result = originalRender.call(this, frames);
      const writes = Array.from({length: 25_000}, (_, index) => ({
        timeSeconds: (index + 1) / 100_000, cyclePhi1: index, address: 0, value: index % 256, sidNumber: 0,
      }));
      return {...result, writes, dropped: 7};
    };
    cached.prefetch(11025);
    const observation: TimelineObservation = cached.observe(0, 1)!;
    assert.equal(observation.writes.length, 20_000);
    assert.equal(observation.end, 0.20001);
    assert.equal(observation.dropped, 7);
    assert.ok(observation.writes.every((write) => write.timeSeconds < observation.end));
    assert.ok(observation.frames.length <= 1001);
    assert.equal(observation.frames.at(-1)!.time, observation.end);
    assert.equal(cached.renderedFrame, 11025, 'response cropping must not crop retained audio');
  } finally {
    SidSession.prototype.render = originalRender;
    cached.dispose();
    oracle.dispose();
  }
});

test('observation endpoint state survives a non-exact PCM-frame seconds round trip', async () => {
  const { cached, oracle } = await loaded();
  try {
    assert.notEqual(13 / SAMPLE_RATE * SAMPLE_RATE, 13);
    cached.prefetch(13);
    const continuous = oracle.render(13);
    const observation = cached.observe(0, 1)!;
    assert.equal(observation.end, 13 / SAMPLE_RATE);
    assert.deepEqual(observation.frames.at(-1)!.registers, continuous.registers);
    assert.deepEqual(observation.writes, continuous.writes, 'initial negative-time writes remain available at the origin');
  } finally {
    cached.dispose();
    oracle.dispose();
  }
});

test('centered observations accept floating-point window boundaries within the supported domain', async () => {
  const cached = await CachedSidSession.create();
  try {
    await cached.load(sample(), options);
    while (cached.renderedFrame < 18 * SAMPLE_RATE) cached.prefetch(11025);
    const position = 11.68734693877551;
    const centeredStart = position - 5;
    const windows = [
      {start: 6.315827664399093, end: 16.315827664399094, duration: 10},
      {start: centeredStart, end: Math.min(centeredStart + 10, position + 5), duration: 10},
      {start: centeredStart, end: Math.min(centeredStart + 11, position + 6), duration: 11},
    ];
    for (const {start, end, duration} of windows) {
      assert.ok(end - start > duration, 'subtraction rounds this centered window above the nominal duration');
      const observation = cached.observe(start, end)!;
      assert.equal(observation.start, start);
      assert.equal(observation.end, end);
      assert.ok(observation.frames.length <= 1001);
      assert.throws(() => cached.observe(start, 600.001), /range|seconds/i);
    }
  } finally {
    cached.dispose();
  }
});

test('variable-width previews copy bounded prepared observations without extra execution or retained storage', async (context) => {
  const { cached, oracle } = await loaded();
  const originalRender = SidSession.prototype.render;
  const originalSeek = SidSession.prototype.seek;
  try {
    assert.equal(cached.maxCacheBytes, 32 * 1024 * 1024);
    SidSession.prototype.render = () => { throw new Error('a cold preview must not execute the producer'); };
    SidSession.prototype.seek = async () => { throw new Error('a cold preview must not seek the producer'); };
    assert.equal(cached.observe(0, 600), null);
    SidSession.prototype.render = originalRender;
    SidSession.prototype.seek = originalSeek;
    while (cached.renderedFrame < 32 * SAMPLE_RATE) cached.prefetch(11025);
    const continuous = Array.from({length: 16}, () => oracle.render(2 * SAMPLE_RATE));
    const writes = continuous.flatMap((block) => block.writes);
    const before = [cached.positionFrame, cached.renderedFrame, cached.cacheStartFrame, cached.cacheEndFrame, cached.cacheBytes];
    SidSession.prototype.render = () => { throw new Error('preview padding must not execute the producer'); };
    SidSession.prototype.seek = async () => { throw new Error('preview padding must not seek the producer'); };
    for (const seconds of [6, 11, 21, 30]) {
      const started = performance.now();
      const observation = cached.observe(0.173219, 0.173219 + seconds)!;
      const elapsed = performance.now() - started;
      assert.equal(observation.start, 0.173219);
      assert.equal(observation.end, 0.173219 + seconds);
      assert.ok(observation.frames.length <= 1001);
      assert.ok(observation.writes.length <= 20_000);
      assert.deepEqual(observation.writes, writes.filter((write) => write.timeSeconds >= observation.start && write.timeSeconds < observation.end));
      for (const frame of observation.frames) {
        const registers = Array<number>(32).fill(0);
        for (const write of writes) {
          if (write.timeSeconds >= frame.time) break;
          registers[write.address] = write.value;
        }
        assert.deepEqual(frame.registers, registers);
      }
      assert.equal('pcm' in observation, false);
      assert.deepEqual([cached.positionFrame, cached.renderedFrame, cached.cacheStartFrame, cached.cacheEndFrame, cached.cacheBytes], before);
      context.diagnostic(`${seconds}-second preview=${elapsed.toFixed(3)}ms; writes=${observation.writes.length}; frames=${observation.frames.length}; response JSON=${Buffer.byteLength(JSON.stringify(observation))} bytes; retained cache=${cached.cacheBytes} bytes`);
    }
    const partial = cached.observe(0, 600)!;
    assert.equal(partial.start, 0);
    assert.equal(partial.end, 32);
    assert.ok(partial.frames.length <= 1001);
    assert.deepEqual([cached.positionFrame, cached.renderedFrame, cached.cacheStartFrame, cached.cacheEndFrame, cached.cacheBytes], before);
    assert.throws(() => cached.observe(0, 600.001), /range|seconds/i);
    SidSession.prototype.render = originalRender;
    SidSession.prototype.seek = originalSeek;
    for (const block of continuous) sameRender(cached.render(2 * SAMPLE_RATE), block);
    sameRender(cached.render(1001), oracle.render(1001));
  } finally {
    SidSession.prototype.render = originalRender;
    SidSession.prototype.seek = originalSeek;
    cached.dispose();
    oracle.dispose();
  }
});

test('cached backward, repeated and non-block seeks preserve PCM, raw writes and register baselines', async () => {
  const { cached, oracle } = await loaded();
  try {
    assert.ok(cached.prefetch(11025));
    assert.ok(cached.prefetch(11025));
    assert.ok(cached.prefetch(11025));
    for (const seconds of [0.173219, 0.173219, 0, 0.51837]) {
      assert.deepEqual(await cached.seek(seconds), await oracle.seek(seconds));
      sameRender(cached.render(3333), oracle.render(3333));
    }
    assert.ok(cached.cacheBytes <= cached.maxCacheBytes);
  } finally {
    cached.dispose();
    oracle.dispose();
  }
});

test('cached reads cross retained blocks and the live frontier without re-executing cache hits', async () => {
  const { cached, oracle } = await loaded();
  const originalRender = SidSession.prototype.render;
  const originalSeek = SidSession.prototype.seek;
  let renders = 0;
  let seeks = 0;
  SidSession.prototype.render = function(frames) {
    renders++;
    return originalRender.call(this, frames);
  };
  SidSession.prototype.seek = async function(seconds) {
    seeks++;
    return originalSeek.call(this, seconds);
  };
  try {
    cached.prefetch(1001);
    cached.prefetch(1207);
    const producedCalls = renders;
    await cached.seek(333 / SAMPLE_RATE);
    const actualHit = cached.render(1500);
    assert.equal(renders, producedCalls);
    assert.equal(seeks, 0);
    assert.equal(cached.renderedFrame, 2208);
    await oracle.seek(333 / SAMPLE_RATE);
    sameRender(actualHit, oracle.render(1500));
    sameRender(cached.render(3000), oracle.render(3000));
    assert.equal(cached.positionFrame, 4833);
    assert.equal(cached.renderedFrame, 4833);
    await cached.seek(333 / SAMPLE_RATE);
    const owned = cached.render(100);
    structuredClone(owned.pcm, { transfer: [owned.pcm.buffer] });
    await cached.seek(333 / SAMPLE_RATE);
    await oracle.seek(333 / SAMPLE_RATE);
    sameRender(cached.render(100), oracle.render(100));
  } finally {
    SidSession.prototype.render = originalRender;
    SidSession.prototype.seek = originalSeek;
    cached.dispose();
    oracle.dispose();
  }
});

test('uncached forward seeks continue the producer and a cache miss behind retention replays', async () => {
  const { cached, oracle } = await loaded(8192);
  const originalSeek = SidSession.prototype.seek;
  let seeks = 0;
  SidSession.prototype.seek = async function(seconds) {
    seeks++;
    return originalSeek.call(this, seconds);
  };
  try {
    await cached.seek(0.217319);
    assert.equal(seeks, 0, 'forward execution must not reset from initialization');
    await oracle.seek(0.217319);
    sameRender(cached.render(317), oracle.render(317));
    assert.ok(cached.cacheStartFrame > 0);
    assert.ok(cached.cacheBytes <= 8192);
    const beforeMiss = seeks;
    await cached.seek(0);
    assert.equal(seeks, beforeMiss + 1);
    await oracle.seek(0);
    sameRender(cached.render(317), oracle.render(317));
  } finally {
    SidSession.prototype.seek = originalSeek;
    cached.dispose();
    oracle.dispose();
  }
});

test('read-ahead obeys the byte cap and protects unread audio when full', async () => {
  const { cached, oracle } = await loaded(8192);
  try {
    let iterations = 0;
    while (cached.prefetch(11025)) {
      assert.ok(cached.cacheBytes <= 8192);
      assert.ok(++iterations < 1000, 'bounded read-ahead should stop at capacity');
    }
    const frontier = cached.renderedFrame;
    assert.ok(frontier > 0);
    assert.equal(cached.positionFrame, 0);
    assert.equal(cached.cacheStartFrame, 0);
    sameRender(cached.render(frontier), oracle.render(frontier));
    assert.ok(cached.prefetch(11025), 'consuming audio should permit more read-ahead');
    for (let index = 0; index < 10; index++) {
      sameRender(cached.render(331), oracle.render(331));
      assert.ok(cached.cacheBytes <= 8192);
    }
  } finally {
    cached.dispose();
    oracle.dispose();
  }
});

test('mask and profile/load changes invalidate cached full-mix audio at the logical cursor', async () => {
  const { cached, oracle } = await loaded();
  try {
    cached.prefetch(11025);
    await cached.seek(0.112345);
    await oracle.seek(0.112345);
    assert.deepEqual(await cached.mute([true, false, true]), await oracle.mute([true, false, true]));
    assert.equal(cached.cacheEndFrame, cached.positionFrame);
    const before = cached.positionFrame;
    assert.equal(cached.cacheStartFrame, 0);
    assert.deepEqual(await cached.seek(0.071234), await oracle.seek(0.071234));
    sameRender(cached.render(2001), oracle.render(2001));
    assert.ok(cached.positionFrame < before + 2001);
    cached.prefetch(11025);
    const changed = { ...options, clock: 'NTSC', model: 'MOS8580' } as const;
    assert.deepEqual(await cached.load(sample(), changed), await oracle.load(sample(), changed));
    assert.equal(cached.positionFrame, 0);
    assert.equal(cached.cacheEndFrame, 0);
    sameRender(cached.render(3001), oracle.render(3001));
  } finally {
    cached.dispose();
    oracle.dispose();
  }
});

test('invalid requests fail before modifying either cursor or retained audio', async () => {
  await assert.rejects(CachedSidSession.create({ maxCacheBytes: 31 }), /cache|bytes/i);
  await assert.rejects(CachedSidSession.create({ maxCacheBytes: NaN }), /cache|bytes/i);
  const empty = await CachedSidSession.create();
  assert.throws(() => empty.prefetch(1), /load/i);
  empty.dispose();
  const { cached, oracle } = await loaded();
  try {
    cached.prefetch(500);
    const before = [cached.positionFrame, cached.cacheStartFrame, cached.cacheEndFrame, cached.cacheBytes];
    for (const frames of [0, -1, NaN, Infinity, 1.5, 88201]) {
      assert.throws(() => cached.render(frames), /frames/);
      assert.throws(() => cached.prefetch(frames), /frames/);
    }
    for (const seconds of [-1, NaN, Infinity, 601]) await assert.rejects(cached.seek(seconds), /seconds|seek/i);
    await assert.rejects(cached.mute([false, false] as unknown as [boolean, boolean, boolean]), /mask/);
    await assert.rejects(cached.load(new Uint8Array(4), options), /header/);
    assert.deepEqual([cached.positionFrame, cached.cacheStartFrame, cached.cacheEndFrame, cached.cacheBytes], before);
    sameRender(cached.render(500), oracle.render(500));
  } finally {
    cached.dispose();
    oracle.dispose();
  }
  assert.throws(() => cached.render(1), /disposed/);
  assert.throws(() => cached.prefetch(1), /disposed/);
});


test('a failed background producer leaves retained audio and cached seeks readable', async () => {
  const { cached, oracle } = await loaded();
  const originalRender = SidSession.prototype.render;
  try {
    cached.prefetch(1001);
    SidSession.prototype.render = () => { throw new Error('future play routine halted'); };
    assert.throws(() => cached.prefetch(1001), /halted/);
    assert.equal(cached.renderedFrame, 1001);
    const actual = cached.render(997);
    await cached.seek(333 / SAMPLE_RATE);
    const repeated = cached.render(317);
    SidSession.prototype.render = originalRender;
    sameRender(actual, oracle.render(997));
    await oracle.seek(333 / SAMPLE_RATE);
    sameRender(repeated, oracle.render(317));
  } finally {
    SidSession.prototype.render = originalRender;
    cached.dispose();
    oracle.dispose();
  }
});

test('the default cache retains the complete cleared sample for instant late backward seeks', { timeout: 30000 }, async (context) => {
  const { cached, oracle } = await loaded();
  try {
    const durationFrames = Math.floor(193.35884353741497 * SAMPLE_RATE);
    while (cached.renderedFrame < durationFrames) {
      assert.ok(cached.prefetch(Math.min(11025, durationFrames - cached.renderedFrame)), 'complete cleared sample fits the default cap');
      assert.ok(cached.cacheBytes <= cached.maxCacheBytes);
    }
    assert.equal(cached.cacheStartFrame, 0);
    const bytes = cached.cacheBytes;
    for (const start of [0, 90, 180]) {
      const previewStarted = performance.now();
      const observation = cached.observe(start, start + 11)!;
      const previewMs = performance.now() - previewStarted;
      assert.equal(observation.start, start);
      assert.equal(observation.end, start + 11);
      assert.ok(observation.writes.length <= 20_000);
      assert.ok(observation.frames.length <= 552);
      assert.equal(cached.cacheBytes, bytes);
      context.diagnostic(`11-second preview start=${start}; ${previewMs.toFixed(3)}ms; writes=${observation.writes.length}; frames=${observation.frames.length}; response JSON=${Buffer.byteLength(JSON.stringify(observation))} bytes; retained cache=${bytes} bytes`);
    }
    const cachedStart = performance.now();
    const position = await cached.seek(177.731234);
    const cachedMs = performance.now() - cachedStart;
    const replayStart = performance.now();
    assert.deepEqual(position, await oracle.seek(177.731234));
    const replayMs = performance.now() - replayStart;
    sameRender(cached.render(3173), oracle.render(3173));
    context.diagnostic(`full sample retained bytes=${cached.cacheBytes}; cached late seek=${cachedMs.toFixed(3)}ms; uncached replay=${replayMs.toFixed(3)}ms`);
  } finally {
    cached.dispose();
    oracle.dispose();
  }
});

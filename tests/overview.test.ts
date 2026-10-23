import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { CachedSidSession } from '../src/engine/cached-session.ts';
import { collectObservationWindow } from '../src/engine/observation-window.ts';
import { SAMPLE_RATE, SidSession } from '../src/engine/session.ts';
import type { PlaybackOptions, SidWrite } from '../src/engine/session.ts';

const options: PlaybackOptions = {clock: 'PAL', model: 'MOS6581', subtune: 1};
const sample = () => new Uint8Array(readFileSync('public/generated/rambo-loader-main.sid'));
const cacheState = (cached: CachedSidSession) => [
  cached.positionFrame, cached.renderedFrame, cached.cacheStartFrame, cached.cacheEndFrame, cached.cacheBytes, cached.overviewBytes,
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

test('overview preserves sampled coverage after eviction while exact observations stay cache-bounded', async context => {
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
    assert.equal(retained.start, 0);
    assert.equal(retained.end, cached.cacheEndFrame / SAMPLE_RATE);
    const exact = cached.observe(0, 1)!;
    assert.equal(exact.start, cached.cacheStartFrame / SAMPLE_RATE);
    const coarse = cached.overview(exact.start, exact.end)!;
    assert.equal(coarse.start,exact.start);
    assert.equal(coarse.end,exact.end);
    const registers = exact.frames[0].registers.slice();
    let offset = 0;
    for (const frame of coarse.frames) {
      while (offset < exact.writes.length && exact.writes[offset].timeSeconds < frame.time) {
        const write = exact.writes[offset++];
        registers[write.sidNumber * 32 + write.address] = write.value;
      }
      assert.deepEqual(frame.registers,registers,`coarse and detailed sampling describe the same ordered state before ${frame.time}`);
    }
    for (const [start, end] of [[-1, 1], [0, 0], [1, 0], [NaN, 1], [0, Infinity], [0, 600.001], [599, 601]]) {
      assert.throws(() => cached.overview(start, end), /range|seconds/i);
    }
    assert.deepEqual(cacheState(cached), before);
  } finally {
    cached.dispose();
  }
  assert.throws(() => cached.overview(0, 1), /disposed/);
});

test('first overview after PCM eviction retains original sampled register states without executing the source', async context => {
  const cached = await CachedSidSession.create({maxCacheBytes: 65_536});
  try {
    const initial = (await cached.load(sample(), options)).registers;
    const registers = initial.slice();
    const continuousWrites: SidWrite[] = [];
    let producedFrame = 0;
    context.mock.method(SidSession.prototype, 'render', (frames: number) => {
      const startFrame = producedFrame;
      producedFrame += frames;
      const writes: SidWrite[] = [];
      for (let ordinal = Math.ceil(startFrame / 100); ordinal * 100 < producedFrame; ordinal++) {
        const write = {timeSeconds: (ordinal * 100 + 0.5) / SAMPLE_RATE,
          cyclePhi1: ordinal * 32, address: ordinal % 32, value: ordinal * 37 % 256, sidNumber: 0};
        writes.push(write);
        registers[write.address] = write.value;
      }
      continuousWrites.push(...writes);
      return {startFrame, endFrame: producedFrame, pcm: new Int16Array(frames), writes,
        registers: registers.slice(), dropped: 0};
    });
    cached.render(2 * SAMPLE_RATE);
    assert.equal(cached.overviewBytes, 30_003 * initial.length);
    assert.ok(cached.cacheStartFrame > SAMPLE_RATE, 'the first second has left the PCM/write cache');
    const before = cacheState(cached);
    context.mock.method(SidSession.prototype, 'render', () => { throw new Error('overview must not execute the source'); });
    context.mock.method(SidSession.prototype, 'seek', async () => { throw new Error('overview must not seek the source'); });
    const started = performance.now();
    const overview = cached.overview(0, 2)!;
    const elapsed = performance.now() - started;
    assert.equal(overview.start, 0);
    assert.equal(overview.end, 2);
    assert.equal(overview.frames.length, 101);
    const expected = initial.slice();
    let nextWrite = 0;
    for (const frame of overview.frames) {
      while (nextWrite < continuousWrites.length && continuousWrites[nextWrite].timeSeconds < frame.time) {
        const write = continuousWrites[nextWrite++];
        expected[write.address] = write.value;
      }
      assert.deepEqual(frame.registers, expected, `original register state immediately before ${frame.time}`);
    }
    assert.deepEqual(cacheState(cached), before);
    assert.ok(cached.cacheBytes <= cached.maxCacheBytes);
    const original = structuredClone(overview);
    overview.frames[0].registers.fill(255);
    overview.frames[0].time = 10;
    assert.deepEqual(cached.overview(0, 2), original, 'archive callers own all returned arrays');
    context.diagnostic(`late first overview=${elapsed.toFixed(3)}ms; frames=${original.frames.length}; response JSON=${Buffer.byteLength(JSON.stringify(original))} bytes; retained PCM/write cache=${cached.cacheBytes} bytes; overview typed storage=${cached.overviewBytes} bytes`);
  } finally {
    cached.dispose();
  }
});

test('overview survives nonretained blocks and backward reset but clears with a replacement mix or load', async context => {
  const cached = await CachedSidSession.create({maxCacheBytes: 32});
  try {
    const initial = (await cached.load(sample(), options)).registers;
    let producedFrame = 0;
    const registers = initial.slice();
    context.mock.method(SidSession.prototype, 'render', (frames: number) => {
      const startFrame = producedFrame;
      producedFrame += frames;
      const value = producedFrame % 256;
      registers[0] = value;
      return {startFrame, endFrame: producedFrame, pcm: new Int16Array(frames),
        writes: [{timeSeconds: (startFrame + 0.5) / SAMPLE_RATE, cyclePhi1: startFrame * 32, address: 0, value, sidNumber: 0}],
        registers: registers.slice(), dropped: 0};
    });
    context.mock.method(SidSession.prototype, 'seek', async (seconds: number) => {
      producedFrame = Math.floor(seconds * SAMPLE_RATE);
      registers.splice(0, registers.length, ...initial);
      return {frame: producedFrame, registers: registers.slice()};
    });
    cached.render(2205);
    assert.equal(cached.cacheStartFrame, cached.renderedFrame, 'no produced block fits the detailed cache');
    const original = cached.overview(0, 1)!;
    assert.equal(original.start, 0);
    assert.equal(original.end, 0.05);
    for (const frame of original.frames) {
      assert.equal(frame.registers[0], Math.round(frame.time * SAMPLE_RATE) % 256);
    }
    await cached.seek(0);
    cached.render(441);
    assert.deepEqual(cached.overview(0, 1), original, 'same-configuration replay must retain the observed future');
    await cached.mute([true, false, false]);
    assert.equal(cached.overview(0, 1)!.end, 0.01, 'mix replacement must discard the previous chart future');
    await cached.load(sample(), options);
    assert.equal(cached.overview(0, 1), null);
    assert.equal(cached.cacheBytes, 32);
    assert.equal(cached.overviewBytes, 0);
  } finally {
    cached.dispose();
  }
  assert.equal(cached.overviewBytes, 0);
});

test('stereo archive stays bounded through the supported duration and returns only original sampled times', async context => {
  const moduleUrl = pathToFileURL(resolve('build/engine/libsidplayfp.js')).href;
  const cached = await CachedSidSession.create({moduleUrl});
  try {
    const initial = (await cached.load(new Uint8Array(readFileSync('public/generated/rambo-stereo-main.sid')), options)).registers;
    assert.equal(initial.length, 64);
    const registers = initial.slice();
    const continuousWrites: SidWrite[] = [];
    let producedFrame = 0;
    context.mock.method(SidSession.prototype, 'render', (frames: number) => {
      const startFrame = producedFrame;
      producedFrame += frames;
      const ordinal = continuousWrites.length;
      const write = {timeSeconds: (startFrame + 0.5) / SAMPLE_RATE, cyclePhi1: ordinal * 32,
        address: ordinal % 32, value: ordinal * 37 % 256, sidNumber: ordinal % 2};
      continuousWrites.push(write);
      registers[write.sidNumber * 32 + write.address] = write.value;
      return {startFrame, endFrame: producedFrame, pcm: new Int16Array(frames * 2), writes: [write],
        registers: registers.slice(), dropped: 0};
    });
    for (let seconds = 0; seconds < 602; seconds += 2) cached.render(2 * SAMPLE_RATE);
    assert.ok(cached.cacheStartFrame > 0);
    assert.equal(cached.overviewBytes, 1_920_192);
    const before = cacheState(cached);
    context.mock.method(SidSession.prototype, 'render', () => { throw new Error('overview must not execute the source'); });
    context.mock.method(SidSession.prototype, 'seek', async () => { throw new Error('overview must not seek the source'); });
    const started = performance.now();
    const overview = cached.overview(0, 600)!;
    const elapsed = performance.now() - started;
    assert.equal(overview.start, 0);
    assert.equal(overview.end, 600);
    assert.equal(overview.frames.length, 1001);
    const expected = initial.slice();
    let nextWrite = 0;
    for (const frame of overview.frames) {
      while (nextWrite < continuousWrites.length && continuousWrites[nextWrite].timeSeconds < frame.time) {
        const write = continuousWrites[nextWrite++];
        expected[write.sidNumber * 32 + write.address] = write.value;
      }
      assert.deepEqual(frame.registers, expected);
      assert.equal(frame.time, Math.round(frame.time * SAMPLE_RATE / 882) * 882 / SAMPLE_RATE);
    }
    const boundaryStart = 13_230 / SAMPLE_RATE;
    const boundaryEnd = 26_460 / SAMPLE_RATE;
    const clipped = cached.overview(boundaryStart, boundaryEnd)!;
    assert.equal(clipped.start, boundaryStart);
    assert.equal(clipped.end, boundaryEnd);
    assert.equal(cached.overview(0.001, 0.019), null, 'a request between archived samples must not invent a frame');
    assert.deepEqual(cacheState(cached), before);
    context.diagnostic(`600-second stereo archive query=${elapsed.toFixed(3)}ms; frames=${overview.frames.length}; response JSON=${Buffer.byteLength(JSON.stringify(overview))} bytes; retained typed storage=${cached.overviewBytes} bytes; source frontier=${cached.renderedFrame / SAMPLE_RATE}s`);
  } finally {
    cached.dispose();
  }
  assert.equal(cached.overviewBytes, 0);
});

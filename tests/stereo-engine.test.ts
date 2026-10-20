import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { SidSession } from '../src/engine/session.ts';
import { CachedSidSession } from '../src/engine/cached-session.ts';
import { collectObservationWindow } from '../src/engine/observation-window.ts';
import { parseCatalog } from '../src/catalog.ts';
import { dualSid, monoSid } from './fixtures/dual-sid.ts';

const moduleUrl = pathToFileURL(resolve('build/engine/libsidplayfp.js')).href;
const settings = (model: 'MOS6581' | 'MOS8580') => ({clock: 'PAL' as const, model, subtune: 1});

for (const model of ['MOS6581', 'MOS8580'] as const) {
  test(`${model}: dual-SID frames, split reads, seek remainder and chip register histories agree`, async () => {
    const continuous = await SidSession.create({moduleUrl});
    const split = await SidSession.create({moduleUrl});
    const idle = await SidSession.create();
    try {
      const info = await continuous.load(dualSid(model), settings(model));
      await split.load(dualSid(model), settings(model));
      assert.equal(info.channels, 2);
      assert.deepEqual(info.sidChipBases, [0xd400, 0xd420]);
      const expected = continuous.render(23457);
      assert.equal(expected.pcm.length, 46914);
      assert.equal(expected.registers.length, 64);
      assert.deepEqual(new Set(expected.writes.map(write => write.sidNumber)), new Set([0, 1]));
      const pieces = [split.render(1), split.render(12346), split.render(11110)];
      assert.deepEqual(Int16Array.from(pieces.flatMap(block => [...block.pcm])), expected.pcm);
      assert.deepEqual(pieces.flatMap(block => block.writes), expected.writes);
      const registers = Array(64).fill(0);
      for (const write of expected.writes) registers[write.sidNumber * 32 + write.address] = write.value;
      assert.deepEqual(expected.registers, registers);
      const target = 12347;
      await split.seek(target / 44100);
      assert.deepEqual(split.render(4093).pcm, expected.pcm.slice(target * 2, (target + 4093) * 2));
      await assert.rejects(split.mute([false, false, false]), /6|six/);
      await split.seek(0);
      await split.mute([false, false, false, true, true, true]);
      const muted = split.render(11025);
      assert.deepEqual(muted.pcm.filter((_, index) => index % 2 === 0), expected.pcm.slice(0, 22050).filter((_, index) => index % 2 === 0));
      await idle.load(monoSid(model, 1, true), settings(model));
      assert.deepEqual(muted.pcm.filter((_, index) => index % 2 === 1), idle.render(11025).pcm);
    } finally { continuous.dispose(); split.dispose(); idle.dispose(); }
  });

  test(`${model}: bounded stereo cache retains frame alignment, chip observations and seek continuity`, async () => {
    const cached = await CachedSidSession.create({moduleUrl, maxCacheBytes: 65536});
    const continuous = await SidSession.create({moduleUrl});
    try {
      await cached.load(dualSid(model), settings(model));
      await continuous.load(dualSid(model), settings(model));
      for (let index = 0; index < 12; index++) {
        cached.prefetch(4000);
        const actual = cached.render(4000);
        assert.deepEqual(actual, continuous.render(4000));
        assert.ok(cached.cacheBytes <= 65536);
      }
      assert.ok(cached.cacheStartFrame > 0, 'consumed stereo history must be evicted within the cap');
      const frame = cached.cacheStartFrame + 17;
      const observation = cached.observe(frame / 44100, cached.cacheEndFrame / 44100)!;
      await continuous.seek(frame / 44100);
      const expected = continuous.render(cached.cacheEndFrame - frame);
      const registers = (await cached.seek(frame / 44100)).registers;
      for (const sample of observation.frames) {
        const atTime = registers.slice();
        for (const write of expected.writes) if (write.timeSeconds < sample.time) atTime[write.sidNumber * 32 + write.address] = write.value;
        assert.deepEqual(sample.registers, atTime);
      }
      assert.deepEqual(cached.render(expected.endFrame - expected.startFrame), expected);
    } finally { cached.dispose(); continuous.dispose(); }
  });
}

test('a stereo load exceeding the register cap disables stale reads and permits mono recovery', async () => {
  const cached = await CachedSidSession.create({moduleUrl, maxCacheBytes: 32});
  const mono = dualSid('MOS6581', 0);
  new DataView(mono.buffer).setUint16(4, 2);
  mono[122] = 0;
  try {
    await cached.load(mono, settings('MOS6581'));
    cached.render(1);
    await assert.rejects(cached.load(dualSid('MOS6581'), settings('MOS6581')), /cap/);
    assert.throws(() => cached.render(1), /Load a SID/);
    assert.throws(() => cached.observe(0, 1), /Load a SID/);
    await cached.load(mono, settings('MOS6581'));
    assert.equal(cached.render(1).pcm.length, 1);
    assert.ok(cached.cacheBytes <= 32);
  } finally { cached.dispose(); }
});

test('PSID v1 payload bytes never declare a second chip', async () => {
  const source = dualSid('MOS6581', 0);
  const mono = new Uint8Array(source.length - 6);
  mono.set(source.subarray(0, 118));
  mono.set(source.subarray(124), 118);
  const header = new DataView(mono.buffer);
  header.setUint16(4, 1);
  header.setUint16(6, 118);
  assert.notEqual(mono[122], 0);
  const session = await SidSession.create({moduleUrl});
  try {
    assert.equal((await session.load(mono, settings('MOS6581'))).channels, 1);
    assert.equal(session.render(4096).pcm.length, 4096);
  } finally { session.dispose(); }
});


for (const [filename, model] of [['rambo-stereo-main.sid', 'MOS6581'], ['bach-toccata-stereo.sid', 'MOS8580']] as const) {
  test(`${filename}: arrangement seek continuation equals continuous raw playback with both chip traces`, async () => {
    const bytes = new Uint8Array(readFileSync(`public/generated/${filename}`));
    const continuous = await SidSession.create({moduleUrl});
    const seeking = await SidSession.create({moduleUrl});
    try {
      await continuous.load(bytes, settings(model));
      await seeking.load(bytes, settings(model));
      const target = Math.floor(11.731234 * 44100);
      for (let frame = 0; frame < target;) {
        const count = Math.min(88200, target - frame);
        continuous.render(count);
        frame += count;
      }
      const expected = continuous.render(44100);
      await seeking.seek(target / 44100);
      assert.deepEqual(seeking.render(44100), expected);
      assert.deepEqual(new Set(expected.writes.map(write => write.sidNumber)), new Set([0, 1]));
      for (let channel = 0; channel < 2; channel++) assert.ok(expected.pcm.some((sample, index) => index % 2 === channel && Math.abs(sample) > 100));
      assert.equal(expected.dropped, 0);
    } finally { continuous.dispose(); seeking.dispose(); }
  });
}

test('rebuilt raw mono preserves the complete accepted Rambo PCM and observations', {timeout: 30000}, async () => {
  const entry = parseCatalog(JSON.parse(readFileSync('config/catalog.json', 'utf8'))).entries.find(entry => entry.id === 'rambo-loader-main')!;
  const bytes = new Uint8Array(readFileSync(`public/generated/${entry.files.sid.filename}`));
  const rebuilt = await SidSession.create({moduleUrl});
  const shipped = await SidSession.create();
  try {
    await rebuilt.load(bytes, settings('MOS6581'));
    await shipped.load(bytes, settings('MOS6581'));
    const totalFrames = Math.round((entry.durationSeconds + 1) * 44100);
    for (let frame = 0; frame < totalFrames;) {
      const count = Math.min(88200, totalFrames - frame);
      assert.deepEqual(rebuilt.render(count), shipped.render(count));
      frame += count;
    }
  } finally { rebuilt.dispose(); shipped.dispose(); }
});

test('dense Bach observations cover both requested windows without changing cached playback', async (t) => {
  const entry = parseCatalog(JSON.parse(readFileSync('config/catalog.json', 'utf8'))).entries.find(entry => entry.id === 'bach-toccata-stereo')!;
  const bytes = new Uint8Array(readFileSync(`public/generated/${entry.files.sid.filename}`));
  const cached = await CachedSidSession.create({moduleUrl});
  const continuous = await SidSession.create({moduleUrl});
  try {
    await cached.load(bytes, settings('MOS8580'));
    const initial = await continuous.load(bytes, settings('MOS8580'));
    while (cached.cacheEndFrame < 16 * 44100) cached.prefetch(44100);
    const expected = Array.from({length:16}, () => continuous.render(44100));
    const cacheBytes = cached.cacheBytes;
    const frontier = cached.cacheEndFrame;
    for (const [start, end] of [[0, 10], [5, 16]]) {
      const packet = cached.observe(start, end)!;
      assert.ok(packet.end < end);
      assert.equal(packet.continuationStart, packet.end);
      const started = performance.now();
      const observation = await collectObservationWindow(start, end, async (from, until) => cached.observe(from, until), () => true);
      const elapsed = performance.now() - started;
      assert.equal(observation!.start, start);
      assert.equal(observation!.end, end);
      assert.deepEqual(observation!.writes, expected.flatMap(block => block.writes).filter(write => (start === 0 || write.timeSeconds >= start) && write.timeSeconds < end));
      assert.equal(observation!.dropped, 0);
      assert.ok(observation!.frames.length <= 1001);
      const writes = expected.flatMap(block => block.writes);
      const registers = initial.registers.slice();
      let index = 0;
      for (const frame of observation!.frames) {
        while (index < writes.length && writes[index].timeSeconds < frame.time) {
          const write = writes[index++];
          registers[write.sidNumber * 32 + write.address] = write.value;
        }
        assert.deepEqual(frame.registers, registers);
      }
      t.diagnostic(`${start}–${end}s: ${elapsed.toFixed(3)}ms; writes=${observation!.writes.length}; frames=${observation!.frames.length}; response JSON=${JSON.stringify(observation).length} bytes`);
    }
    assert.equal(cached.cacheBytes, cacheBytes);
    assert.equal(cached.cacheEndFrame, frontier);
    for (const block of expected) assert.deepEqual(cached.render(44100), block);
  } finally { cached.dispose(); continuous.dispose(); }
});

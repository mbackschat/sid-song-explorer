import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import loadLibsidplayfp from 'libsidplayfp-wasm';
import { SidSession } from '../src/engine/session.ts';

const options = { clock: 'PAL', model: 'MOS6581', subtune: 1 } as const;
const samplePath = existsSync('public/generated/rambo-loader-main.sid')
  ? 'public/generated/rambo-loader-main.sid'
  : 'build/engine-tests/rambo-loader-main.sid';

function sample(): Uint8Array {
  assert.ok(existsSync(samplePath), 'Run pnpm prepare:samples to prepare the cleared Rambo fixture');
  return new Uint8Array(readFileSync(samplePath));
}

async function loaded(config: { clock: 'PAL' | 'NTSC'; model: 'MOS6581' | 'MOS8580'; subtune: number } = options) {
  const session = await SidSession.create();
  await session.load(sample(), config);
  return session;
}

function concatenate(parts: Int16Array[]): Int16Array {
  const result = new Int16Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

test('reject malformed and unsupported headers before loading WASM', async () => {
  const session = await SidSession.create({ wasmUrl: '/unreachable-test-engine.wasm' });
  try {
    await assert.rejects(session.load(new Uint8Array(4), options), /PSID header/);
    const invalidCases: [number, number, RegExp][] = [
      [0, 82, /RSID/],
      [5, 5, /version/],
      [7, 1, /data offset/],
      [15, 0, /song count/],
      [12, 0, /play address|interrupt/],
      [122, 0x42, /mono|SID/],
      [119, 1, /MUS/],
      [119, 2, /PlaySID/],
    ];
    for (const [offset, value, expected] of invalidCases) {
      const bytes = sample();
      bytes[offset] = value;
      if (offset === 12) bytes[13] = 0;
      await assert.rejects(session.load(bytes, options), expected);
    }
    await assert.rejects(session.load(new Uint8Array(70000), options), /size/);
    await assert.rejects(session.load(sample(), { ...options, subtune: 0 }), /subtune/);
    await assert.rejects(session.load(sample(), { ...options, subtune: 2 }), /subtune/);
  } finally {
    session.dispose();
  }
});

test('real mono Rambo advances PCM and ordered audio-relative writes without ROMs', async () => {
  const session = await SidSession.create();
  try {
    const info = await session.load(sample(), options);
    assert.equal(info.title, 'Rambo main music');
    assert.equal(info.installedSids, 1);
    assert.equal(info.sampleRate, 44100);
    assert.equal(info.clock, 'PAL');
    assert.equal(info.model, 'MOS6581');
    assert.equal(info.engine.builder, 'WasmSIDLite');
    assert.equal(info.engine.requestedPowerOnDelay, 0);
    assert.equal(info.engine.effectivePowerOnDelay, 8000);
    const block = session.render(44100);
    assert.equal(block.startFrame, 0);
    assert.equal(block.endFrame, 44100);
    assert.equal(block.pcm.length, 44100);
    assert.ok(block.pcm.some((value) => Math.abs(value) > 1000));
    assert.ok(block.writes.length > 100);
    assert.equal(block.dropped, 0);
    assert.equal(block.registers.length, 32);
    for (let index = 0; index < block.writes.length; index++) {
      const write = block.writes[index];
      assert.ok(write.timeSeconds >= 0 && write.timeSeconds < 1);
      assert.equal(write.sidNumber, 0);
      assert.ok(write.address >= 0 && write.address < 32);
      if (index) assert.ok(write.cyclePhi1 >= block.writes[index - 1].cyclePhi1);
    }
  } finally {
    session.dispose();
  }
});


test('calibration leaves actual startup and continuous PCM identical to the raw library oracle', async () => {
  const module = await loadLibsidplayfp({ engine: 'sidlite' });
  const context = new module.SidPlayerContext();
  const session = await loaded();
  try {
    assert.ok(context.configure(44100, false));
    assert.ok(context.setEmulationConfig({
      frequency: 44100, stereo: false, c64Model: 'PAL', forceC64Model: true,
      sidModel: 'MOS6581', forceSidModel: true, powerOnDelay: 0,
      secondSidAddress: 0, thirdSidAddress: 0,
    }));
    assert.ok(context.loadSidBuffer(sample()));
    const expected = new Int16Array(44100);
    let offset = 0;
    while (offset < expected.length) {
      const block = context.render(20000)!.slice();
      const take = Math.min(block.length, expected.length - offset);
      expected.set(block.subarray(0, take), offset);
      offset += take;
    }
    assert.deepEqual(session.render(44100).pcm, expected);
  } finally {
    context.delete();
    session.dispose();
  }
});

test('callable CIA-timed mono PSID executes without ROMs', async () => {
  const bytes = sample();
  new DataView(bytes.buffer).setUint32(18, 1);
  const session = await SidSession.create();
  try {
    const info = await session.load(bytes, options);
    assert.equal(info.engine.songSpeed, 'CIA');
    const block = session.render(44100);
    assert.ok(block.pcm.some((value) => Math.abs(value) > 1000));
    assert.ok(block.writes.length > 100);
    assert.equal(block.dropped, 0);
  } finally {
    session.dispose();
  }
});

test('split render calls preserve all PCM and timestamped writes', async () => {
  const whole = await loaded();
  const split = await loaded();
  try {
    const expected = whole.render(2201);
    const parts = [split.render(1), split.render(1000), split.render(1200)];
    assert.deepEqual(concatenate(parts.map((part) => part.pcm)), expected.pcm);
    assert.deepEqual(parts.flatMap((part) => part.writes), expected.writes);
    assert.deepEqual(parts.at(-1)!.registers, expected.registers);
    assert.equal(parts.at(-1)!.endFrame, 2201);
  } finally {
    whole.dispose();
    split.dispose();
  }
});

test('seek preserves the non-block remainder and matches continuous PCM exactly', async () => {
  const continuous = await loaded();
  const seeking = await loaded();
  try {
    const seconds = 0.731234;
    const frame = Math.floor(seconds * 44100);
    continuous.render(frame);
    const expected = continuous.render(10000);
    const position = await seeking.seek(seconds);
    assert.equal(position.frame, frame);
    const actual = seeking.render(10000);
    assert.equal(actual.startFrame, frame);
    assert.deepEqual(actual.pcm, expected.pcm);
    assert.deepEqual(actual.writes, expected.writes);
    assert.deepEqual(actual.registers, expected.registers);
    await seeking.seek(0);
    assert.deepEqual(seeking.render(3000).pcm, (await reloadPcm(3000)));
  } finally {
    continuous.dispose();
    seeking.dispose();
  }
});

async function reloadPcm(frames: number) {
  const session = await loaded();
  try {
    return session.render(frames).pcm;
  } finally {
    session.dispose();
  }
}

test('mute and restoration replay from init at the consumed frame with the same configuration', async () => {
  const config = { clock: 'NTSC', model: 'MOS8580', subtune: 1 } as const;
  const subject = await loaded(config);
  const continuous = await loaded(config);
  try {
    const start = 44113;
    subject.render(start);
    continuous.render(start);
    const full = continuous.render(4096);
    const position = await subject.mute([true, true, true]);
    assert.equal(position.frame, start);
    const muted = subject.render(4096);
    assert.notDeepEqual(muted.pcm, full.pcm);
    await subject.seek(start / 44100);
    assert.deepEqual(subject.render(4096).pcm, muted.pcm);
    await subject.mute([false, false, false]);
    assert.deepEqual(subject.render(4096).pcm, continuous.render(4096).pcm);
  } finally {
    subject.dispose();
    continuous.dispose();
  }
});

test('invalid frame counts, seeks and masks fail before execution', async () => {
  const session = await loaded();
  try {
    for (const frames of [0, -1, NaN, Infinity, 1.5, 88201]) {
      assert.throws(() => session.render(frames), /frames/);
    }
    for (const seconds of [-1, NaN, Infinity, 601]) {
      await assert.rejects(session.seek(seconds), /seek|seconds/i);
    }
    await assert.rejects(session.mute([false, false] as unknown as [boolean, boolean, boolean]), /mask/);
  } finally {
    session.dispose();
  }
  assert.throws(() => session.render(1), /disposed/);
});

test('a halting untrusted play routine fails instead of spinning for samples', async () => {
  const bytes = sample();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = view.getUint16(6);
  const load = view.getUint16(8);
  const play = view.getUint16(12);
  bytes[offset + play - load] = 0x02;
  const session = await SidSession.create();
  try {
    await session.load(bytes, options);
    assert.throws(() => session.render(44100), /render|halt|exhaust|stopped/i);
  } finally {
    session.dispose();
  }
});

test('full Rambo export and tail render within the focused test budget', { timeout: 30000 }, async () => {
  const session = await loaded();
  try {
    const durationFrames = Math.floor(193.35884353741497 * 44100);
    let frame = 0;
    let last: Int16Array = new Int16Array();
    let writes = 0;
    while (frame < durationFrames + 44100) {
      const block = session.render(Math.min(44100, durationFrames + 44100 - frame));
      assert.equal(block.startFrame, frame);
      assert.equal(block.dropped, 0);
      frame = block.endFrame;
      writes += block.writes.length;
      last = block.pcm;
    }
    assert.ok(writes > 10000);
    assert.equal(frame, durationFrames + 44100);
    assert.ok(last.every((value) => Math.abs(value) < 1000), 'post-ending tail should have decayed');
  } finally {
    session.dispose();
  }
});

test('write timestamps stay within the raw PCM interval that produced each trace', async () => {
  const module = await loadLibsidplayfp({ engine: 'sidlite' });
  const context = new module.SidPlayerContext();
  const session = await SidSession.create();
  try {
    await session.load(sample(), options);
    const writes = session.render(88200).writes;
    const times = new Map(writes.map((write) => [write.cyclePhi1, write.timeSeconds]));
    assert.ok(context.configure(44100, false));
    assert.ok(context.setEmulationConfig({
      frequency: 44100, stereo: false, c64Model: 'PAL', forceC64Model: true,
      sidModel: 'MOS6581', forceSidModel: true, powerOnDelay: 0,
      secondSidAddress: 0, thirdSidAddress: 0,
    }));
    context.setSidWriteTraceEnabled(true);
    assert.ok(context.loadSidBuffer(sample()));
    context.getAndClearSidWriteTracesPacked();
    let produced = 0;
    let checked = 0;
    while (produced < 88200) {
      const pcm = context.render(20000)!.slice();
      const packed = context.getAndClearSidWriteTracesPacked();
      const end = produced + pcm.length;
      for (let index = 0; index < packed.length; index += 4) {
        const time = times.get(packed[index + 3]);
        if (time === undefined) continue;
        const frame = time * 44100;
        // First-write calibration is sample-quantized; raw PCM counts independently bound its clock scale.
        assert.ok(frame >= produced - 1 && frame <= end + 1,
          `write at PCM frame ${frame} escaped raw interval ${produced}..${end}`);
        checked++;
      }
      produced = end;
    }
    assert.ok(checked > 200);
  } finally {
    context.delete();
    session.dispose();
  }
});

test('late PAL observations stay in their PCM intervals and match cached seek slices', async () => {
  const continuous = await SidSession.create();
  const replay = await loaded();
  try {
    const info = await continuous.load(sample(), options);
    const pcm = new Int16Array(32 * 44100);
    const writes: ReturnType<SidSession['render']>['writes'] = [];
    for (let frame = 0; frame < pcm.length;) {
      const block = continuous.render(44100);
      pcm.set(block.pcm, frame);
      for (const write of block.writes) {
        assert.ok(write.timeSeconds >= block.startFrame / 44100 && write.timeSeconds < block.endFrame / 44100,
          `write at ${write.timeSeconds}s escaped PCM interval ${block.startFrame / 44100}..${block.endFrame / 44100}`);
      }
      writes.push(...block.writes);
      frame = block.endFrame;
    }
    const seconds = 30.731234;
    const frame = Math.floor(seconds * 44100);
    const endFrame = frame + 4096;
    const expectedWrites = writes.filter((write) => write.timeSeconds >= frame / 44100 && write.timeSeconds < endFrame / 44100);
    const expectedRegisters = [...info.registers];
    for (const write of writes) {
      if (write.timeSeconds >= endFrame / 44100) break;
      expectedRegisters[write.address] = write.value;
    }
    await replay.seek(seconds);
    const actual = replay.render(4096);
    assert.deepEqual(actual.pcm, pcm.slice(frame, endFrame));
    assert.deepEqual(actual.writes, expectedWrites);
    assert.deepEqual(actual.registers, expectedRegisters);
  } finally {
    continuous.dispose();
    replay.dispose();
  }
});

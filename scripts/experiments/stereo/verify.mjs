import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [modulePath, receiptPath, mode, stockModulePath] = process.argv.slice(2);
assert.ok(modulePath && receiptPath, 'Usage: verify.mjs module.js result.json [--expect-missing-api | --compare-stock stock.js | --standalone]');
assert.ok([undefined, '--expect-missing-api', '--compare-stock', '--standalone'].includes(mode), 'Unknown verification mode');
const started = performance.now();
const createModule = (await import(pathToFileURL(resolve(modulePath)).href)).default;
const module = await createModule();
const stockModule = mode === '--compare-stock'
  ? await (await import(pathToFileURL(resolve(stockModulePath)).href)).default()
  : null;
const RATE = 44100;
const CYCLES = 20000;
const contexts = [];

function fixture(model, chips, activeChip) {
  const bytes = new Uint8Array(124 + 128);
  bytes.set([80, 83, 73, 68]);
  const header = new DataView(bytes.buffer);
  header.setUint16(4, chips === 2 ? 3 : 2);
  header.setUint16(6, 124);
  header.setUint16(8, 0x1000);
  header.setUint16(10, 0x1000);
  header.setUint16(12, 0x107f);
  header.setUint16(14, 1);
  header.setUint16(16, 1);
  const modelBits = model === 'MOS6581' ? 1 : 2;
  header.setUint16(118, 4 | (modelBits << 4) | (chips === 2 ? modelBits << 6 : 0));
  bytes[122] = chips === 2 ? 0x42 : 0;
  const program = [];
  const base = 0xd400 + Math.max(0, activeChip) * 0x20;
  // Relocating only absolute SID operands preserves C64 instruction timing;
  // the mono stock mixer is an independent unity-gain oracle for this fixture.
  for (const [register, value] of [[0, 0x34], [1, 0x12], [5, 0], [6, 0xf0], [0x18, 15], [4, 0x21]]) {
    const address = base + register;
    program.push(0xa9, activeChip === -1 && register === 4 ? 0 : value, 0x8d, address & 255, address >> 8);
  }
  program.push(0x60);
  bytes.set(program, 124);
  bytes[124 + 127] = 0x60;
  return bytes;
}

function context(model, chips, activeChip, stereo = chips === 2, wasmModule = module) {
  const player = new wasmModule.SidPlayerContext();
  contexts.push(player);
  assert.equal(player.configure(RATE, stereo), true);
  assert.equal(player.setEmulationConfig({ frequency: RATE, stereo, c64Model: 'PAL',
    forceC64Model: true, sidModel: model, forceSidModel: true, powerOnDelay: 0,
    secondSidAddress: 0, thirdSidAddress: 0 }), true);
  player.setSidWriteTraceEnabled(true);
  assert.equal(player.loadSidBuffer(fixture(model, chips, activeChip)), true, player.getLastError());
  assert.equal(player.getInstalledSids(), chips);
  assert.equal(player.getEngineInfo().builder, 'WasmSIDLite');
  assert.deepEqual(player.getEngineInfo().sidModels, Array(chips).fill(model));
  assert.deepEqual(player.getTuneInfo().sidChipBases, chips === 2 ? [0xd400, 0xd420] : [0xd400]);
  return player;
}

function render(player, method, channels, frames) {
  const blocks = [];
  const writes = [];
  let count = 0;
  let iterations = 0;
  while (count < frames) {
    assert.ok(++iterations < 1000, 'bounded synthetic fixture must produce samples');
    const block = player[method](CYCLES)?.slice();
    assert.ok(block, player.getLastError());
    assert.equal(block.length % channels, 0);
    blocks.push(block);
    count += block.length / channels;
    assert.equal(player.getDroppedSidWriteTraceCount(), 0);
    writes.push(...player.getAndClearSidWriteTracesPacked());
  }
  const pcm = new Int16Array(count * channels);
  let offset = 0;
  for (const block of blocks) { pcm.set(block, offset); offset += block.length; }
  return { pcm, writes, blocks };
}

function channelOracle(pcm, mono, idle, activeChip) {
  assert.equal(pcm.length, mono.length * 2, 'raw frame count');
  let peak = 0;
  for (let frame = 0; frame < mono.length; frame++) {
    assert.equal(pcm[frame * 2 + activeChip], mono[frame], 'active chip must equal independent mono at unity gain');
    assert.equal(pcm[frame * 2 + 1 - activeChip], idle[frame], 'idle chip must equal independent idle mono without crossfeed');
    peak = Math.max(peak, Math.abs(mono[frame]));
  }
  assert.ok(peak > 1000, 'oracle fixture must have substantial audible signal');
}

function mutate(pcm, mutation) {
  const result = pcm.slice();
  for (let offset = 0; offset < pcm.length; offset += 2) {
    const a = pcm[offset], b = pcm[offset + 1];
    switch (mutation) {
      case 'swapped': result[offset] = b; result[offset + 1] = a; break;
      case 'duplicated': result[offset] = a + b; result[offset + 1] = a + b; break;
      case 'crossfed': result[offset] = Math.trunc((a + 0.5 * b) / Math.SQRT2); result[offset + 1] = Math.trunc((0.5 * a + b) / Math.SQRT2); break;
      case 'attenuated': result[offset] = Math.trunc(a / 2); result[offset + 1] = Math.trunc(b / 2); break;
      default: throw new Error(`Unknown mutation ${mutation}`);
    }
  }
  return result;
}

function consumeWithRemainder(player, channels) {
  let pending = new Int16Array();
  let offset = 0;
  return (frames) => {
    const pcm = new Int16Array(frames * channels);
    let copied = 0;
    while (copied < pcm.length) {
      if (offset === pending.length) {
        pending = player.renderRaw(CYCLES)?.slice();
        assert.ok(pending?.length, 'raw replay must produce samples');
        offset = 0;
      }
      const take = Math.min(pending.length - offset, pcm.length - copied);
      pcm.set(pending.subarray(offset, offset + take), copied);
      offset += take;
      copied += take;
    }
    return pcm;
  };
}

const checks = [];
try {
  const probe = context('MOS6581', 2, 0);
  if (mode === '--expect-missing-api') {
    assert.equal(typeof probe.renderRaw, 'undefined', 'red guard requires the unmodified shipped binding');
    assert.throws(() => probe.renderRaw(CYCLES), /renderRaw/);
    for (const model of ['MOS6581', 'MOS8580']) {
      for (const activeChip of [0, 1]) {
        const mono = render(context(model, 1, 0), 'render', 1, RATE);
        const idle = render(context(model, 1, -1), 'render', 1, RATE).pcm;
        assert.ok(mono.pcm.some(sample => Math.abs(sample) > 1000));
        const mixed = render(context(model, 2, activeChip), 'render', 2, RATE);
        assert.throws(() => channelOracle(mixed.pcm, mono.pcm, idle, activeChip), /independent mono|crossfeed/);
        checks.push({ model, activeChip, frames: mono.pcm.length });
      }
    }
    writeFileSync(receiptPath, JSON.stringify({ status: 'red', checks,
      reason: 'shipped binding has no raw API and its mixed stereo fails independent mono routing' }, null, 2) + '\n');
    console.log('RED: stock binding lacks raw API; both models and A/B fixtures fail the unity/separation oracle.');
  } else {
    assert.equal(typeof probe.renderRaw, 'function', 'raw chip binding is required');
    for (const model of ['MOS6581', 'MOS8580']) {
      for (const activeChip of [0, 1]) {
        const monoPlayer = context(model, 1, 0);
        const rawPlayer = context(model, 2, activeChip);
        const mixedPlayer = context(model, 2, activeChip);
        const mono = render(monoPlayer, 'render', 1, RATE);
        // SIDLite's idle bus has DC; the shipped mono engine, not a zero constant,
        // settles the expected idle signal (Filter.cpp's digi/output path).
        const idle = render(context(model, 1, -1, false, stockModule ?? module), 'render', 1, RATE).pcm;
        if (stockModule) {
          const shippedMono = render(context(model, 1, 0, false, stockModule), 'render', 1, RATE);
          assert.deepEqual(mono.pcm, shippedMono.pcm, 'stock mono render must remain byte-identical to shipped WASM');
        }
        const raw = render(rawPlayer, 'renderRaw', 2, RATE);
        const mixed = render(mixedPlayer, 'render', 2, RATE);
        channelOracle(raw.pcm, mono.pcm, idle, activeChip);
        assert.throws(() => channelOracle(mixed.pcm, mono.pcm, idle, activeChip), /independent mono|crossfeed/,
          'stock crossfed renderer must fail the same independent routing oracle');
        for (const mutation of ['crossfed', 'swapped', 'attenuated', 'duplicated']) {
          assert.throws(() => channelOracle(mutate(raw.pcm, mutation), mono.pcm, idle, activeChip), /independent mono|crossfeed/);
        }
        const sidNumbers = [];
        for (let offset = 0; offset < raw.writes.length; offset += 4) sidNumbers.push(raw.writes[offset]);
        assert.ok(sidNumbers.includes(activeChip), 'trace must identify the active chip');
        for (let offset = 0; offset < raw.writes.length; offset += 4) {
          if (raw.writes[offset] !== activeChip) {
            // psiddrv.a65 initializes chip 0 volume before calling tune init.
            assert.deepEqual(raw.writes.slice(offset, offset + 3), [0, 0x18, 15]);
          }
        }
        assert.equal(rawPlayer.getSidStatus(activeChip)[4], 0x21);
        assert.equal(rawPlayer.getSidStatus(1 - activeChip)[4], 0);
        assert.equal(rawPlayer.getSidStatus(1 - activeChip)[0x18], activeChip === 1 ? 15 : 0);

        const replay = consumeWithRemainder(context(model, 2, activeChip), 2);
        const target = 12347;
        let boundary = 0;
        for (const block of raw.blocks) {
          boundary += block.length / 2;
          assert.notEqual(target, boundary, 'seek target must lie inside a native block');
        }
        const before = replay(target);
        const continuation = replay(4093);
        assert.deepEqual(before, raw.pcm.slice(0, target * 2));
        assert.deepEqual(continuation, raw.pcm.slice(target * 2, (target + 4093) * 2),
          'non-block-aligned replay must retain both channels of the final block remainder');
        const rawMono = render(context(model, 1, 0), 'renderRaw', 1, RATE);
        assert.deepEqual(rawMono.pcm, mono.pcm, 'raw mono must preserve stock mono PCM');
        const mixerIndependent = render(context(model, 2, activeChip, false), 'renderRaw', 2, RATE);
        assert.deepEqual(mixerIndependent.pcm, raw.pcm, 'raw channel layout must be independent of stock mixer mode');
        checks.push({ model, activeChip, frames: mono.pcm.length,
          pcmSha256: createHash('sha256').update(new Uint8Array(raw.pcm.buffer)).digest('hex'),
          traceWrites: sidNumbers.length, seekFrame: target, continuationFrames: 4093 });
        console.log(`PASS: ${model}, chip ${activeChip + 1}; unity mono, independent idle mono, mutations, traces and seek remainder.`);
      }
    }
    const receipt = { date: new Date().toISOString(), node: process.version, status: 'passed', checks,
      shippedMonoCompared: Boolean(stockModule),
      provenanceSha256: mode === '--standalone' ? null
        : createHash('sha256').update(readFileSync(resolve(dirname(modulePath), 'provenance.json'))).digest('hex'),
      verifierSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
      elapsedSeconds: (performance.now() - started) / 1000,
      scope: 'Real modified WASM, synthetic callable PSIDs, both SIDLite models; no browser, full arrangement or listening claim.' };
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify(receipt, null, 2));
  }
} finally {
  for (const player of contexts) player.delete();
}

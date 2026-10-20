import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {syntheticSid} from './fixtures.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const RATE = 44100;
const CYCLES = 20000;
const COMPLETE_SECONDS = 193.35884353741497;
const CACHE_BYTES = 32 * 1024 * 1024;
const WORKING_RESERVE_BYTES = 1024 * 1024;
const RECORD_BYTES = 10;
const CHECKPOINT_WORDS = 8;
const options = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const name = process.argv[index];
  assert.ok(name.startsWith('--') && !options.has(name), `Invalid or repeated option: ${name}`);
  if (name === '--expect-missing-api') options.set(name, true);
  else {
    assert.ok(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), `Missing value for ${name}`);
    options.set(name, process.argv[++index]);
  }
}
for (const name of options.keys()) assert.ok(['--module', '--raw-module', '--stock-module', '--sample', '--output', '--model', '--clock', '--seconds', '--expect-missing-api'].includes(name), `Unknown option: ${name}`);
const model = options.get('--model') ?? 'MOS6581';
const clock = options.get('--clock') ?? 'PAL';
assert.ok(['MOS6581', 'MOS8580'].includes(model), 'Unsupported model');
assert.ok(['PAL', 'NTSC'].includes(clock), 'Unsupported clock');
const seconds = Number(options.get('--seconds') ?? COMPLETE_SECONDS);
assert.ok(Number.isFinite(seconds) && seconds > 0 && seconds <= COMPLETE_SECONDS, 'seconds must be positive and no greater than the complete sample');
const paths = {
  module: resolve(ROOT, options.get('--module') ?? 'build/live-voice-replay/output/libsidplayfp.js'),
  raw: resolve(ROOT, options.get('--raw-module') ?? 'build/stereo-gate/output/libsidplayfp.js'),
  stock: resolve(ROOT, options.get('--stock-module') ?? 'node_modules/libsidplayfp-wasm/dist/sidlite/libsidplayfp.js'),
  sample: resolve(ROOT, options.get('--sample') ?? 'public/generated/rambo-loader-main.sid'),
  output: resolve(ROOT, options.get('--output') ?? `build/live-voice-replay/result-${model}-${clock}.json`),
};
const started = performance.now();
const checks = [];
const contexts = new Set();
let diagnostic = {profile: `${model}/${clock}`, frame: 0};
mkdirSync(dirname(paths.output), {recursive: true});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const typedBytes = view => new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
const bounded = () => assert.ok(performance.now() - started < 59_000, 'Verifier exceeded its 59-second execution budget');
const release = context => { context.delete(); contexts.delete(context); };

function compare(actual, expected, label, frame, chips, records = null) {
  assert.equal(actual.length, expected.length, `${label}: sample count at frame ${frame}`);
  for (let index = 0; index < actual.length; index++) {
    if (actual[index] === expected[index]) continue;
    const offset = Math.floor(index / chips);
    diagnostic = {...diagnostic, frame: frame + offset, chip: index % chips, label,
      expected: expected[index], actual: actual[index],
      nearbyRecords: records ? Array.from(records.subarray(Math.max(0, offset - 2) * chips * RECORD_BYTES, (offset + 3) * chips * RECORD_BYTES)) : []};
    throw new Error(`${label}: first differing frame ${frame + offset}, chip ${index % chips + 1}: ${actual[index]} != ${expected[index]}`);
  }
}

function assertDifferent(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label}: sample count`);
  assert.ok(actual.some((sample, index) => sample !== expected[index]), `${label}: mutation escaped the PCM oracle`);
}

function context(module, bytes, chips, trace = false) {
  const player = new module.SidPlayerContext();
  contexts.add(player);
  assert.equal(player.configure(RATE, chips === 2), true);
  assert.equal(player.setEmulationConfig({frequency: RATE, stereo: chips === 2, c64Model: clock,
    forceC64Model: true, sidModel: model, forceSidModel: true, powerOnDelay: 0,
    secondSidAddress: 0, thirdSidAddress: 0}), true);
  player.setSidWriteTraceEnabled(trace);
  assert.equal(player.loadSidBuffer(bytes), true, player.getLastError());
  assert.equal(player.getInstalledSids(), chips);
  assert.equal(player.getEngineInfo().builder, 'WasmSIDLite');
  assert.deepEqual(player.getEngineInfo().sidModels, Array(chips).fill(model));
  return player;
}

function capture(player, chips) {
  const result = player.renderCapture(CYCLES);
  assert.ok(result, player.getLastError());
  const block = {pcm: result.pcm.slice(), records: result.records.slice(), checkpoint: result.checkpoint.slice(),
    frames: result.frames, chips: result.chips};
  assert.equal(block.chips, chips);
  assert.ok(Number.isSafeInteger(block.frames) && block.frames >= 0 && block.frames <= 4096, 'bounded capture frame count');
  assert.equal(block.pcm.length, block.frames * chips);
  assert.equal(block.records.byteLength, block.frames * chips * RECORD_BYTES);
  if (block.frames) {
    assert.equal(block.checkpoint.length, chips * CHECKPOINT_WORDS);
    for (let chip = 0; chip < chips; chip++) {
      assert.equal(block.checkpoint[chip * CHECKPOINT_WORDS], 1, 'checkpoint version');
      assert.equal(block.checkpoint[chip * CHECKPOINT_WORDS + 7], RATE, 'checkpoint rate');
      assert.equal(block.checkpoint[chip * CHECKPOINT_WORDS + 6] & 1, Number(model === 'MOS8580'), 'checkpoint model');
    }
  }
  return block;
}

class RetainedRing {
  constructor(chips) {
    this.blocks = [];
    this.bytes = 0;
    this.peakBytes = 0;
    this.evictedBlocks = 0;
    this.totalFrames = 0;
    this.recordBytes = 0;
    this.checkpointBytes = 0;
    this.observationBytes = 0;
    this.peakInFlightBoundBytes = 0;
    this.chips = chips;
    this.queueFrames = Math.ceil(RATE * 0.25) + 4096;
    this.queueBytes = this.queueFrames * chips * (RECORD_BYTES + Float32Array.BYTES_PER_ELEMENT);
    this.cap = CACHE_BYTES - WORKING_RESERVE_BYTES - this.queueBytes;
  }
  add(block, traces, startFrame, referenceBytes) {
    const capturedBytes = block.records.byteLength + block.pcm.byteLength + block.checkpoint.byteLength;
    const packedWriteBytes = traces.length / 4 * 5 * Float64Array.BYTES_PER_ELEMENT;
    // checkpointContinuation and mutationChecks create bounded copies; reserve both scratch allowances conservatively.
    const replayScratchBytes = block.records.byteLength + block.pcm.byteLength * 4 + block.checkpoint.byteLength * 3;
    const inFlightBound = capturedBytes + replayScratchBytes + traces.byteLength + packedWriteBytes + referenceBytes + this.chips * 32;
    this.peakInFlightBoundBytes = Math.max(this.peakInFlightBoundBytes, inFlightBound);
    assert.ok(inFlightBound <= WORKING_RESERVE_BYTES, 'capture/replay scratch exceeds its retained-budget reservation');
    const writes = new Float64Array(traces.length / 4 * 5);
    for (let read = 0, write = 0; read < traces.length; read += 4, write += 5) {
      writes.set(traces.subarray(read, read + 4), write);
    }
    const registers = new Uint8Array(this.chips * 32);
    const bytes = block.records.byteLength + block.checkpoint.byteLength + writes.byteLength + registers.byteLength;
    assert.ok(bytes <= this.cap, 'one capture block exceeds the retained-data cap');
    while (this.bytes + bytes > this.cap) {
      const oldest = this.blocks.shift();
      this.bytes -= oldest.bytes;
      this.evictedBlocks++;
    }
    this.blocks.push({records: block.records, checkpoint: block.checkpoint, writes, registers,
      startFrame, endFrame: startFrame + block.frames, bytes});
    this.bytes += bytes;
    this.peakBytes = Math.max(this.peakBytes, this.bytes);
    this.totalFrames += block.frames;
    this.recordBytes += block.records.byteLength;
    this.checkpointBytes += block.checkpoint.byteLength;
    this.observationBytes += writes.byteLength + registers.byteLength;
    assert.ok(this.bytes + this.queueBytes + WORKING_RESERVE_BYTES <= CACHE_BYTES);
  }
  result() {
    return {capBytes: CACHE_BYTES, retainedCapBytes: this.cap, retainedTypedBytes: this.bytes,
      peakRetainedTypedBytes: this.peakBytes, retainedStartFrame: this.blocks[0].startFrame,
      retainedEndFrame: this.blocks.at(-1).endFrame,
      retainedSeconds: (this.blocks.at(-1).endFrame - this.blocks[0].startFrame) / RATE,
      evictedBlocks: this.evictedBlocks, recordBytesPerFrame: RECORD_BYTES * this.chips,
      checkpointBytesPerBlock: CHECKPOINT_WORDS * Int32Array.BYTES_PER_ELEMENT * this.chips,
      producedRecordBytes: this.recordBytes, producedCheckpointBytes: this.checkpointBytes,
      producedObservationBytes: this.observationBytes,
      peakInFlightTypedBoundBytes: this.peakInFlightBoundBytes,
      modeledQueue: {frames: this.queueFrames, bytes: this.queueBytes,
        scope: 'One raw-record queue plus final Float32 output for the current 0.25-second scheduling horizon and one 4096-frame block; no browser queue was executed.'},
      workingReserveBytes: WORKING_RESERVE_BYTES,
      scope: 'Measured JS typed records, explicit filter checkpoints and production-width packed-write/register payloads. The reserve and queue model are deducted from 32 MiB. Engine WASM heaps, JS objects and the existing overview archive are outside this retained-data measurement.'};
  }
}

function checkpointContinuation(module, block, expected, frame, mask) {
  if (block.frames < 5) return;
  const replay = new module.VoiceReplay(block.checkpoint);
  let restored;
  try {
    const prefixFrames = Math.min(137, block.frames - 1);
    const prefixBytes = prefixFrames * block.chips * RECORD_BYTES;
    const prefix = replay.render(block.records.subarray(0, prefixBytes), mask).slice();
    compare(prefix, expected.subarray(0, prefixFrames * block.chips), 'non-block prefix', frame, block.chips, block.records);
    const checkpoint = replay.checkpoint().slice();
    restored = new module.VoiceReplay(checkpoint);
    const suffix = replay.render(block.records.subarray(prefixBytes), mask).slice();
    const restoredSuffix = restored.render(block.records.subarray(prefixBytes), mask).slice();
    compare(suffix, expected.subarray(prefixFrames * block.chips), 'non-block continuation', frame + prefixFrames, block.chips, block.records.subarray(prefixBytes));
    compare(restoredSuffix, suffix, 'restored filter continuation', frame + prefixFrames, block.chips, block.records.subarray(prefixBytes));
    replay.restore(checkpoint);
    compare(replay.render(block.records.subarray(prefixBytes), mask).slice(), suffix, 'explicit restore continuation', frame + prefixFrames, block.chips);
  } finally { replay.delete(); restored?.delete(); }
}

function mutationChecks(module, block, expected, kind, accepted) {
  const mask = (1 << (block.chips * 3)) - 1;
  const mutatedOutput = (records, checkpoint = block.checkpoint) => {
    const replay = new module.VoiceReplay(checkpoint);
    try { return replay.render(records, mask).slice(); }
    finally { replay.delete(); }
  };
  if (!accepted.has('routing') && block.chips === 2) {
    const swapped = block.records.slice();
    for (let offset = 0; offset < swapped.length; offset += RECORD_BYTES * 2) {
      swapped.set(block.records.subarray(offset + RECORD_BYTES, offset + RECORD_BYTES * 2), offset);
      swapped.set(block.records.subarray(offset, offset + RECORD_BYTES), offset + RECORD_BYTES);
    }
    if (mutatedOutput(swapped).some((sample, index) => sample !== expected[index])) {
      assertDifferent(mutatedOutput(swapped), expected, 'swapped chip records');
      accepted.add('routing');
    }
  }
  if (!accepted.has('control alignment') && ['filter', 'd418'].includes(kind)) {
    const shifted = block.records.slice();
    let changed = false;
    for (let frame = 0; frame + 1 < block.frames; frame++) {
      for (let chip = 0; chip < block.chips; chip++) {
        const offset = (frame * block.chips + chip) * RECORD_BYTES + 6;
        const next = offset + block.chips * RECORD_BYTES;
        for (let index = 0; index < 4; index++) {
          changed ||= shifted[offset + index] !== block.records[next + index];
          shifted[offset + index] = block.records[next + index];
        }
      }
    }
    if (changed) {
      assertDifferent(mutatedOutput(shifted), expected, 'controls shifted one sample early');
      accepted.add('control alignment');
    }
  }
  if (!accepted.has('filter history') && kind === 'filter') {
    const checkpoint = block.checkpoint.slice();
    for (let chip = 0; chip < block.chips; chip++) {
      checkpoint[chip * CHECKPOINT_WORDS + 2] ^= 0x10000;
      checkpoint[chip * CHECKPOINT_WORDS + 3] ^= 0x10000;
    }
    assertDifferent(mutatedOutput(block.records, checkpoint), expected, 'corrupt shared-filter history');
    accepted.add('filter history');
  }
}

async function verifyPerformance(module, rawModule, stockModule, bytes, {name, chips, frames, kind}) {
  diagnostic = {profile: `${model}/${clock}/${name}`, frame: 0, sidSha256: sha256(bytes)};
  const players = [context(module, bytes, chips, true), context(rawModule, bytes, chips),
    ...(chips === 1 ? [context(stockModule, bytes, chips)] : [])];
  const ring = new RetainedRing(chips);
  const hash = createHash('sha256');
  const negative = new Set();
  let replay;
  let cursor = 0;
  let empty = 0;
  let continuationChecks = 0;
  let nextContinuation = 0;
  const mask = (1 << (chips * 3)) - 1;
  const partialMask = chips === 1 ? 1 : 17;
  let selectedVoiceSamplesDiffer = false;
  let selectedVoiceChecks = 0;
  // Gate suppression is an independent oracle only for the uncoupled, unfiltered saw fixture (live-voice/probe.cpp).
  let partial = kind === 'saw' ? context(rawModule, syntheticSid({model, clock, kind, chips, voiceMask: partialMask}), chips) : null;
  try {
    while (cursor < frames) {
      bounded();
      diagnostic.frame = cursor;
      const block = capture(players[0], chips);
      const raw = players[1].renderRaw(CYCLES)?.slice();
      const stock = chips === 1 ? players[2].render(CYCLES)?.slice() : null;
      const expectedSelected = partial && cursor < RATE ? partial.renderRaw(CYCLES)?.slice() : null;
      assert.ok(raw && (chips !== 1 || stock), 'reference render stopped');
      compare(block.pcm, raw, 'capture versus adopted raw WASM', cursor, chips, block.records);
      if (stock) compare(block.pcm, stock, 'capture versus shipped mono WASM', cursor, chips, block.records);
      assert.equal(players[0].getTimeMs(), players[1].getTimeMs(), `capture changed C64 time at frame ${cursor}`);
      for (let chip = 0; chip < chips; chip++) {
        assert.deepEqual(players[0].getSidStatus(chip), players[1].getSidStatus(chip), `capture changed chip ${chip + 1} registers at frame ${cursor}`);
      }
      assert.equal(players[0].getDroppedSidWriteTraceCount(), 0, 'capture trace overflow');
      const traces = players[0].getAndClearSidWriteTracesPacked().slice();
      assert.equal(traces.length % 4, 0);
      if (!block.frames) { assert.ok(++empty < 64, 'capture produced no samples'); continue; }
      empty = 0;
      if (!replay) replay = new module.VoiceReplay(block.checkpoint);
      else assert.deepEqual(replay.checkpoint().slice(), block.checkpoint, `canonical filter checkpoint differs at frame ${cursor}`);
      const output = replay.render(block.records, mask).slice();
      compare(output, raw, 'prefilter replay versus adopted raw WASM', cursor, chips, block.records);
      if (partial && cursor < RATE) {
        assert.ok(expectedSelected, 'selected-voice reference stopped');
        const selectedReplay = new module.VoiceReplay(block.checkpoint);
        try {
          const selected = selectedReplay.render(block.records, partialMask).slice();
          compare(selected, expectedSelected, 'selected voices versus independent gate-off fixture', cursor, chips, block.records);
          selectedVoiceSamplesDiffer ||= selected.some((sample, index) => sample !== raw[index]);
          selectedVoiceChecks += block.frames;
        } finally { selectedReplay.delete(); }
      } else if (partial) { release(partial); partial = null; }
      hash.update(typedBytes(output));
      if (cursor >= nextContinuation) {
        checkpointContinuation(module, block, raw, cursor, mask);
        continuationChecks++;
        nextContinuation = cursor + RATE;
      }
      if (kind) mutationChecks(module, block, raw, kind, negative);
      ring.add(block, traces, cursor, raw.byteLength + (stock?.byteLength ?? 0));
      cursor += block.frames;
    }
    if (kind && chips === 2) assert.ok(negative.has('routing'), 'asymmetric stereo fixture did not expose swapped routing');
    if (kind === 'saw') assert.ok(selectedVoiceSamplesDiffer, 'voice selection must change the sustained fixture output');
    if (kind === 'filter') assert.ok(negative.has('filter history'), 'filter fixture did not test checkpoint corruption');
    if (['filter', 'd418'].includes(kind)) assert.ok(negative.has('control alignment'), `${kind} fixture did not expose one-sample control misalignment`);
    const result = {name, chips, model, clock, sidSha256: sha256(bytes), requestedFrames: frames,
      comparedFrames: cursor, pcmSha256: hash.digest('hex'), checkpointContinuationChecks: continuationChecks,
      selectedVoiceChecks, rejectedMutations: [...negative], memory: ring.result()};
    if (kind === 'saw' && frames >= RATE * 45) assert.ok(ring.evictedBlocks > 0, 'long stereo fixture must exercise retained-data eviction');
    checks.push(result);
    console.log(`PASS ${model}/${clock}/${name}: ${cursor} exact frames; ${continuationChecks} checkpoint continuations; ${ring.bytes} retained typed bytes.`);
  } finally {
    replay?.delete();
    if (partial) release(partial);
    for (const player of players) release(player);
  }
}

try {
  const module = await (await import(pathToFileURL(paths.module).href)).default();
  const probe = context(module, syntheticSid({model, clock, kind: 'saw'}), 1);
  if (options.has('--expect-missing-api')) {
    assert.equal(typeof probe.renderCapture, 'undefined', 'red check requires a module without capture support');
    assert.equal(typeof module.VoiceReplay, 'undefined', 'red check requires a module without replay support');
    writeFileSync(paths.output, JSON.stringify({status: 'red', model, clock,
      reason: 'The adopted binding exposes post-filter chip buses but lacks prefilter capture and explicit filter replay.'}, null, 2) + '\n');
    console.log('RED: adopted raw-chip binding lacks prefilter capture and VoiceReplay.');
  } else {
    assert.equal(typeof probe.renderCapture, 'function', 'experimental prefilter capture API is required');
    assert.equal(typeof module.VoiceReplay, 'function', 'experimental shared-filter replay API is required');
    release(probe);
    const rawModule = await (await import(pathToFileURL(paths.raw).href)).default();
    const stockModule = await (await import(pathToFileURL(paths.stock).href)).default();
    const sample = new Uint8Array(readFileSync(paths.sample));
    await verifyPerformance(module, rawModule, stockModule, sample,
      {name: 'complete Rambo', chips: 1, frames: Math.round(seconds * RATE)});
    for (const kind of ['saw', 'ring-sync', 'filter', 'd418', 'noise']) {
      await verifyPerformance(module, rawModule, stockModule, syntheticSid({model, clock, kind, chips: 2}),
        {name: `synthetic ${kind}`, kind, chips: 2, frames: kind === 'saw' ? RATE * 45 : RATE});
    }
    const checkpoint = Int32Array.from([1, 0, 0, 0, 0, 0, model === 'MOS8580' ? 3 : 2, RATE]);
    const badVersion = checkpoint.slice();
    badVersion[0] = 2;
    assert.throws(() => new module.VoiceReplay(badVersion), undefined, 'wrong checkpoint version must fail');
    assert.throws(() => new module.VoiceReplay(checkpoint.subarray(1)), undefined, 'truncated checkpoint must fail');
    const receipt = {date: new Date().toISOString(), status: seconds === COMPLETE_SECONDS ? 'passed' : 'partial',
      model, clock, node: process.version, elapsedSeconds: (performance.now() - started) / 1000,
      completeRambo: seconds === COMPLETE_SECONDS, sampleRate: RATE, renderCycles: CYCLES,
      verifierSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
      moduleSha256: sha256(readFileSync(paths.module)),
      wasmSha256: sha256(readFileSync(resolve(dirname(paths.module), 'libsidplayfp.wasm'))),
      rawOracleSha256: sha256(readFileSync(paths.raw)),
      rawOracleWasmSha256: sha256(readFileSync(resolve(dirname(paths.raw), 'libsidplayfp.wasm'))),
      stockOracleSha256: sha256(readFileSync(paths.stock)),
      stockOracleWasmSha256: sha256(readFileSync(resolve(dirname(paths.stock), 'libsidplayfp.wasm'))),
      fixturesSha256: sha256(readFileSync(new URL('./fixtures.mjs', import.meta.url))), checks,
      scope: 'Real-WASM all-unity prefilter/shared-filter replay, canonical checkpoint continuation and bounded retained-data measurement. No voice-switch/browser scheduling, audible continuity, production integration or listening acceptance claim.'};
    writeFileSync(paths.output, JSON.stringify(receipt, null, 2) + '\n');
    console.log(`${receipt.status.toUpperCase()}: ${checks.length} streamed performances; receipt ${paths.output}`);
  }
} catch (error) {
  const failure = {...diagnostic, message: error instanceof Error ? error.message : String(error),
    elapsedSeconds: (performance.now() - started) / 1000, completedChecks: checks};
  writeFileSync(paths.output, JSON.stringify({status: 'failed', ...failure}, null, 2) + '\n');
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
} finally {
  for (const player of contexts) player.delete();
}

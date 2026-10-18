import loadLibsidplayfp from 'libsidplayfp-wasm';
import type { LibsidplayfpWasmModule, SidPlayerContext } from 'libsidplayfp-wasm/dist/libsidplayfp.js';

export const SAMPLE_RATE = 44100;
const MAX_RENDER_FRAMES = SAMPLE_RATE * 2;
const MAX_SEEK_SECONDS = 600;
const MAX_FILE_BYTES = 65536 + 126;
const RAW_RENDER_CYCLES = 20000;
const OPERATION_BUDGET_MS = 15000;
const CLOCK_HZ = { PAL: 4433618.75 * 4 / 18, NTSC: 3579545.455 * 4 / 14 };

function sidlitePcmClockHz(clockHz: number): number {
  // SIDLite's SID::setSamplingParameters and sl_constants.h quantize the clock to four fractional bits;
  // trace delivery must follow that produced-PCM rate to avoid accumulating nominal-clock drift.
  return Math.floor(Math.trunc(clockHz) * 16 / SAMPLE_RATE) / 16 * SAMPLE_RATE;
}

const PCM_CLOCK_HZ = { PAL: sidlitePcmClockHz(CLOCK_HZ.PAL), NTSC: sidlitePcmClockHz(CLOCK_HZ.NTSC) };

export interface PlaybackOptions {
  clock: 'PAL' | 'NTSC';
  model: 'MOS6581' | 'MOS8580';
  subtune: number;
}

export type MuteMask = [boolean, boolean, boolean];

export interface SidWrite {
  timeSeconds: number;
  cyclePhi1: number;
  address: number;
  value: number;
  sidNumber: number;
}

export interface LoadResult extends PlaybackOptions {
  title: string;
  author: string;
  released: string;
  songs: number;
  installedSids: number;
  sampleRate: number;
  registers: number[];
  engine: {
    builder: string;
    version: string;
    requestedPowerOnDelay: number;
    effectivePowerOnDelay: number;
    songSpeed: 'VBI' | 'CIA';
    ciaModel: string;
    samplingMethod: string;
    digiBoost: boolean;
    traceCycleOrigin: number;
    traceTimeBasis: string;
  };
}

export interface RenderResult {
  pcm: Int16Array;
  startFrame: number;
  endFrame: number;
  writes: SidWrite[];
  registers: number[];
  dropped: number;
}

export interface PositionResult {
  frame: number;
  registers: number[];
}

export interface SessionOptions {
  wasmUrl?: string;
}

interface LiveState {
  context: SidPlayerContext;
  bytes: Uint8Array;
  options: PlaybackOptions;
  mask: MuteMask;
  consumedFrame: number;
  pendingPcm: Int16Array;
  pendingOffset: number;
  pendingWrites: SidWrite[];
  registers: number[];
  traceCycleOrigin: number;
  dropped: number;
  failed: boolean;
}

function validateInput(bytes: Uint8Array, options: PlaybackOptions): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error(`SID file size must be at most ${MAX_FILE_BYTES} bytes`);
  }
  if (bytes.byteLength < 118) throw new Error('Incomplete PSID header (at least 118 bytes required)');
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic === 'RSID') throw new Error('RSID requires a complete C64/ROM environment; this prototype supports callable mono PSID only');
  if (magic !== 'PSID') throw new Error('Unsupported file: expected a PSID header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4);
  if (version < 1 || version > 4) throw new Error('Supported PSID versions are 1 through 4');
  const expectedOffset = version === 1 ? 118 : 124;
  const dataOffset = view.getUint16(6);
  if (dataOffset !== expectedOffset || bytes.byteLength <= dataOffset) {
    throw new Error(`PSID data offset must be ${expectedOffset} with a nonempty payload`);
  }
  const songs = view.getUint16(14);
  if (songs < 1 || songs > 256) throw new Error('PSID song count must be between 1 and 256');
  if (!options || (options.clock !== 'PAL' && options.clock !== 'NTSC')) throw new Error('clock must be PAL or NTSC');
  if (options.model !== 'MOS6581' && options.model !== 'MOS8580') throw new Error('model must be MOS6581 or MOS8580');
  if (!Number.isInteger(options.subtune) || options.subtune < 1 || options.subtune > songs) {
    throw new Error(`subtune must be a one-based integer between 1 and ${songs}`);
  }
  if (version >= 2) {
    const flags = view.getUint16(118);
    if (flags & 1) throw new Error('MUS payloads are unsupported; open a callable mono PSID');
    if (flags & 2) throw new Error('PlaySID-specific compatibility is unsupported; open a C64-compatible mono PSID');
    if (bytes[122] || bytes[123]) throw new Error('This prototype supports one mono SID; additional SID addresses are unsupported');
  }
  if (view.getUint16(12) === 0) {
    throw new Error('PSID play address is zero: interrupt/ROM-driven tunes are outside this callable-player subset');
  }
  let loadAddress = view.getUint16(8);
  let payloadOffset = dataOffset;
  if (loadAddress === 0) {
    if (bytes.byteLength < dataOffset + 3) throw new Error('PSID payload lacks its little-endian load address and program');
    loadAddress = view.getUint16(dataOffset, true);
    payloadOffset += 2;
  }
  if (loadAddress + bytes.byteLength - payloadOffset > 65536) throw new Error('PSID payload exceeds C64 memory');
}

function deadlineExceeded(deadline: number): void {
  if (performance.now() > deadline) throw new Error('SID execution exceeded the 15-second operation budget');
}

function copyRegisters(state: LiveState): number[] {
  return state.registers.slice();
}

/** Mono SIDLite playback. The caller serializes operations; the worker supplies that boundary. */
export class SidSession {
  private readonly loaderOptions: SessionOptions;
  private module: LibsidplayfpWasmModule | undefined;
  private state: LiveState | undefined;
  private disposed = false;

  private constructor(options: SessionOptions) {
    this.loaderOptions = { ...options };
  }

  static async create(options: SessionOptions = {}): Promise<SidSession> {
    return new SidSession(options);
  }

  private requireAlive(): void {
    if (this.disposed) throw new Error('SID session has been disposed');
  }

  private requireState(): LiveState {
    this.requireAlive();
    if (!this.state) throw new Error('Load a SID before playback');
    if (this.state.failed) throw new Error('SID render failed; reload the file before continuing');
    return this.state;
  }

  async load(bytes: Uint8Array, options: PlaybackOptions): Promise<LoadResult> {
    this.requireAlive();
    validateInput(bytes, options);
    const original = bytes.slice();
    const selected = { ...options };
    if (!this.module) {
      const wasmUrl = this.loaderOptions.wasmUrl;
      this.module = await loadLibsidplayfp({ engine: 'sidlite', ...(wasmUrl ? { locateFile: () => wasmUrl } : {}) });
    }
    this.requireAlive();
    const state = this.createState(original, selected, [false, false, false]);
    const info = state.context.getTuneInfo()!;
    const engine = state.context.getEngineInfo();
    const configuration = state.context.getEmulationConfig();
    this.replaceState(state);
    return {
      title: info.infoStrings[0] ?? '',
      author: info.infoStrings[1] ?? '',
      released: info.infoStrings[2] ?? '',
      songs: info.songs,
      ...selected,
      installedSids: engine.installedSids,
      sampleRate: SAMPLE_RATE,
      registers: copyRegisters(state),
      engine: {
        builder: engine.builder,
        version: engine.version,
        requestedPowerOnDelay: 0,
        effectivePowerOnDelay: engine.powerOnDelay,
        songSpeed: info.songSpeed === 60 ? 'CIA' : 'VBI',
        ciaModel: configuration.ciaModel,
        samplingMethod: configuration.samplingMethod,
        digiBoost: configuration.digiBoost,
        traceCycleOrigin: state.traceCycleOrigin,
        traceTimeBasis: 'first-write calibrated to SIDLite quantized PCM clock; sample-quantized, resampler latency unmeasured',
      },
    };
  }

  private createState(bytes: Uint8Array, options: PlaybackOptions, mask: MuteMask): LiveState {
    const context = new this.module!.SidPlayerContext();
    try {
      if (!context.configure(SAMPLE_RATE, false) || !context.setEmulationConfig({
        frequency: SAMPLE_RATE,
        stereo: false,
        c64Model: options.clock,
        forceC64Model: true,
        sidModel: options.model,
        forceSidModel: true,
        powerOnDelay: 0,
        secondSidAddress: 0,
        thirdSidAddress: 0,
      })) throw new Error(`Could not configure SIDLite: ${context.getLastError()}`);
      context.setSidWriteTraceEnabled(true);
      const patched = bytes.slice();
      new DataView(patched.buffer).setUint16(16, options.subtune);
      if (!context.loadSidBuffer(patched)) throw new Error(`Could not load PSID: ${context.getLastError()}`);
      const info = context.getTuneInfo();
      const engine = context.getEngineInfo();
      const configured = context.getEmulationConfig();
      if (!info || info.currentSong !== options.subtune || engine.installedSids !== 1 || engine.builder !== 'WasmSIDLite' ||
        engine.sidModels[0] !== options.model || configured.c64Model !== options.clock ||
        configured.frequency !== SAMPLE_RATE || configured.stereo || configured.powerOnDelay !== 0) {
        throw new Error('Engine did not install the selected mono SIDLite configuration');
      }
      const state: LiveState = {
        context, bytes, options, mask: [...mask], consumedFrame: 0,
        pendingPcm: new Int16Array(), pendingOffset: 0, pendingWrites: [],
        registers: Array.from(context.getSidStatus(0) ?? new Uint8Array(32)),
        traceCycleOrigin: 0, dropped: 0, failed: false,
      };
      const deadline = performance.now() + OPERATION_BUDGET_MS;
      let probeFrames = 0;
      // The binding exposes scheduler-cycle writes but not its startup cycle origin.
      // A one-event dry render ties that origin to produced PCM. The raw-PCM oracle
      // in engine.test.ts requires resetting afterward because SIDLite is render-partition sensitive.
      for (let probe = 0; probe < RAW_RENDER_CYCLES; probe++) {
        deadlineExceeded(deadline);
        const pcm = context.render(1)?.slice();
        if (!pcm) throw new Error(`SID startup render stopped: ${context.getLastError()}`);
        if (pcm.length) {
          probeFrames += pcm.length;
        }
        state.dropped += context.getDroppedSidWriteTraceCount();
        const packed = context.getAndClearSidWriteTracesPacked();
        if (!packed.length) continue;
        state.traceCycleOrigin = packed[3] - probeFrames * PCM_CLOCK_HZ[options.clock] / SAMPLE_RATE;
        if (!context.reset()) throw new Error(`Could not reset after SID clock calibration: ${context.getLastError()}`);
        context.getAndClearSidWriteTracesPacked();
        state.dropped = 0;
        state.registers = Array.from(context.getSidStatus(0) ?? new Uint8Array(32));
        for (let voice = 0; voice < 3; voice++) {
          if (!context.mute(0, voice, mask[voice])) throw new Error(`Could not restore SID mute mask: ${context.getLastError()}`);
        }
        return state;
      }
      throw new Error('No startup SID writes within the bounded PSID probe; this ROM/interrupt or delayed-init profile is unsupported');
    } catch (error) {
      context.delete();
      throw error;
    }
  }

  private appendWrites(state: LiveState, packed: Float64Array): void {
    for (let index = 0; index < packed.length; index += 4) {
      const cyclePhi1 = packed[index + 3];
      state.pendingWrites.push({
        sidNumber: packed[index], address: packed[index + 1], value: packed[index + 2], cyclePhi1,
        timeSeconds: (cyclePhi1 - state.traceCycleOrigin) / PCM_CLOCK_HZ[state.options.clock],
      });
    }
  }

  render(frames: number): RenderResult {
    const state = this.requireState();
    if (!Number.isInteger(frames) || frames < 1 || frames > MAX_RENDER_FRAMES) {
      throw new Error(`frames must be an integer between 1 and ${MAX_RENDER_FRAMES}`);
    }
    return this.consume(state, frames, true, performance.now() + OPERATION_BUDGET_MS);
  }

  private consume(state: LiveState, frames: number, retainPcm: boolean, deadline: number): RenderResult {
    const pcm = new Int16Array(retainPcm ? frames : 0);
    const startFrame = state.consumedFrame;
    let copied = 0;
    let emptyReads = 0;
    let calls = 0;
    const callBudget = Math.ceil(frames / 256) + 64;
    try {
      while (copied < frames) {
        deadlineExceeded(deadline);
        if (state.pendingOffset >= state.pendingPcm.length) {
          if (++calls > callBudget) throw new Error('SID render exhausted its bounded sample-production budget');
          // render() owns a heap view; copying before any further WASM call is required by the binding contract.
          const chunk = state.context.render(RAW_RENDER_CYCLES)?.slice();
          state.dropped += state.context.getDroppedSidWriteTraceCount();
          this.appendWrites(state, state.context.getAndClearSidWriteTracesPacked());
          if (!chunk) throw new Error(`SID render stopped: ${state.context.getLastError()}`);
          if (!chunk.length) {
            if (++emptyReads > 64) throw new Error('SID render exhausted without producing samples; ROM-driven files are unsupported');
            continue;
          }
          emptyReads = 0;
          state.pendingPcm = chunk;
          state.pendingOffset = 0;
        }
        const take = Math.min(frames - copied, state.pendingPcm.length - state.pendingOffset);
        if (retainPcm) pcm.set(state.pendingPcm.subarray(state.pendingOffset, state.pendingOffset + take), copied);
        state.pendingOffset += take;
        copied += take;
      }
      state.consumedFrame += frames;
      const endSeconds = state.consumedFrame / SAMPLE_RATE;
      let writeCount = 0;
      while (writeCount < state.pendingWrites.length && state.pendingWrites[writeCount].timeSeconds < endSeconds) {
        const write = state.pendingWrites[writeCount++];
        state.registers[write.address] = write.value;
      }
      const writes = state.pendingWrites.splice(0, writeCount);
      const dropped = state.dropped;
      state.dropped = 0;
      return { pcm, startFrame, endFrame: state.consumedFrame, writes, registers: copyRegisters(state), dropped };
    } catch (error) {
      state.failed = true;
      throw error;
    }
  }

  async seek(seconds: number): Promise<PositionResult> {
    const state = this.requireState();
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_SEEK_SECONDS) {
      throw new Error(`seek seconds must be finite and between 0 and ${MAX_SEEK_SECONDS}`);
    }
    return this.replay(Math.floor(seconds * SAMPLE_RATE), state.mask);
  }

  async mute(mask: MuteMask): Promise<PositionResult> {
    const state = this.requireState();
    if (!Array.isArray(mask) || mask.length !== 3 || mask.some((value) => typeof value !== 'boolean')) {
      throw new Error('mute mask must contain exactly three booleans (true means muted)');
    }
    return this.replay(state.consumedFrame, [...mask]);
  }

  private async replay(frame: number, mask: MuteMask): Promise<PositionResult> {
    const previous = this.requireState();
    const deadline = performance.now() + OPERATION_BUDGET_MS;
    const replacement = this.createState(previous.bytes, previous.options, mask);
    try {
      let batches = 0;
      while (replacement.consumedFrame < frame) {
        this.consume(replacement, Math.min(MAX_RENDER_FRAMES, frame - replacement.consumedFrame), false, deadline);
        if (++batches % 4 === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          this.requireAlive();
          deadlineExceeded(deadline);
        }
      }
      this.replaceState(replacement);
      return { frame, registers: copyRegisters(replacement) };
    } catch (error) {
      replacement.context.delete();
      throw error;
    }
  }

  private replaceState(state: LiveState): void {
    this.state?.context.delete();
    this.state = state;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.state?.context.delete();
    this.state = undefined;
    this.module = undefined;
  }
}

const RATE = 44100;
const CYCLES = 20000;
const RECORD_BYTES = 10;
const CHECKPOINT_WORDS = 8;
const MAX_CAPTURE_FRAMES = 4096;

export interface Profile {
  model: 'MOS6581' | 'MOS8580';
  clock: 'PAL' | 'NTSC';
}

export interface CaptureBlock {
  frames: number;
  chips: number;
  pcm: Int16Array;
  records: Uint8Array;
  checkpoint: Int32Array;
}

interface CaptureContext {
  configure(rate: number, stereo: boolean): boolean;
  setEmulationConfig(config: {
    frequency: number;
    stereo: boolean;
    c64Model: Profile['clock'];
    forceC64Model: boolean;
    sidModel: Profile['model'];
    forceSidModel: boolean;
    powerOnDelay: number;
    secondSidAddress: number;
    thirdSidAddress: number;
  }): boolean;
  loadSidBuffer(bytes: Uint8Array): boolean;
  getInstalledSids(): number;
  getLastError(): string;
  renderCapture(cycles: number): CaptureBlock | null;
  delete(): void;
}

interface VoiceReplay {
  render(records: Uint8Array, mask: number): Int16Array;
  delete(): void;
}

export interface LiveVoiceModule {
  SidPlayerContext: new () => CaptureContext;
  VoiceReplay: new (checkpoint: Int32Array) => VoiceReplay;
}

export type ModuleFactory = (options?: {locateFile(path: string, prefix?: string): string}) => Promise<LiveVoiceModule>;

export interface SessionOptions {
  moduleUrl?: string;
  moduleFactory?: ModuleFactory;
}

export interface RenderResult {
  pcm: Int16Array;
  startFrame: number;
  endFrame: number;
  mask: number;
  chips: 1 | 2;
}

export class LiveVoiceSession {
  private module: LiveVoiceModule;
  private context?: CaptureContext;
  private replay?: VoiceReplay;
  private chips?: 1 | 2;
  private profile?: Profile;
  private frame = 0;
  private disposed = false;

  private constructor(module: LiveVoiceModule) {
    this.module = module;
  }

  static async create(options: SessionOptions = {}): Promise<LiveVoiceSession> {
    const moduleUrl = options.moduleUrl ?? '/engine/libsidplayfp.js';
    const factory = options.moduleFactory ?? (await import(/* @vite-ignore */ moduleUrl)).default as ModuleFactory;
    const resolvedUrl = new URL(moduleUrl, typeof location === 'undefined' ? import.meta.url : location.href);
    const module = await factory({locateFile: path => new URL(path, resolvedUrl).href});
    if (typeof module.SidPlayerContext !== 'function' || typeof module.VoiceReplay !== 'function') {
      throw new Error('The frozen live-voice engine must expose SidPlayerContext and VoiceReplay');
    }
    return new LiveVoiceSession(module);
  }

  load(bytes: Uint8Array, profile: Profile): {chips: 1 | 2; rate: number} {
    if (this.disposed) throw new Error('Session is disposed');
    if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > 65536 + 126) throw new Error('A bounded SID file is required');
    if (!['MOS6581', 'MOS8580'].includes(profile.model) || !['PAL', 'NTSC'].includes(profile.clock)) throw new Error('Unsupported model or clock');
    this.clear();
    const context = new this.module.SidPlayerContext();
    try {
      if (!context.configure(RATE, true) || !context.setEmulationConfig({
        frequency: RATE, stereo: true, c64Model: profile.clock, forceC64Model: true,
        sidModel: profile.model, forceSidModel: true, powerOnDelay: 0, secondSidAddress: 0, thirdSidAddress: 0,
      })) throw new Error(`Engine configuration failed: ${context.getLastError()}`);
      if (!context.loadSidBuffer(bytes)) throw new Error(`SID load failed: ${context.getLastError()}`);
      const chips = context.getInstalledSids();
      if (chips !== 1 && chips !== 2) throw new Error('Capture requires one or two installed SID chips');
      if (typeof context.renderCapture !== 'function') throw new Error('The frozen live-voice engine must expose renderCapture');
      this.context = context;
      this.chips = chips;
      this.profile = {...profile};
      return {chips, rate: RATE};
    } catch (error) {
      context.delete();
      throw error;
    }
  }

  render(mask: number): RenderResult {
    const {context, chips, profile} = this;
    if (!context || !chips || !profile) throw new Error('Load a SID before rendering');
    if (!Number.isSafeInteger(mask) || mask < 0 || mask >= 1 << chips * 3) throw new Error(`Voice mask must fit ${chips * 3} bits`);
    try {
      const capture = context.renderCapture(CYCLES);
      if (!capture) throw new Error(`Capture failed: ${context.getLastError()}`);
      // Embind views share the WASM heap; VoiceReplay allocation/render can invalidate them (verify.mjs capture contract).
      const records = capture.records.slice();
      const checkpoint = capture.checkpoint.slice();
      const {frames} = capture;
      if (!Number.isSafeInteger(frames) || frames < 0 || frames > MAX_CAPTURE_FRAMES || capture.chips !== chips ||
          capture.pcm.length !== frames * chips || records.length !== frames * chips * RECORD_BYTES || checkpoint.length !== chips * CHECKPOINT_WORDS) {
        throw new Error('Invalid capture frame, chip or array count');
      }
      for (let chip = 0; chip < chips; chip++) {
        const offset = chip * CHECKPOINT_WORDS;
        const flags = checkpoint[offset + 6];
        if (checkpoint[offset] !== 1 || checkpoint[offset + 5] < 0 || checkpoint[offset + 5] > 255 || flags < 0 || flags > 3 ||
            (flags & 1) !== Number(profile.model === 'MOS8580') || checkpoint[offset + 7] !== RATE) {
          throw new Error('Invalid capture checkpoint version, flags, model or rate');
        }
      }
      const startFrame = this.frame;
      let pcm = new Int16Array();
      if (frames) {
        this.replay ??= new this.module.VoiceReplay(checkpoint);
        pcm = this.replay.render(records, mask).slice();
        if (pcm.length !== frames * chips) throw new Error('Replay PCM count differs from capture');
      }
      this.frame += frames;
      return {pcm, startFrame, endFrame: this.frame, mask, chips};
    } catch (error) {
      this.clear();
      throw error;
    }
  }

  dispose(): void {
    this.clear();
    this.disposed = true;
  }

  private clear(): void {
    this.replay?.delete();
    this.context?.delete();
    this.replay = undefined;
    this.context = undefined;
    this.chips = undefined;
    this.profile = undefined;
    this.frame = 0;
  }
}

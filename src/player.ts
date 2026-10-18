import type { CacheCoverage, EngineEvent, EngineReply } from './engine/protocol.ts';
import type { PlayerControls, PlayerState, Profile, TuneDetails, WriteObservation } from './player-types.ts';
import { positionAt, trimHistory, validateLoop, type AudioSegment } from './timeline.ts';

interface RenderBlock {
  pcm: Int16Array;
  startFrame: number;
  endFrame: number;
  writes: WriteObservation[];
  registers: number[];
  dropped: number;
}
interface ScheduledSegment extends AudioSegment { source: AudioBufferSourceNode }

class EngineClient {
  private worker: Worker;
  private sequence = 0;
  private cacheEpoch = 0;
  private terminalError: Error | null = null;
  private pending = new Map<number, {resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>}>();

  constructor(onCache: (coverage: CacheCoverage) => void, onFatal: (error: Error) => void) {
    this.worker = new Worker(new URL('./engine/worker.ts', import.meta.url), {type: 'module'});
    this.worker.onmessage = (event: MessageEvent<EngineReply | EngineEvent>) => {
      if ('event' in event.data) {
        if (!this.terminalError && event.data.coverage.epoch === this.cacheEpoch) onCache(event.data.coverage);
        return;
      }
      const request = this.pending.get(event.data.id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(event.data.id);
      if ('error' in event.data) request.reject(new Error(event.data.error));
      else request.resolve(event.data.result);
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'Playback worker failed. Reload the sample to retry.');
      this.terminate(error);
      onFatal(error);
    };
  }

  request<T>(method: string, payload: unknown): Promise<T> {
    if (this.terminalError) return Promise.reject(this.terminalError);
    if (method === 'load' || method === 'mute') this.cacheEpoch++;
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.terminate(new Error(`${method} exceeded 30 seconds. Reload the sample to retry.`)), 30_000);
      this.pending.set(id, {resolve: value => resolve(value as T), reject, timer});
      this.worker.postMessage({id, method, payload, cacheEpoch:this.cacheEpoch});
    });
  }

  terminate(error = new Error('Playback session replaced.')) {
    this.terminalError ??= error;
    this.worker.terminate();
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}

export class ExplorerPlayer implements PlayerControls {
  private engine: EngineClient | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private listeners = new Set<(state: PlayerState) => void>();
  private segments: ScheduledSegment[] = [];
  private nextStart = 0;
  private generation = 0;
  private pumping = false;
  private wantsPlayback = false;
  private frame = 0;
  private boundary: {time: number; loop: boolean} | null = null;
  private registers = Array<number>(32).fill(0);
  private timer: ReturnType<typeof setInterval>;
  private animation = 0;
  private state: PlayerState = {
    status: 'empty', position: 0, seekTarget: null, preparedRange: null, renderedUntil: 0, duration: null, error: null,
    info: null, muted: [false, false, false], loop: null, peakDb: -Infinity,
    rmsDb: -Infinity, spectrum: new Uint8Array(512), waveform: new Float32Array(1024),
    frames: [], writes: [], historyStart: 0, dropped: 0, underruns: 0, epoch: 0,
  };

  constructor() {
    this.timer = setInterval(() => { void this.pump(); }, 40);
    const tick = () => {
      this.updateHeardState();
      this.emit();
      this.animation = requestAnimationFrame(tick);
    };
    this.animation = requestAnimationFrame(tick);
  }

  subscribe(listener: (state: PlayerState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit() { for (const listener of this.listeners) listener(this.state); }

  private outputTime(): number {
    if (!this.context) return 0;
    const timestamp = this.context.getOutputTimestamp?.();
    return timestamp?.contextTime !== undefined && timestamp.contextTime > 0 ? timestamp.contextTime : Math.max(0, this.context.currentTime - (this.context.outputLatency || 0));
  }

  private updateHeardState() {
    if (this.state.status !== 'playing' || !this.context) return;
    const outputTime = this.outputTime();
    this.state.position = positionAt(this.segments, outputTime, this.state.position);
    while (this.segments.length > 2 && this.segments[1].contextEnd < outputTime) this.segments.shift();
    if (this.analyser) {
      this.analyser.getByteFrequencyData(this.state.spectrum as Uint8Array<ArrayBuffer>);
      this.analyser.getFloatTimeDomainData(this.state.waveform as Float32Array<ArrayBuffer>);
      let peak = 0, squares = 0;
      for (const value of this.state.waveform) { peak = Math.max(peak, Math.abs(value)); squares += value * value; }
      this.state.peakDb = 20 * Math.log10(peak);
      this.state.rmsDb = 20 * Math.log10(Math.sqrt(squares / this.state.waveform.length));
    }
    if (this.boundary && outputTime >= this.boundary.time) {
      const loop = this.boundary.loop;
      this.boundary = null;
      if (loop && this.state.loop) void this.seek(this.state.loop.start).catch(() => { /* seek reports failures only for its own active generation. */ });
      else {
        this.wantsPlayback = false;
        this.state.status = 'ended';
        this.stopSources();
      }
    }
  }

  private stopSources() {
    for (const segment of this.segments) { try { segment.source.stop(); } catch { /* An ended Web Audio source needs no further stop. */ } segment.source.disconnect(); }
    this.segments = [];
    this.boundary = null;
  }

  private clearHistory(registers: number[]) {
    this.registers = registers.slice();
    this.state.frames = [{time: this.state.position, registers: registers.slice()}];
    this.state.writes = [];
    this.state.historyStart = this.state.position;
    this.state.dropped = 0;
    this.state.epoch++;
  }

  private fail(error: unknown) {
    this.wantsPlayback = false;
    this.generation++;
    this.stopSources();
    this.state.status = 'error';
    this.state.preparedRange = null;
    this.state.seekTarget = null;
    this.state.error = error instanceof Error ? error.message : String(error);
    this.emit();
  }

  async load(bytes: Uint8Array, profile: Profile) {
    this.wantsPlayback = false;
    const generation = ++this.generation;
    this.stopSources();
    this.engine?.terminate();
    const engine = new EngineClient(coverage => {
      if (this.engine !== engine || this.state.status === 'error') return;
      this.state.preparedRange = {start:coverage.startFrame / 44100, end:coverage.endFrame / 44100};
      this.emit();
    }, error => {
      if (this.engine === engine) this.fail(error);
    });
    this.engine = engine;
    this.state.status = 'loading';
    this.state.preparedRange = null;
    this.state.seekTarget = null;
    this.state.error = null;
    this.state.info = null;
    this.state.position = 0;
    this.state.renderedUntil = 0;
    this.state.duration = profile.durationSeconds ?? null;
    this.state.loop = null;
    this.state.muted = [false, false, false];
    this.state.underruns = 0;
    this.frame = 0;
    this.clearHistory(Array<number>(32).fill(0));
    this.emit();
    try {
      const info = await engine.request<TuneDetails>('load', {bytes, options: profile, durationSeconds:profile.durationSeconds});
      if (generation !== this.generation) return;
      this.state.info = info;
      this.clearHistory(info.registers);
      this.state.status = 'ready';
      this.emit();
    } catch (error) {
      if (generation === this.generation) this.fail(error);
      throw error;
    }
  }

  async play() {
    if (!this.state.info || !this.engine) throw new Error('Load a SID file first.');
    if (['loading', 'seeking', 'error'].includes(this.state.status)) return;
    if (!this.context) {
      this.context = new AudioContext({sampleRate: 44100, latencyHint: 'interactive'});
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.connect(this.context.destination);
    }
    const engine = this.engine;
    const generation = this.generation;
    this.wantsPlayback = true;
    await this.context.resume();
    if (engine !== this.engine || generation !== this.generation || !this.wantsPlayback) return;
    const restart = this.state.status === 'ended' ? 0 : this.state.loop && this.state.position >= this.state.loop.end ? this.state.loop.start : null;
    if (restart !== null) {
      const seekGeneration = this.generation + 1;
      await this.seek(restart);
      if (this.generation !== seekGeneration) return;
    }
    if (engine !== this.engine || !this.wantsPlayback) return;
    this.state.status = 'playing';
    if (!this.segments.length) this.nextStart = this.context.currentTime + 0.06;
    this.emit();
    await this.pump();
  }

  pause() {
    this.wantsPlayback = false;
    if (this.state.status !== 'playing' && this.state.status !== 'seeking') return;
    this.updateHeardState();
    this.state.status = 'paused';
    void this.context?.suspend();
    this.emit();
  }

  async seek(seconds: number) {
    if (!this.engine || !this.state.info) throw new Error('Load a SID file first.');
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > (this.state.duration ?? 600)) throw new Error('Seek is outside this tune’s supported range.');
    const generation = ++this.generation;
    const engine = this.engine;
    this.stopSources();
    this.state.status = 'seeking';
    this.state.seekTarget = seconds;
    this.emit();
    try {
      const result = await engine.request<{frame: number; registers: number[]}>('seek', {seconds});
      if (generation !== this.generation) return;
      this.frame = result.frame;
      this.state.position = result.frame / 44100;
      this.state.renderedUntil = this.state.position;
      this.clearHistory(result.registers);
      this.nextStart = (this.context?.currentTime ?? 0) + 0.06;
      this.state.seekTarget = null;
      this.state.status = this.wantsPlayback ? 'playing' : 'paused';
      this.emit();
      if (this.wantsPlayback) await this.pump();
    } catch (error) {
      if (generation === this.generation) this.fail(error);
      throw error;
    }
  }

  async setMuted(mask: boolean[]) {
    if (mask.length !== 3 || mask.some(value => typeof value !== 'boolean')) throw new Error('There are exactly three voice mute controls.');
    if (!this.engine || !this.state.info) throw new Error('Load a SID file first.');
    this.state.muted = mask.slice();
    this.updateHeardState();
    const position = this.state.seekTarget ?? this.state.position;
    this.state.preparedRange = null;
    const generation = ++this.generation;
    const engine = this.engine;
    this.stopSources();
    this.state.status = 'seeking';
    this.state.seekTarget = position;
    this.emit();
    try {
      await engine.request('mute', {mask});
      if (generation !== this.generation) return;
      const result = await engine.request<{frame: number; registers: number[]}>('seek', {seconds: position});
      if (generation !== this.generation) return;
      this.state.muted = mask.slice();
      this.frame = result.frame;
      this.state.position = result.frame / 44100;
      this.state.renderedUntil = this.state.position;
      this.clearHistory(result.registers);
      this.nextStart = (this.context?.currentTime ?? 0) + 0.06;
      this.state.seekTarget = null;
      this.state.status = this.wantsPlayback ? 'playing' : 'paused';
      this.emit();
      if (this.wantsPlayback) await this.pump();
    } catch (error) { if (generation === this.generation) this.fail(error); throw error; }
  }

  async setLoop(loop: {start: number; end: number} | null) {
    this.state.loop = validateLoop(loop, this.state.duration);
    if (this.state.info && this.state.status !== 'loading' && this.state.status !== 'seeking') {
      this.updateHeardState();
      await this.seek(this.state.position);
    }
    this.emit();
  }

  private record(block: RenderBlock) {
    this.state.dropped += block.dropped;
    this.state.writes.push(...block.writes);
    for (const write of block.writes) {
      if (write.sidNumber !== 0) continue;
      const register = write.address >= 0xd400 ? write.address - 0xd400 : write.address;
      if (register >= 0 && register < 32) this.registers[register] = write.value;
      const last = this.state.frames.at(-1);
      if (!last || write.timeSeconds - last.time >= 0.02) {
        this.state.frames.push({time: write.timeSeconds, registers: this.registers.slice()});
      }
    }
    trimHistory(this.state.frames, 6000);
    const removed = trimHistory(this.state.writes, 200_000);
    if (removed || this.state.frames.length) this.state.historyStart = Math.max(this.state.frames[0]?.time ?? 0, this.state.writes[0]?.timeSeconds ?? 0);
  }

  private async pump() {
    if (this.pumping || this.state.status !== 'playing' || !this.engine || !this.context || !this.analyser || this.boundary) return;
    this.pumping = true;
    const generation = this.generation;
    try {
      while (this.state.status === 'playing' && generation === this.generation && this.nextStart < this.context.currentTime + 0.25 && !this.boundary) {
        const end = Math.min(this.state.loop?.end ?? Infinity, this.state.duration ?? 600);
        const remaining = Math.round(end * 44100) - this.frame;
        if (remaining <= 0) {
          this.boundary = {time: this.nextStart, loop: Boolean(this.state.loop)};
          break;
        }
        const block = await this.engine.request<RenderBlock>('render', {frames: Math.min(4096, remaining)});
        if (generation !== this.generation) return;
        if (block.pcm.length === 0) throw new Error('The emulator returned no audio. This file may need unsupported ROMs or a different profile.');
        this.frame = block.endFrame;
        this.record(block);
        const buffer = this.context.createBuffer(1, block.pcm.length, 44100);
        const samples = buffer.getChannelData(0);
        for (let index = 0; index < samples.length; index++) samples[index] = block.pcm[index] / 32768;
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.analyser);
        source.onended = () => source.disconnect();
        if (this.nextStart < this.context.currentTime) {
          this.state.underruns++;
          this.nextStart = this.context.currentTime + 0.03;
        }
        const contextStart = this.nextStart;
        const contextEnd = contextStart + block.pcm.length / 44100;
        source.start(contextStart);
        this.segments.push({source, contextStart, contextEnd, mediaStart: block.startFrame / 44100, mediaEnd: block.endFrame / 44100});
        this.nextStart = contextEnd;
        this.state.renderedUntil = block.endFrame / 44100;
        if (this.frame >= Math.round(end * 44100)) this.boundary = {time: contextEnd, loop: Boolean(this.state.loop)};
      }
    } catch (error) { if (generation === this.generation) this.fail(error); }
    finally { this.pumping = false; }
  }

  dispose() {
    this.generation++;
    clearInterval(this.timer);
    cancelAnimationFrame(this.animation);
    this.stopSources();
    this.engine?.terminate();
    void this.context?.close();
    this.listeners.clear();
  }
}

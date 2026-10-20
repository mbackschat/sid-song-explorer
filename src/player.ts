import {AudioMonitor, createAudioChannels} from './audio-monitor.ts';
import type { CacheCoverage, EngineEvent, EngineReply } from './engine/protocol.ts';
import { collectObservationWindow } from './engine/observation-window.ts';
import type { PlayerControls, PlayerState, Profile, TimelineObservation, TimelineOverview, TuneDetails, WriteObservation } from './player-types.ts';
import { positionAt, trimHistory, validateLoop, composeTimelineOverviews, type AudioSegment } from './timeline.ts';

const TIMELINE_PREVIEW_MARGIN_SECONDS = 1;
const TIMELINE_BROWSE_MARGIN_SECONDS = 5;

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
  private readonly onFatal: (error: Error) => void;
  private pending = new Map<number, {resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>}>();

  constructor(onCache: (coverage: CacheCoverage) => void, onFatal: (error: Error) => void) {
    this.onFatal = onFatal;
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
      this.fail(error);
    };
  }

  request<T>(method: string, payload: unknown): Promise<T> {
    if (this.terminalError) return Promise.reject(this.terminalError);
    if (method === 'load' || method === 'mute') this.cacheEpoch++;
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(`${method} exceeded 30 seconds. Reload the sample to retry.`)), 30_000);
      this.pending.set(id, {resolve: value => resolve(value as T), reject, timer});
      this.worker.postMessage({id, method, payload, cacheEpoch:this.cacheEpoch});
    });
  }

  private fail(error: Error) {
    this.terminate(error);
    this.onFatal(error);
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
  private monitor: AudioMonitor | null = null;
  private listeners = new Set<(state: PlayerState) => void>();
  private segments: ScheduledSegment[] = [];
  private nextStart = 0;
  private generation = 0;
  private pumping = false;
  private overviewEnd: number | null = null;
  private overviewPending = false;
  private overviewKey = '';
  private overviewRequestedAt = -Infinity;
  private previewPending = false;
  private previewRequestedAt = -Infinity;
  private previewRevision = 0;
  private disposed = false;
  private wantsPlayback = false;
  private frame = 0;
  private boundary: {time: number; loop: boolean} | null = null;
  private registers = Array<number>(32).fill(0);
  private timer: ReturnType<typeof setInterval>;
  private animation = 0;
  private state: PlayerState = {
    status: 'empty', position: 0, seekTarget: null, pendingOperation: null, preparedRange: null, preview: null, overview: null, timelineWindowSeconds: 10, timelineCenterSeconds: null, renderedUntil: 0, duration: null, error: null,
    info: null, muted: [false, false, false], loop: null, audioChannels:createAudioChannels(1),
    frames: [], writes: [], historyStart: 0, dropped: 0, underruns: 0, epoch: 0,
  };

  constructor() {
    this.timer = setInterval(() => { void this.pump(); this.refreshPreview(); }, 40);
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

  private invalidatePreview(preserveAccepted = false) {
    this.previewRevision++;
    this.overviewKey = '';
    if (!preserveAccepted) this.state.overview = null;
    if (!preserveAccepted) this.state.preview = null;
    this.previewRequestedAt = -Infinity;
  }

  private previewOverlap(observation: TimelineObservation | null, includeMargin = false): number {
    if (!observation) return 0;
    const center = this.state.timelineCenterSeconds ?? this.state.position;
    const halfWindow = this.state.timelineWindowSeconds / 2;
    const browsing = this.state.timelineCenterSeconds !== null;
    const margin = includeMargin ? browsing ? TIMELINE_BROWSE_MARGIN_SECONDS : TIMELINE_PREVIEW_MARGIN_SECONDS : 0;
    return Math.max(0, Math.min(observation.end, center + halfWindow + margin) - Math.max(observation.start, center - halfWindow - (browsing ? margin : 0)));
  }

  private improvesPreview(observation: TimelineObservation | null): boolean {
    const visibleOverlap = this.previewOverlap(observation);
    const acceptedOverlap = this.previewOverlap(this.state.preview);
    if (visibleOverlap !== acceptedOverlap) return visibleOverlap > acceptedOverlap;
    // Equal visible coverage still needs fresh offscreen data during movement (tests/player.test.ts).
    return visibleOverlap > 0 && this.previewOverlap(observation, true) > this.previewOverlap(this.state.preview, true);
  }

  private refreshOverview() {
    if (this.overviewEnd === null || this.overviewPending || this.pumping || !this.engine || !this.state.info || this.disposed ||
      !['ready', 'paused', 'playing', 'ended'].includes(this.state.status) || performance.now() - this.overviewRequestedAt < 1000) return;
    const engine = this.engine;
    const generation = this.generation;
    const end = this.overviewEnd;
    const key = `${generation}:${end}:${this.state.preparedRange?.start}:${this.state.preparedRange?.end}`;
    if (key === this.overviewKey) return;
    this.overviewPending = true;
    this.overviewRequestedAt = performance.now();
    void engine.request<TimelineOverview | null>('overview', {startSeconds:0, endSeconds:end}).then(overview => {
      if (generation !== this.generation || engine !== this.engine || end !== this.overviewEnd || this.disposed) return;
      this.overviewKey = key;
      this.state.overview = composeTimelineOverviews(this.state.overview, overview);
      this.emit();
    }).catch(() => {
      if (generation === this.generation && engine === this.engine && !this.disposed) this.overviewKey = key;
    }).finally(() => { this.overviewPending = false; });
  }

  private refreshPreview() {
    this.refreshOverview();
    const browsing = this.state.timelineCenterSeconds !== null;
    if (this.disposed || this.previewPending || this.pumping || !this.engine || !this.state.info ||
      !['ready', 'paused', 'playing', 'ended'].includes(this.state.status) || performance.now() - this.previewRequestedAt < (browsing ? 100 : 250)) return;
    const halfWindow = this.state.timelineWindowSeconds / 2;
    const center = this.state.timelineCenterSeconds ?? this.state.position;
    const margin = browsing ? TIMELINE_BROWSE_MARGIN_SECONDS : TIMELINE_PREVIEW_MARGIN_SECONDS;
    const startSeconds = Math.max(0, center - halfWindow - (browsing ? margin : 0));
    // Offscreen observations keep movement covered between requests (tests/player.test.ts).
    const endSeconds = Math.min(center + halfWindow + margin, this.state.duration ?? 600, 600);
    if (startSeconds >= endSeconds) return;
    const engine = this.engine;
    const generation = this.generation;
    const revision = this.previewRevision;
    this.previewPending = true;
    this.previewRequestedAt = performance.now();
    void collectObservationWindow(startSeconds, endSeconds,
      (start, end) => start !== startSeconds && revision !== this.previewRevision ? Promise.resolve(null) :
        engine.request<TimelineObservation | null>('observe', {startSeconds: start, endSeconds: end}),
      () => generation === this.generation && engine === this.engine && !this.disposed,
    ).then(observation => {
      if (generation !== this.generation || engine !== this.engine || this.disposed) return;
      if (revision !== this.previewRevision && !this.improvesPreview(observation)) return;
      this.state.preview = observation;
      this.emit();
    }).catch(() => {
      if (generation !== this.generation || revision !== this.previewRevision || engine !== this.engine || this.disposed) return;
      this.state.preview = null;
      this.emit();
    }).finally(() => {
      this.previewPending = false;
      this.refreshPreview();
    });
  }

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
    this.monitor?.read(this.state.audioChannels);
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
    this.invalidatePreview();
    this.stopSources();
    this.state.status = 'error';
    this.state.preparedRange = null;
    this.state.seekTarget = null;
    this.state.pendingOperation = null;
    this.state.error = error instanceof Error ? error.message : String(error);
    this.emit();
  }

  async load(bytes: Uint8Array, profile: Profile) {
    this.wantsPlayback = false;
    const generation = ++this.generation;
    this.invalidatePreview();
    this.stopSources();
    this.engine?.terminate();
    const engine = new EngineClient(coverage => {
      if (this.engine !== engine || this.state.status === 'error') return;
      this.state.preparedRange = {start:coverage.startFrame / 44100, end:coverage.endFrame / 44100};
      this.emit();
      this.refreshPreview();
    }, error => {
      if (this.engine === engine) this.fail(error);
    });
    this.engine = engine;
    this.state.status = 'loading';
    this.state.preparedRange = null;
    this.state.seekTarget = null;
    this.state.pendingOperation = null;
    this.state.error = null;
    this.state.info = null;
    this.state.audioChannels = createAudioChannels(1);
    this.state.position = 0;
    this.state.timelineCenterSeconds = null;
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
      this.state.audioChannels = createAudioChannels(info.channels);
      this.state.muted = Array<boolean>(info.installedSids * 3).fill(false);
      this.clearHistory(info.registers);
      this.state.status = 'ready';
      this.emit();
      this.refreshPreview();
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
      this.monitor = new AudioMonitor(this.context);
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
    this.refreshPreview();
  }

  async seek(seconds: number) {
    if (!this.engine || !this.state.info) throw new Error('Load a SID file first.');
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > (this.state.duration ?? 600)) throw new Error('Seek is outside this tune’s supported range.');
    const generation = ++this.generation;
    this.invalidatePreview(true);
    const engine = this.engine;
    this.stopSources();
    this.state.status = 'seeking';
    this.state.seekTarget = seconds;
    this.state.pendingOperation = 'seek';
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
      this.state.pendingOperation = null;
      this.state.status = this.wantsPlayback ? 'playing' : 'paused';
      this.emit();
      if (this.wantsPlayback) await this.pump();
      else this.refreshPreview();
    } catch (error) {
      if (generation === this.generation) this.fail(error);
      throw error;
    }
  }

  async setMuted(mask: boolean[]) {
    if (!this.engine || !this.state.info) throw new Error('Load a SID file first.');
    const voices = this.state.info.installedSids * 3;
    if (mask.length !== voices || mask.some(value => typeof value !== 'boolean')) throw new Error(`There are exactly ${voices} voice mute controls.`);
    this.state.muted = mask.slice();
    this.updateHeardState();
    const position = this.state.seekTarget ?? this.state.position;
    this.state.preparedRange = null;
    const generation = ++this.generation;
    this.invalidatePreview();
    const engine = this.engine;
    this.stopSources();
    this.state.status = 'seeking';
    this.state.seekTarget = position;
    this.state.pendingOperation = 'voice-mix';
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
      this.state.pendingOperation = null;
      this.state.status = this.wantsPlayback ? 'playing' : 'paused';
      this.emit();
      if (this.wantsPlayback) await this.pump();
      else this.refreshPreview();
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

  setTimelineOverview(end: number | null) {
    if (end !== null && (!Number.isFinite(end) || end <= 0 || end > 600)) throw new Error('Overview end must be within 0–600 seconds.');
    if (end === this.overviewEnd) return;
    this.overviewEnd = end;
    this.overviewKey = '';
    this.refreshOverview();
  }

  async inspectTimeline(seconds: number): Promise<TimelineObservation | null> {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds >= 600) return null;
    const engine = this.engine;
    const generation = this.generation;
    if (!engine || this.disposed || !['ready', 'paused', 'playing', 'ended'].includes(this.state.status)) return null;
    const result = await collectObservationWindow(Math.max(0, seconds - .25), Math.min(600, seconds + .025),
      (startSeconds, endSeconds) => engine.request<TimelineObservation | null>('observe', {startSeconds,endSeconds}),
      () => generation === this.generation && engine === this.engine && !this.disposed,
    );
    return result && result.start <= seconds && result.end > seconds ? result : null;
  }

  setTimelineWindow(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Timeline window must be finite and positive.');
    if (seconds === this.state.timelineWindowSeconds) return;
    this.state.timelineWindowSeconds = seconds;
    this.previewRevision++;
    this.emit();
    this.refreshPreview();
  }

  setTimelineCenter(seconds: number | null) {
    if (seconds !== null && (!Number.isFinite(seconds) || seconds < 0 || seconds > 600)) {
      throw new Error('Timeline center must be null or finite and within 0–600 seconds.');
    }
    if (seconds === this.state.timelineCenterSeconds) return;
    // Browsing needs its wider margin before motion exhausts follow coverage (tests/player.test.ts).
    if (this.state.timelineCenterSeconds === null && seconds !== null) this.previewRequestedAt = -Infinity;
    this.state.timelineCenterSeconds = seconds;
    this.previewRevision++;
    this.emit();
    this.refreshPreview();
  }

  private record(block: RenderBlock) {
    this.state.dropped += block.dropped;
    this.state.writes.push(...block.writes);
    for (const write of block.writes) {
      const base = this.state.info!.sidChipBases[write.sidNumber];
      const register = write.address >= 0xd400 ? write.address - base : write.address;
      if (base !== undefined && register >= 0 && register < 32) this.registers[write.sidNumber * 32 + register] = write.value;
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
    if (this.pumping || this.state.status !== 'playing' || !this.engine || !this.context || !this.monitor || this.boundary) return;
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
        const channels = this.state.info!.channels;
        const frames = block.endFrame - block.startFrame;
        if (frames < 1 || block.pcm.length !== frames * channels) throw new Error('The emulator returned an invalid audio block.');
        this.frame = block.endFrame;
        this.record(block);
        const buffer = this.context.createBuffer(channels, frames, 44100);
        for (let channel = 0; channel < channels; channel++) {
          const samples = buffer.getChannelData(channel);
          for (let frame = 0; frame < frames; frame++) samples[frame] = block.pcm[frame * channels + channel] / 32768;
        }
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.monitor.input);
        source.onended = () => source.disconnect();
        if (this.nextStart < this.context.currentTime) {
          this.state.underruns++;
          this.nextStart = this.context.currentTime + 0.03;
        }
        const contextStart = this.nextStart;
        const contextEnd = contextStart + frames / 44100;
        source.start(contextStart);
        this.segments.push({source, contextStart, contextEnd, mediaStart: block.startFrame / 44100, mediaEnd: block.endFrame / 44100});
        this.nextStart = contextEnd;
        this.state.renderedUntil = block.endFrame / 44100;
        if (this.frame >= Math.round(end * 44100)) this.boundary = {time: contextEnd, loop: Boolean(this.state.loop)};
      }
    } catch (error) { if (generation === this.generation) this.fail(error); }
    finally { this.pumping = false; this.refreshPreview(); }
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    this.invalidatePreview();
    clearInterval(this.timer);
    cancelAnimationFrame(this.animation);
    this.stopSources();
    this.engine?.terminate();
    this.monitor?.dispose();
    void this.context?.close();
    this.listeners.clear();
  }
}

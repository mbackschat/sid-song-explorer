import { SAMPLE_RATE, SidSession } from './session.ts';
import type { LoadResult, MuteMask, PlaybackOptions, PositionResult, RenderResult, SessionOptions, SidWrite } from './session.ts';
import type { TimelineObservation } from '../player-types.ts';

const DEFAULT_CACHE_BYTES = 32 * 1024 * 1024;
const REGISTER_BYTES = 32;
const WRITE_FIELDS = 5;
const WRITE_BYTES = WRITE_FIELDS * Float64Array.BYTES_PER_ELEMENT;
const MAX_RENDER_FRAMES = SAMPLE_RATE * 2;
const MAX_BLOCK_FRAMES = SAMPLE_RATE / 4;
const MAX_BLOCKS = 4096;
const OPERATION_BUDGET_MS = 15000;
const MAX_OBSERVATION_INTERVALS = 1000;
const MAX_OBSERVATION_WRITES = 20_000;
const OBSERVATION_FRAME_SECONDS = 0.02;
// SIDLite's PAL/NTSC clocks consume fewer than 25 scheduler cycles per sample.
// Even one SID bus write per cycle cannot exceed this reservation; actual packed bytes own the cap.
const RESERVED_WRITE_BYTES_PER_FRAME = 25 * WRITE_BYTES;

export interface CachedSessionOptions extends SessionOptions {
  maxCacheBytes?: number;
}

interface CachedBlock {
  startFrame: number;
  endFrame: number;
  pcm: Int16Array;
  writes: Float64Array;
  registers: Uint8Array;
  dropped: number;
}

function blockBytes(block: CachedBlock): number {
  return block.pcm.byteLength + block.writes.byteLength + block.registers.byteLength;
}

function validateFrames(frames: number): void {
  if (!Number.isInteger(frames) || frames < 1 || frames > MAX_RENDER_FRAMES) {
    throw new Error(`frames must be an integer between 1 and ${MAX_RENDER_FRAMES}`);
  }
}

function packWrites(writes: SidWrite[]): Float64Array {
  const packed = new Float64Array(writes.length * WRITE_FIELDS);
  for (let index = 0; index < writes.length; index++) {
    const write = writes[index];
    const offset = index * WRITE_FIELDS;
    packed[offset] = write.timeSeconds;
    packed[offset + 1] = write.cyclePhi1;
    packed[offset + 2] = write.address;
    packed[offset + 3] = write.value;
    packed[offset + 4] = write.sidNumber;
  }
  return packed;
}

function unpackWrite(packed: Float64Array, offset: number): SidWrite {
  return {
    timeSeconds: packed[offset], cyclePhi1: packed[offset + 1], address: packed[offset + 2],
    value: packed[offset + 3], sidNumber: packed[offset + 4],
  };
}

/** A bounded PCM/write history over one SidSession producer; callers serialize all operations. */
export class CachedSidSession {
  readonly maxCacheBytes: number;
  private readonly source: SidSession;
  private blocks: CachedBlock[] = [];
  private frontierRegisters = new Uint8Array(REGISTER_BYTES);
  private bytes = REGISTER_BYTES;
  private cursor = 0;
  private frontier = 0;
  private channels: 1 | 2 = 1;
  private loaded = false;
  private disposed = false;

  private constructor(source: SidSession, maxCacheBytes: number) {
    this.source = source;
    this.maxCacheBytes = maxCacheBytes;
  }

  static async create(options: CachedSessionOptions = {}): Promise<CachedSidSession> {
    const maxCacheBytes = options.maxCacheBytes ?? DEFAULT_CACHE_BYTES;
    if (!Number.isSafeInteger(maxCacheBytes) || maxCacheBytes < REGISTER_BYTES) {
      throw new Error(`maxCacheBytes must be a safe integer of at least ${REGISTER_BYTES} bytes`);
    }
    return new CachedSidSession(await SidSession.create({ wasmUrl: options.wasmUrl, moduleUrl: options.moduleUrl }), maxCacheBytes);
  }

  get positionFrame(): number { return this.cursor; }
  get renderedFrame(): number { return this.frontier; }
  get cacheEndFrame(): number { return this.frontier; }
  get cacheStartFrame(): number { return this.blocks[0]?.startFrame ?? this.frontier; }
  get cacheBytes(): number { return this.bytes; }

  private requireAlive(): void {
    if (this.disposed) throw new Error('SID session has been disposed');
  }

  private requireLoaded(): void {
    this.requireAlive();
    if (!this.loaded) throw new Error('Load a SID before playback');
  }

  private get reservedBytesPerFrame(): number { return this.channels * Int16Array.BYTES_PER_ELEMENT + RESERVED_WRITE_BYTES_PER_FRAME; }
  private get reservedBlockBytes(): number { return this.frontierRegisters.byteLength + WRITE_BYTES; }

  private reset(frame: number, registers: number[]): void {
    this.blocks = [];
    this.frontierRegisters = Uint8Array.from(registers);
    this.bytes = this.frontierRegisters.byteLength;
    this.frontier = frame;
    this.cursor = frame;
  }

  async load(bytes: Uint8Array, options: PlaybackOptions): Promise<LoadResult> {
    this.requireAlive();
    const info = await this.source.load(bytes, options);
    this.requireAlive();
    if (info.registers.length > this.maxCacheBytes) {
      this.loaded = false;
      throw new Error('Cache cap cannot hold the installed SID registers');
    }
    this.channels = info.channels;
    this.reset(0, info.registers);
    this.loaded = true;
    return info;
  }

  private evictFirst(): void {
    this.bytes -= blockBytes(this.blocks.shift()!);
  }

  private produce(frames: number): RenderResult {
    const baseline = this.frontierRegisters.slice();
    const result = this.source.render(frames);
    const block: CachedBlock = {
      startFrame: result.startFrame, endFrame: result.endFrame, pcm: result.pcm,
      writes: packWrites(result.writes), registers: baseline, dropped: result.dropped,
    };
    const required = blockBytes(block);
    while (this.blocks.length && (this.bytes + required > this.maxCacheBytes || this.blocks.length >= MAX_BLOCKS)) {
      if (this.blocks[0].endFrame > this.cursor) throw new Error('SID cache reservation would evict unread audio');
      this.evictFirst();
    }
    this.frontier = result.endFrame;
    this.frontierRegisters.set(result.registers);
    if (required + this.frontierRegisters.byteLength <= this.maxCacheBytes) {
      this.blocks.push(block);
      this.bytes += required;
    } else {
      // A foreground read can run without retention when even one result exceeds the configured cap.
      this.blocks = [];
      this.bytes = this.frontierRegisters.byteLength;
    }
    return result;
  }

  private blockAt(frame: number): CachedBlock | undefined {
    return this.blocks.find((block) => frame >= block.startFrame && frame < block.endFrame);
  }

  private registersAt(frame: number): number[] {
    if (frame === this.frontier) return Array.from(this.frontierRegisters);
    const block = this.blockAt(frame);
    if (!block) throw new Error('Requested SID position is outside retained history');
    const registers = Array.from(block.registers);
    const endSeconds = frame / SAMPLE_RATE;
    for (let offset = 0; offset < block.writes.length && block.writes[offset] < endSeconds; offset += WRITE_FIELDS) {
      registers[block.writes[offset + 4] * REGISTER_BYTES + block.writes[offset + 2]] = block.writes[offset + 3];
    }
    return registers;
  }

  /** Copy retained observations only; output limits shorten coverage rather than imply missing writes are complete. */
  observe(startSeconds: number, endSeconds: number): TimelineObservation | null {
    this.requireLoaded();
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 ||
      endSeconds > 600 || endSeconds <= startSeconds) {
      throw new Error('Observation range must be within 0–600 seconds');
    }
    const start = Math.max(startSeconds, this.cacheStartFrame / SAMPLE_RATE);
    let end = Math.min(endSeconds, this.frontier / SAMPLE_RATE);
    let continuationStart: number | undefined;
    if (start >= end) return null;
    const writes: SidWrite[] = [];
    for (const block of this.blocks) {
      if (block.endFrame / SAMPLE_RATE <= start) continue;
      if (block.startFrame / SAMPLE_RATE >= end) break;
      for (let offset = 0; offset < block.writes.length; offset += WRITE_FIELDS) {
        const time = block.writes[offset];
        if (time >= end) break;
        if (time < start && start !== 0) continue;
        if (writes.length === MAX_OBSERVATION_WRITES) {
          end = Math.max(start, time);
          continuationStart = end;
          break;
        }
        writes.push(unpackWrite(block.writes, offset));
      }
      if (end <= block.endFrame / SAMPLE_RATE) break;
    }
    if (start >= end) return null;
    while (writes.length && writes.at(-1)!.timeSeconds >= end) writes.pop();
    const intervals = Math.min(MAX_OBSERVATION_INTERVALS, Math.ceil((end - start) / OBSERVATION_FRAME_SECONDS));
    const sampleTimes = Array.from({length: intervals + 1}, (_, index) =>
      index === intervals ? end : start + (end - start) * index / intervals);
    const frames: TimelineObservation['frames'] = [];
    let sample = 0;
    let dropped = 0;
    for (const block of this.blocks) {
      if (block.endFrame / SAMPLE_RATE <= start) continue;
      if (block.startFrame / SAMPLE_RATE >= end) break;
      dropped += block.dropped;
      const registers = Array.from(block.registers);
      let offset = 0;
      while (sample < sampleTimes.length && sampleTimes[sample] < block.endFrame / SAMPLE_RATE) {
        const time = sampleTimes[sample++];
        while (offset < block.writes.length && block.writes[offset] < time) {
          registers[block.writes[offset + 4] * REGISTER_BYTES + block.writes[offset + 2]] = block.writes[offset + 3];
          offset += WRITE_FIELDS;
        }
        frames.push({time, registers: registers.slice()});
      }
    }
    if (sample < sampleTimes.length) {
      // The sample sweep leaves only exact block boundaries; rounding preserves their original PCM frame after the seconds conversion.
      frames.push({time: end, registers: this.registersAt(Math.round(end * SAMPLE_RATE))});
    }
    return {start, end, frames, writes, dropped, ...(continuationStart === undefined ? {} : {continuationStart})};
  }

  render(frames: number): RenderResult {
    this.requireLoaded();
    validateFrames(frames);
    const startFrame = this.cursor;
    const pcm = new Int16Array(frames * this.channels);
    const writes: SidWrite[] = [];
    let dropped = 0;
    let copied = 0;
    while (copied < frames) {
      const cached = this.blockAt(this.cursor);
      if (cached) {
        const take = Math.min(frames - copied, cached.endFrame - this.cursor);
        pcm.set(cached.pcm.subarray((this.cursor - cached.startFrame) * this.channels, (this.cursor - cached.startFrame + take) * this.channels), copied * this.channels);
        const startSeconds = this.cursor / SAMPLE_RATE;
        const endSeconds = (this.cursor + take) / SAMPLE_RATE;
        for (let offset = 0; offset < cached.writes.length; offset += WRITE_FIELDS) {
          const timeSeconds = cached.writes[offset];
          if (timeSeconds >= endSeconds) break;
          if (this.cursor === cached.startFrame || timeSeconds >= startSeconds) writes.push(unpackWrite(cached.writes, offset));
        }
        if (this.cursor === cached.startFrame) dropped += cached.dropped;
        this.cursor += take;
        copied += take;
      } else {
        if (this.cursor !== this.frontier) throw new Error('Requested SID audio is outside retained history; seek before rendering');
        const reservationFrames = Math.floor((this.maxCacheBytes - this.frontierRegisters.byteLength - this.reservedBlockBytes) / this.reservedBytesPerFrame);
        const take = Math.min(frames - copied, MAX_BLOCK_FRAMES, Math.max(1, reservationFrames));
        // This block is consumed immediately, so previously read history may be evicted for it.
        this.cursor += take;
        let result: RenderResult;
        try {
          result = this.produce(take);
        } catch (error) {
          this.cursor -= take;
          throw error;
        }
        pcm.set(result.pcm, copied * this.channels);
        for (const write of result.writes) writes.push(write);
        dropped += result.dropped;
        copied += take;
      }
    }
    return { pcm, startFrame, endFrame: this.cursor, writes, registers: this.registersAt(this.cursor), dropped };
  }

  /** Produce at most one quarter-second block without moving the read cursor or evicting unread audio. */
  prefetch(frames: number): boolean {
    this.requireLoaded();
    validateFrames(frames);
    const desired = Math.min(frames, MAX_BLOCK_FRAMES);
    const desiredBytes = desired * this.reservedBytesPerFrame + this.reservedBlockBytes;
    while (this.blocks.length && this.blocks[0].endFrame <= this.cursor &&
      (this.maxCacheBytes - this.bytes < desiredBytes || this.blocks.length >= MAX_BLOCKS)) {
      this.evictFirst();
    }
    if (this.blocks.length >= MAX_BLOCKS) return false;
    const availableFrames = Math.floor((this.maxCacheBytes - this.bytes - this.reservedBlockBytes) / this.reservedBytesPerFrame);
    if (availableFrames < 1) return false;
    this.produce(Math.min(desired, availableFrames));
    return true;
  }

  private async advanceTo(frame: number): Promise<PositionResult> {
    const deadline = performance.now() + OPERATION_BUDGET_MS;
    this.cursor = this.frontier;
    let batches = 0;
    while (this.frontier < frame) {
      this.render(Math.min(MAX_RENDER_FRAMES, frame - this.frontier));
      if (performance.now() > deadline) throw new Error('SID execution exceeded the 15-second operation budget');
      if (++batches % 4 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        this.requireLoaded();
      }
    }
    return { frame: this.cursor, registers: this.registersAt(this.cursor) };
  }

  async seek(seconds: number): Promise<PositionResult> {
    this.requireLoaded();
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 600) {
      throw new Error('seek seconds must be finite and between 0 and 600');
    }
    const frame = Math.floor(seconds * SAMPLE_RATE);
    if (frame >= this.cacheStartFrame && frame <= this.frontier) {
      this.cursor = frame;
      return { frame, registers: this.registersAt(frame) };
    }
    if (frame > this.frontier) return this.advanceTo(frame);
    const position = await this.source.seek(seconds);
    this.requireLoaded();
    this.reset(position.frame, position.registers);
    return position;
  }

  async mute(mask: MuteMask): Promise<PositionResult> {
    this.requireLoaded();
    if (!Array.isArray(mask) || mask.length !== this.channels * 3 || mask.some((value) => typeof value !== 'boolean')) {
      throw new Error(`mute mask must contain exactly ${this.channels * 3} booleans (true means muted)`);
    }
    const frame = this.cursor;
    // Rebuilding muted history to the read cursor avoids replaying the producer's potentially long lead.
    await this.source.seek(0);
    const origin = await this.source.mute(mask);
    this.requireLoaded();
    this.reset(0, origin.registers);
    return this.advanceTo(frame);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loaded = false;
    this.blocks = [];
    this.frontierRegisters = new Uint8Array();
    this.bytes = 0;
    this.source.dispose();
  }
}

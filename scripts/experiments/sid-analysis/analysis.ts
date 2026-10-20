import type { LoadResult, RenderResult, SidWrite } from '../../../src/engine/session.ts';

const MAX_SECONDS = 600;
const MAX_MOMENTS = 12;
const STARTUP_SECONDS = 0.25;
const WAVEFORM_MINIMUM_SECONDS = 0.02;
const WAVEFORMS = ['triangle', 'sawtooth', 'pulse', 'noise'] as const;

type Range = { min: number; max: number };
type WaveformSeconds = Record<typeof WAVEFORMS[number] | 'none', number>;
type MomentKind = 'gate' | 'waveform' | 'modulation' | 'filter-routing';

export interface AnalysisMoment {
  timeSeconds: number;
  subject: { chip: number; voice: number | null };
  kind: MomentKind;
  before: number;
  after: number;
  evidence: 'observed';
  selection: 'heuristic';
}

export interface AnalysisReport {
  schemaVersion: 1;
  profile: LoadResult;
  definitions: {
    interval: string;
    gate: string;
    waveform: string;
    ranges: string;
    writes: string;
    filter: string;
    pcm: string;
    loss: string;
    moments: { maximum: number; startupSeconds: number; temporalBins: number; waveformMinimumSeconds: number; selection: string; values: string };
  };
  coverage: {
    requestedFrames: number;
    renderedFrames: number;
    requestedSeconds: number;
    renderedSeconds: number;
    droppedWrites: number;
    droppedBlocks: number;
    registerStateQuality: 'complete' | 'incomplete';
    reliableStateFrames: number;
  };
  voices: {
    chip: number;
    voice: number;
    observedWrites: number;
    valueChanges: number | null;
    gateTransitions: number | null;
    gateOnSeconds: number | null;
    waveformSeconds: WaveformSeconds | null;
    pulseWidthRange: Range | null;
  }[];
  chips: {
    chip: number;
    observedWrites: number;
    valueChanges: number | null;
    cutoffRange: Range | null;
    filterRoutingSeconds: [number, number, number] | null;
  }[];
  output: {
    sampleFormat: 'signed-16-bit';
    normalizationDivisor: 32768;
    channels: { channel: number; sampleCount: number; peak: number | null; rms: number | null; dc: number | null }[];
  };
  moments: AnalysisMoment[];
}

interface VoiceState {
  chip: number;
  voice: number;
  observedWrites: number;
  valueChanges: number;
  gateTransitions: number;
  gateOnSeconds: number;
  waveformSeconds: WaveformSeconds;
  waveformState: { confirmed: number | null; pending: number; since: number };
  pulseWidthRange: Range;
  lastTime: number;
}

interface ChipState {
  chip: number;
  observedWrites: number;
  valueChanges: number;
  cutoffRange: Range;
  filterRoutingSeconds: [number, number, number];
  lastTime: number;
}

interface Candidate { moment: AnalysisMoment; bin: number; order: number }

function range(value: number): Range { return { min: value, max: value }; }
function extend(target: Range, value: number): void {
  target.min = Math.min(target.min, value);
  target.max = Math.max(target.max, value);
}

function priority(kind: MomentKind): number {
  switch (kind) {
    case 'modulation': return 4;
    case 'filter-routing': return 3;
    case 'waveform': return 2;
    case 'gate': return 1;
  }
}

function compareCandidates(left: Candidate, right: Candidate): number {
  return priority(right.moment.kind) - priority(left.moment.kind) || left.moment.timeSeconds - right.moment.timeSeconds || left.order - right.order;
}

function validRegisters(registers: number[], channels: number): boolean {
  return Array.isArray(registers) && registers.length === channels * 32 && registers.every(value => Number.isInteger(value) && value >= 0 && value <= 255);
}

/** Summarizes ordered session observations without retaining PCM or the full write stream. */
export class AnalysisAccumulator {
  private readonly info: LoadResult;
  private readonly requestedFrames: number;
  private readonly registers: number[];
  private readonly voices: VoiceState[];
  private readonly chips: ChipState[];
  private readonly pcm: { count: number; peak: number; sum: number; squareSum: number }[];
  private readonly candidates = new Map<string, Candidate>();
  private renderedFrames = 0;
  private droppedWrites = 0;
  private droppedBlocks = 0;
  private reliableStateFrames = 0;
  private reliable = true;
  private lastWriteTime = -Infinity;
  private lastWriteCycle = -Infinity;
  private report: AnalysisReport | undefined;

  constructor(info: LoadResult, requestedFrames: number) {
    if (!Number.isInteger(info.sampleRate) || info.sampleRate < 1 || info.sampleRate > 192000 ||
      (info.channels !== 1 && info.channels !== 2) || info.installedSids !== info.channels ||
      info.sidChipBases.length !== info.channels || !validRegisters(info.registers, info.channels)) {
      throw new Error('Expected a complete one- or two-chip session profile');
    }
    if (!Number.isInteger(requestedFrames) || requestedFrames < 1 || requestedFrames > MAX_SECONDS * info.sampleRate) {
      throw new Error(`Requested frames must define a finite interval of at most ${MAX_SECONDS} seconds`);
    }
    this.info = { ...info, sidChipBases: [...info.sidChipBases], registers: [...info.registers], engine: { ...info.engine } };
    this.requestedFrames = requestedFrames;
    this.registers = [...info.registers];
    this.voices = Array.from({ length: info.channels * 3 }, (_, index) => ({
      chip: Math.floor(index / 3), voice: index % 3, observedWrites: 0, valueChanges: 0,
      gateTransitions: 0, gateOnSeconds: 0, lastTime: 0,
      waveformSeconds: { triangle: 0, sawtooth: 0, pulse: 0, noise: 0, none: 0 },
      waveformState: { confirmed: null, pending: this.registers[Math.floor(index / 3) * 32 + index % 3 * 7 + 4] & 0xf0, since: 0 },
      pulseWidthRange: range(this.pulseWidth(Math.floor(index / 3), index % 3)),
    }));
    this.chips = Array.from({ length: info.channels }, (_, chip) => ({
      chip, observedWrites: 0, valueChanges: 0, lastTime: 0,
      cutoffRange: range(this.cutoff(chip)), filterRoutingSeconds: [0, 0, 0],
    }));
    this.pcm = Array.from({ length: info.channels }, () => ({ count: 0, peak: 0, sum: 0, squareSum: 0 }));
  }

  private pulseWidth(chip: number, voice: number): number {
    const offset = chip * 32 + voice * 7;
    return this.registers[offset + 2] | (this.registers[offset + 3] & 15) << 8;
  }

  private cutoff(chip: number): number {
    return (this.registers[chip * 32 + 21] & 7) | this.registers[chip * 32 + 22] << 3;
  }

  private validate(block: RenderResult): void {
    if (this.report) throw new Error('Analysis is already finished');
    if (!Number.isInteger(block.startFrame) || !Number.isInteger(block.endFrame) ||
      block.startFrame !== this.renderedFrames || block.endFrame <= block.startFrame || block.endFrame > this.requestedFrames) {
      throw new Error('Render blocks must be contiguous within the requested frame interval');
    }
    if (!(block.pcm instanceof Int16Array) || block.pcm.length !== (block.endFrame - block.startFrame) * this.info.channels) {
      throw new Error('PCM must contain exactly the interleaved frames in the block');
    }
    if (!Number.isSafeInteger(block.dropped) || block.dropped < 0 || !validRegisters(block.registers, this.info.channels)) {
      throw new Error('Invalid dropped-write count or register snapshot');
    }
    let previousTime = this.lastWriteTime;
    let previousCycle = this.lastWriteCycle;
    for (const write of block.writes) {
      if (!Number.isFinite(write.timeSeconds) || write.timeSeconds < block.startFrame / this.info.sampleRate ||
        write.timeSeconds >= block.endFrame / this.info.sampleRate) throw new Error('Write time is outside the block interval');
      if (!Number.isSafeInteger(write.cyclePhi1) || write.cyclePhi1 < 0 || write.timeSeconds < previousTime || write.cyclePhi1 < previousCycle) {
        throw new Error('Writes must preserve chronological order');
      }
      if (!Number.isInteger(write.sidNumber) || write.sidNumber < 0 || write.sidNumber >= this.info.channels ||
        !Number.isInteger(write.address) || write.address < 0 || write.address > 31 ||
        !Number.isInteger(write.value) || write.value < 0 || write.value > 255) throw new Error('Invalid SID write');
      previousTime = write.timeSeconds;
      previousCycle = write.cyclePhi1;
    }
  }

  append(block: RenderResult): void {
    this.validate(block);
    if (block.dropped) {
      this.reliable = false;
      this.droppedWrites += block.dropped;
      this.droppedBlocks++;
    }
    for (const write of block.writes) this.observeWrite(write);
    for (let index = 0; index < block.pcm.length; index++) {
      const state = this.pcm[index % this.info.channels];
      const sample = block.pcm[index] / 32768;
      state.count++;
      state.peak = Math.max(state.peak, Math.abs(sample));
      state.sum += sample;
      state.squareSum += sample * sample;
    }
    this.renderedFrames = block.endFrame;
    if (this.reliable) this.reliableStateFrames = block.endFrame;
    const last = block.writes.at(-1);
    if (last) {
      this.lastWriteTime = last.timeSeconds;
      this.lastWriteCycle = last.cyclePhi1;
    }
  }

  private integrateVoice(voice: VoiceState, time: number): void {
    const elapsed = time - voice.lastTime;
    const control = this.registers[voice.chip * 32 + voice.voice * 7 + 4];
    if (control & 1) voice.gateOnSeconds += elapsed;
    for (const [index, waveform] of WAVEFORMS.entries()) if (control & (16 << index)) voice.waveformSeconds[waveform] += elapsed;
    if (!(control & 0xf0)) voice.waveformSeconds.none += elapsed;
    voice.lastTime = time;
  }

  private integrateChip(chip: ChipState, time: number): void {
    const elapsed = time - chip.lastTime;
    const routing = this.registers[chip.chip * 32 + 23];
    for (let voice = 0; voice < 3; voice++) if (routing & (1 << voice)) chip.filterRoutingSeconds[voice] += elapsed;
    chip.lastTime = time;
  }

  private nominate(kind: MomentKind, chip: number, voice: number | null, timeSeconds: number, before: number, after: number): void {
    if (before === after || timeSeconds < STARTUP_SECONDS) return;
    const bin = Math.min(MAX_MOMENTS - 1, Math.floor(timeSeconds * this.info.sampleRate / this.requestedFrames * MAX_MOMENTS));
    const key = `${kind}:${chip}:${voice}:${kind === 'gate' ? 'all' : bin}`;
    if (this.candidates.has(key)) return;
    this.candidates.set(key, {
      bin, order: this.candidates.size,
      moment: { timeSeconds, subject: { chip, voice }, kind, before, after, evidence: 'observed', selection: 'heuristic' },
    });
  }

  private confirmWaveform(voice: VoiceState, time: number): void {
    const state = voice.waveformState;
    if (time < state.since + WAVEFORM_MINIMUM_SECONDS) return;
    if (state.confirmed !== null) this.nominate('waveform', voice.chip, voice.voice, state.since, state.confirmed, state.pending);
    state.confirmed = state.pending;
  }

  private observeWrite(write: SidWrite): void {
    const chip = this.chips[write.sidNumber];
    const voice = write.address < 21 ? this.voices[write.sidNumber * 3 + Math.floor(write.address / 7)] : undefined;
    chip.observedWrites++;
    if (voice) voice.observedWrites++;
    if (!this.reliable) return;
    const index = write.sidNumber * 32 + write.address;
    const before = this.registers[index];
    if (before !== write.value) {
      chip.valueChanges++;
      if (voice) voice.valueChanges++;
    }
    if (voice) {
      this.integrateVoice(voice, write.timeSeconds);
      if (write.address % 7 === 4) {
        if ((before & 1) !== (write.value & 1)) voice.gateTransitions++;
        this.nominate('gate', write.sidNumber, voice.voice, write.timeSeconds, before & 1, write.value & 1);
        this.confirmWaveform(voice, write.timeSeconds);
        if ((write.value & 0xf0) !== voice.waveformState.pending) {
          voice.waveformState.pending = write.value & 0xf0;
          voice.waveformState.since = write.timeSeconds;
        }
        this.nominate('modulation', write.sidNumber, voice.voice, write.timeSeconds, before & 6, write.value & 6);
      }
    }
    if (write.address === 23) {
      this.integrateChip(chip, write.timeSeconds);
      this.nominate('filter-routing', write.sidNumber, null, write.timeSeconds, before & 7, write.value & 7);
    }
    this.registers[index] = write.value;
    if (voice && (write.address % 7 === 2 || write.address % 7 === 3)) extend(voice.pulseWidthRange, this.pulseWidth(voice.chip, voice.voice));
    if (write.address === 21 || write.address === 22) extend(chip.cutoffRange, this.cutoff(chip.chip));
  }

  private selectMoments(): AnalysisMoment[] {
    const candidates = [...this.candidates.values()].sort(compareCandidates);
    const selected = new Set<Candidate>();
    const bins = new Set<number>();
    for (const candidate of candidates) {
      if (!bins.has(candidate.bin)) {
        selected.add(candidate);
        bins.add(candidate.bin);
      }
    }
    for (const candidate of candidates) {
      if (selected.size >= MAX_MOMENTS) break;
      selected.add(candidate);
    }
    return [...selected].sort((left, right) => left.moment.timeSeconds - right.moment.timeSeconds || left.order - right.order).map(candidate => candidate.moment);
  }

  finish(): AnalysisReport {
    if (this.report) return this.report;
    const duration = this.renderedFrames / this.info.sampleRate;
    const derived = this.reliable && this.renderedFrames > 0;
    for (const voice of this.voices) this.confirmWaveform(voice, this.reliableStateFrames / this.info.sampleRate);
    if (derived) {
      for (const voice of this.voices) this.integrateVoice(voice, duration);
      for (const chip of this.chips) this.integrateChip(chip, duration);
    }
    this.report = {
      schemaVersion: 1, profile: this.info,
      definitions: {
        interval: 'The half-open interval [0, renderedFrames/sampleRate); a bound is not a detected song end. Indices are zero-based.',
        gate: 'Gate transitions count changed gate bits; gate-on seconds integrate programmed gate state, not audible duration.',
        waveform: 'Seconds integrate each enabled waveform bit independently, so combined waveforms overlap. none means no waveform bit is set.',
        ranges: 'Inclusive programmed ranges include initial settings and every observed update, including zero-duration intermediate settings. Pulse width is 12-bit; cutoff is 11-bit.',
        writes: 'Observed writes include redundant writes; value changes count byte differences from the preceding known value. Voice totals cover its seven registers; chip totals cover every register.',
        filter: 'Routing seconds integrate each of the three chip-shared filter voice-route bits; these are not isolated voice outputs.',
        pcm: 'Per interleaved output channel, PCM is divided by 32768; peak is absolute maximum, RMS is square-root mean square, DC is arithmetic mean. No audibility or Safari claim.',
        loss: 'Any dropped trace invalidates all derived register summaries; observed counts remain incomplete and PCM remains measurable. Moments are retained only before the first affected block; snapshots do not repair missing transitions.',
        moments: {
          maximum: MAX_MOMENTS, startupSeconds: STARTUP_SECONDS, temporalBins: MAX_MOMENTS, waveformMinimumSeconds: WAVEFORM_MINIMUM_SECONDS,
          selection: 'Heuristic: waveform moments compare successive settings each observed continuously for at least 20 ms, skipping shorter intermediate settings; the timestamp is the start of the later sustained setting. All writes remain in the metrics. Suppress the first 0.25 seconds, retain the first change per kind/subject in each of 12 equal requested-interval bins, and only one gate candidate per voice overall. Choose one candidate per occupied bin, then fill to 12, prioritizing modulation, filter-routing, waveform, then gate and earlier time. These are observed setting changes, not musical sections.',
          values: 'gate: control & 1; waveform: control & 0xf0, before/after are observed sustained settings and need not be adjacent writes; modulation: control & 6 (sync/ring); filter-routing: chip register 23 & 7.',
        },
      },
      coverage: {
        requestedFrames: this.requestedFrames, renderedFrames: this.renderedFrames,
        requestedSeconds: this.requestedFrames / this.info.sampleRate, renderedSeconds: duration,
        droppedWrites: this.droppedWrites, droppedBlocks: this.droppedBlocks,
        registerStateQuality: this.reliable ? 'complete' : 'incomplete', reliableStateFrames: this.reliableStateFrames,
      },
      voices: this.voices.map(voice => ({
        chip: voice.chip, voice: voice.voice, observedWrites: voice.observedWrites,
        valueChanges: derived ? voice.valueChanges : null, gateTransitions: derived ? voice.gateTransitions : null,
        gateOnSeconds: derived ? voice.gateOnSeconds : null, waveformSeconds: derived ? { ...voice.waveformSeconds } : null,
        pulseWidthRange: derived ? { ...voice.pulseWidthRange } : null,
      })),
      chips: this.chips.map(chip => ({
        chip: chip.chip, observedWrites: chip.observedWrites, valueChanges: derived ? chip.valueChanges : null,
        cutoffRange: derived ? { ...chip.cutoffRange } : null,
        filterRoutingSeconds: derived ? [...chip.filterRoutingSeconds] : null,
      })),
      output: {
        sampleFormat: 'signed-16-bit', normalizationDivisor: 32768,
        channels: this.pcm.map((state, channel) => ({
          channel, sampleCount: state.count, peak: state.count ? state.peak : null,
          rms: state.count ? Math.sqrt(state.squareSum / state.count) : null,
          dc: state.count ? state.sum / state.count : null,
        })),
      },
      moments: this.selectMoments(),
    };
    return this.report;
  }
}

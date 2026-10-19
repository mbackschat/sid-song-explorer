export type Clock = 'PAL' | 'NTSC';
export type ChipModel = 'MOS6581' | 'MOS8580';
export interface Profile {
  clock: Clock;
  model: ChipModel;
  subtune: number;
  durationSeconds?: number;
}
export interface TuneDetails {
  title: string;
  author: string;
  released: string;
  songs: number;
  subtune: number;
  clock: Clock;
  model: ChipModel;
  installedSids: number;
  sampleRate: number;
  registers: number[];
}
export interface WriteObservation {
  timeSeconds: number;
  cyclePhi1: number;
  address: number;
  value: number;
  sidNumber: number;
}
export interface RegisterFrame { time: number; registers: number[] }
export interface TimelineObservation {
  /** Actual retained coverage [start, end); the final register frame records state immediately before end. */
  start: number;
  end: number;
  frames: RegisterFrame[];
  writes: WriteObservation[];
  dropped: number;
}
export type PlayerStatus = 'empty' | 'loading' | 'ready' | 'playing' | 'paused' | 'seeking' | 'ended' | 'error';
export interface PlayerState {
  status: PlayerStatus;
  position: number;
  seekTarget: number | null;
  pendingOperation: 'seek' | 'voice-mix' | null;
  preparedRange: {start: number; end: number} | null;
  preview: TimelineObservation | null;
  renderedUntil: number;
  duration: number | null;
  error: string | null;
  info: TuneDetails | null;
  muted: boolean[];
  loop: {start: number; end: number} | null;
  peakDb: number;
  rmsDb: number;
  spectrum: Uint8Array;
  waveform: Float32Array;
  frames: RegisterFrame[];
  writes: WriteObservation[];
  historyStart: number;
  dropped: number;
  underruns: number;
  epoch: number;
}
export interface PlayerControls {
  load(bytes: Uint8Array, profile: Profile): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): Promise<void>;
  setMuted(mask: boolean[]): Promise<void>;
  setLoop(loop: {start: number; end: number} | null): Promise<void>;
  subscribe(listener: (state: PlayerState) => void): () => void;
  dispose(): void;
}

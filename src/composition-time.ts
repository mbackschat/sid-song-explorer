import type {CompositionPackage} from './composition-package.ts';

export type CompositionTiming = {
  schemaVersion: 1;
  packageSha256: string;
  engine: {moduleSha256: string; wasmSha256: string; sessionSha256: string};
  sampleRate: 44100;
  cyclesPerSecond: 983981.25;
  anchor: {sourceCall: number; timeSeconds: number};
  maxOnsetErrorSeconds: number;
  checkedEvents: number;
};

export type PlaybackCompositionPackage = Omit<CompositionPackage, 'timing'> & {
  sourceTiming: CompositionPackage['timing'];
  timing: {timeBasis: 'sidlite-pcm'; sampleRate: 44100; maxOnsetErrorSeconds: number};
};

function requireValue(condition: unknown, field: string): asserts condition {
  if (!condition) throw new Error(`Invalid composition timing: ${field}`);
}

function record(value: unknown, keys: string[], field: string): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), field);
  const result = value as Record<string, unknown>;
  requireValue(keys.every(key => Object.hasOwn(result, key)) && Object.keys(result).every(key => keys.includes(key)), `${field} fields`);
  return result;
}

function digest(value: unknown, field: string): void {
  requireValue(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), field);
}

function integer(value: unknown, min: number, max: number, field: string): asserts value is number {
  requireValue(Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max, field);
}

function number(value: unknown, min: number, max: number, field: string): asserts value is number {
  requireValue(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, field);
}

export function parseCompositionTiming(value: unknown): CompositionTiming {
  const timing = record(value, ['schemaVersion', 'packageSha256', 'engine', 'sampleRate', 'cyclesPerSecond', 'anchor', 'maxOnsetErrorSeconds', 'checkedEvents'], 'root');
  requireValue(timing.schemaVersion === 1, 'unsupported schema version');
  digest(timing.packageSha256, 'package SHA-256');
  const engine = record(timing.engine, ['moduleSha256', 'wasmSha256', 'sessionSha256'], 'engine');
  for (const field of ['moduleSha256', 'wasmSha256', 'sessionSha256']) digest(engine[field], `engine ${field}`);
  requireValue(timing.sampleRate === 44100 && timing.cyclesPerSecond === 983981.25, 'unsupported SIDLite PCM clock');
  const anchor = record(timing.anchor, ['sourceCall', 'timeSeconds'], 'anchor');
  integer(anchor.sourceCall, 0, 1_000_000, 'anchor source call');
  number(anchor.timeSeconds, 0, 600, 'anchor time');
  number(timing.maxOnsetErrorSeconds, 0, 0.01, 'onset error exceeds the 10 ms ceiling');
  integer(timing.checkedEvents, 1, 100_000, 'checked event count');
  return timing as CompositionTiming;
}

export function projectCompositionPackage(pkg: CompositionPackage, value: CompositionTiming): PlaybackCompositionPackage {
  const timing = parseCompositionTiming(value);
  const binding = pkg.binding;
  requireValue(binding.clock === 'PAL' && binding.sidModel === 'MOS6581' && binding.sidCount === 1 && binding.subtune === 1 && binding.baseAddress === 54272 && binding.routing === 'mono', 'unsupported source playback profile');
  requireValue(pkg.timing.callCycles === 19656 && pkg.timing.clockHz === 17_734_475 / 18 && pkg.timing.timeBasis === 'source-call-grid', 'unsupported source clock');
  const timeAt = (sourceCall: number) => {
    integer(sourceCall, 0, 1_000_000, 'projected source call');
    const seconds = timing.anchor.timeSeconds + (sourceCall - timing.anchor.sourceCall) * pkg.timing.callCycles / timing.cyclesPerSecond;
    requireValue(Number.isFinite(seconds) && seconds >= 0, 'negative or non-finite projected time');
    return seconds;
  };
  const interval = (startCall: number, endCall: number) => {
    const startSeconds = timeAt(startCall);
    const endSeconds = timeAt(endCall);
    requireValue(endSeconds > startSeconds, 'non-positive projected interval');
    return {startSeconds, endSeconds};
  };
  const {timing: sourceTiming, ...source} = structuredClone(pkg);
  const projected: PlaybackCompositionPackage = {
    ...source,
    sourceTiming,
    timing: {timeBasis: 'sidlite-pcm', sampleRate: timing.sampleRate, maxOnsetErrorSeconds: timing.maxOnsetErrorSeconds},
  };
  for (const passage of projected.passages) {
    Object.assign(passage, interval(passage.sourceStartCall, passage.sourceEndCall));
    for (const event of passage.events) Object.assign(event, interval(event.sourceCall, event.endSourceCall));
  }
  return projected;
}

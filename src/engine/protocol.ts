import type { LoadResult, MuteMask, PlaybackOptions, PositionResult, RenderResult } from './session.ts';

export type EngineRequest =
  | { id: number; method: 'load'; cacheEpoch: number; payload: { bytes: Uint8Array; options: PlaybackOptions; durationSeconds?: number } }
  | { id: number; method: 'render'; payload: { frames: number } }
  | { id: number; method: 'seek'; payload: { seconds: number } }
  | { id: number; method: 'mute'; cacheEpoch: number; payload: { mask: MuteMask } }
  | { id: number; method: 'dispose'; payload?: undefined };

export type EngineResult = LoadResult | RenderResult | PositionResult | null;
export type EngineReply = { id: number; result: EngineResult } | { id: number; error: string };

export interface CacheCoverage { epoch: number; startFrame: number; endFrame: number }
export type EngineEvent = { event: 'cache'; coverage: CacheCoverage };

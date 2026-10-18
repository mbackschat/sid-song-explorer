import type { LoadResult, MuteMask, PlaybackOptions, PositionResult, RenderResult } from './session.ts';

export type EngineRequest =
  | { id: number; method: 'load'; payload: { bytes: Uint8Array; options: PlaybackOptions } }
  | { id: number; method: 'render'; payload: { frames: number } }
  | { id: number; method: 'seek'; payload: { seconds: number } }
  | { id: number; method: 'mute'; payload: { mask: MuteMask } }
  | { id: number; method: 'dispose'; payload?: undefined };

export type EngineResult = LoadResult | RenderResult | PositionResult | null;
export type EngineReply = { id: number; result: EngineResult } | { id: number; error: string };

import type { TimelineObservation } from './player-types.ts';

export type DisplayedObservation = TimelineObservation & {endInclusive: boolean};

/** Combine connected coverage after the caller has verified a common configuration; retained data owns the overlap. */
export function composeTimelineObservations(retained: DisplayedObservation, prepared: DisplayedObservation): DisplayedObservation {
  if (!prepared.frames.length) return retained;
  if (!retained.frames.length || retained.end < retained.start || retained.end === retained.start && !retained.endInclusive || retained.end < prepared.start || prepared.end < retained.start ||
    retained.frames[0].registers.length !== prepared.frames[0]?.registers.length) return prepared;
  const contains = (observation: DisplayedObservation, time: number) => time >= observation.start &&
    (time < observation.end || observation.endInclusive && time === observation.end);
  const retainedFrames = retained.frames.filter(frame => contains(retained, frame.time));
  const boundary = observationRegistersAt(retained, retained.start, true);
  if (boundary && retainedFrames[0]?.time !== retained.start) retainedFrames.unshift({time: retained.start, registers: boundary});
  const frames = [
    ...prepared.frames.filter(frame => frame.time >= prepared.start && frame.time < retained.start),
    ...retainedFrames,
    ...prepared.frames.filter(frame => frame.time <= prepared.end && frame.time >= retained.end && !contains(retained, frame.time)),
  ];
  const writes = [
    ...prepared.writes.filter(write => contains(prepared, write.timeSeconds) && write.timeSeconds < retained.start),
    ...retained.writes.filter(write => contains(retained, write.timeSeconds)),
    ...prepared.writes.filter(write => contains(prepared, write.timeSeconds) && write.timeSeconds >= retained.end && !contains(retained, write.timeSeconds)),
  ];
  const end = Math.max(retained.end, prepared.end);
  return {
    start: Math.min(retained.start, prepared.start), end, frames, writes,
    endInclusive: retained.end === end && retained.endInclusive || prepared.end === end && prepared.endInclusive,
    // Both counts can cover the same CachedSidSession blocks; preserve the warning without counting that loss twice.
    dropped: Math.max(retained.dropped, prepared.dropped),
  };
}

export interface AudioSegment {
  contextStart: number;
  contextEnd: number;
  mediaStart: number;
  mediaEnd: number;
}

export function positionAt(segments: readonly AudioSegment[], contextTime: number, fallback: number): number {
  let position = fallback;
  for (const segment of segments) {
    if (contextTime < segment.contextStart) break;
    if (contextTime < segment.contextEnd) {
      return segment.mediaStart + (contextTime - segment.contextStart);
    }
    position = segment.mediaEnd;
  }
  return position;
}

export function trimHistory<T>(items: T[], capacity: number): number {
  const discarded = Math.max(0, items.length - capacity);
  if (discarded) items.splice(0, discarded);
  return discarded;
}

export function validateLoop(loop: {start: number; end: number} | null, duration: number | null) {
  if (loop === null) return null;
  if (!Number.isFinite(loop.start) || !Number.isFinite(loop.end) || loop.start < 0 || loop.end - loop.start < 0.1 || loop.end > (duration ?? 600)) {
    throw new Error('Choose a loop of at least 0.1 seconds within this tune (maximum 10 minutes for local files).');
  }
  return {start: loop.start, end: loop.end};
}

export const FOLLOW_WINDOW_SECONDS = 10;

export function followingWindow(position: number, seconds = FOLLOW_WINDOW_SECONDS) {
  const start = position - seconds / 2;
  return {start, end: start + seconds};
}

export function visibleTimelineFrames<T extends {time: number}>(frames: readonly T[], start: number, end: number): T[] {
  if (end < start) return [];
  const visible: T[] = [];
  let preceding: T | undefined;
  for (const frame of frames) {
    if (frame.time > end) break;
    if (frame.time < start) preceding = frame;
    else visible.push(frame);
  }
  if (preceding && visible[0]?.time !== start) visible.unshift({...preceding, time: start});
  const last = visible.at(-1);
  if (last && last.time < end) visible.push({...last, time: end});
  return visible;
}

export function fittedWindow(historyStart: number, observedUntil: number, selection?: {start: number; end: number}) {
  const start = Math.min(historyStart, selection?.start ?? historyStart);
  return {start, end: Math.max(start + FOLLOW_WINDOW_SECONDS, observedUntil, selection?.end ?? 0)};
}

export function observationRegistersAt(observation: TimelineObservation, seconds: number, includeEnd = false): number[] | null {
  if (seconds < observation.start || seconds > observation.end || (!includeEnd && seconds === observation.end)) return null;
  let frame;
  for (let index = observation.frames.length - 1; index >= 0; index--) {
    if (observation.frames[index].time <= seconds) { frame = observation.frames[index]; break; }
  }
  if (!frame) return null;
  const registers = [...frame.registers];
  for (const write of observation.writes) {
    if (write.timeSeconds > seconds) break;
    if (write.timeSeconds < frame.time || !Number.isInteger(write.sidNumber) || write.sidNumber < 0) continue;
    const address = write.address >= 0xd400 ? write.address - 0xd400 : write.address;
    const offset = write.sidNumber * 32 + address;
    if (address >= 0 && address < 32 && offset < registers.length) registers[offset] = write.value;
  }
  return registers;
}

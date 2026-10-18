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

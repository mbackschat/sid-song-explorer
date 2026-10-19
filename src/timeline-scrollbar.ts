export interface TimelineScrollbarGeometry {
  disabled: boolean;
  thumbFraction: number;
  leftFraction: number;
  maximumStart: number;
}

function maximumViewportStart(totalSeconds: number | null, spanSeconds: number): number {
  if (totalSeconds !== null && (!Number.isFinite(totalSeconds) || totalSeconds < 0)) {
    throw new Error('Total duration must be null or a finite nonnegative number.');
  }
  if (!Number.isFinite(spanSeconds) || spanSeconds <= 0) {
    throw new Error('Visible span must be finite and positive.');
  }
  return Math.max(0, (totalSeconds ?? 0) - spanSeconds);
}

export function timelineScrollbarGeometry(totalSeconds: number | null, spanSeconds: number, viewportStart: number): TimelineScrollbarGeometry {
  const maximumStart = maximumViewportStart(totalSeconds, spanSeconds);
  if (!Number.isFinite(viewportStart)) throw new Error('Viewport start must be finite.');
  if (totalSeconds === null || maximumStart === 0) {
    return {disabled: true, thumbFraction: 1, leftFraction: 0, maximumStart: 0};
  }
  return {
    disabled: false,
    thumbFraction: spanSeconds / totalSeconds,
    leftFraction: Math.max(0, Math.min(maximumStart, viewportStart)) / totalSeconds,
    maximumStart,
  };
}

export function timelineViewportStart(totalSeconds: number | null, spanSeconds: number, usableTrackProgress: number): number {
  const maximumStart = maximumViewportStart(totalSeconds, spanSeconds);
  if (!Number.isFinite(usableTrackProgress)) throw new Error('Usable track progress must be finite.');
  return Math.max(0, Math.min(1, usableTrackProgress)) * maximumStart;
}

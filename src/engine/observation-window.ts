import type { RegisterFrame, TimelineObservation } from '../player-types.ts';

const MAX_WINDOW_REQUESTS = 10;
const MAX_WINDOW_WRITES = 200_000;
const MAX_WINDOW_FRAMES = 1001;

export async function collectObservationWindow(
  start: number,
  end: number,
  request: (start: number, end: number) => Promise<TimelineObservation | null>,
  isCurrent: () => boolean,
): Promise<TimelineObservation | null> {
  const pages: TimelineObservation[] = [];
  let nextStart = start;
  let writeCount = 0;
  for (let index = 0; index < MAX_WINDOW_REQUESTS; index++) {
    if (!isCurrent()) return null;
    const observation = await request(nextStart, end);
    if (!isCurrent()) return null;
    if (!observation || observation.start >= observation.end || observation.end <= nextStart ||
      pages.length && observation.start !== nextStart || writeCount + observation.writes.length > MAX_WINDOW_WRITES) break;
    pages.push(observation);
    writeCount += observation.writes.length;
    if (observation.continuationStart !== observation.end || observation.end >= end || writeCount === MAX_WINDOW_WRITES) break;
    nextStart = observation.end;
  }
  if (!pages.length) return null;
  if (pages.length === 1) return pages[0];
  const frames: RegisterFrame[] = [];
  for (const page of pages) {
    for (const frame of page.frames) {
      if (frame.time !== frames.at(-1)?.time) frames.push(frame);
    }
  }
  const final = pages.at(-1)!;
  return {
    start: pages[0].start, end: final.end,
    frames: frames.length <= MAX_WINDOW_FRAMES ? frames : Array.from({length: MAX_WINDOW_FRAMES}, (_, index) =>
      frames[Math.floor(index * (frames.length - 1) / (MAX_WINDOW_FRAMES - 1))]),
    writes: pages.flatMap(page => page.writes),
    dropped: Math.max(...pages.map(page => page.dropped)),
    ...(final.continuationStart === undefined ? {} : {continuationStart: final.continuationStart}),
  };
}

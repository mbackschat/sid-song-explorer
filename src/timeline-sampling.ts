import type {RegisterFrame, TimelineObservation, WriteObservation} from './player-types.ts';

const SAMPLE_RATE = 44100;
const SAMPLE_FRAMES = 882;

/** Keep chart samples anchored to delivered PCM time across moving viewports and playback handoff. */
export function timelineSampleTimes(start: number, end: number, maxFrames = Infinity): number[] {
  if (end < start) return [];
  const capacity = Math.max(2, Math.floor(maxFrames));
  // Subtraction can move a translated viewport across a density threshold by one ulp; PCM-frame rounding fixes its grid (tests/timeline-sampling.test.ts).
  const spanFrames = Math.round((end - start) * SAMPLE_RATE);
  const stride = Number.isFinite(capacity)
    ? 2 ** Math.max(0, Math.ceil(Math.log2(spanFrames / SAMPLE_FRAMES / (capacity - 1)))) : 1;
  let first = Math.ceil(start * SAMPLE_RATE / (SAMPLE_FRAMES * stride));
  let last = Math.floor(end * SAMPLE_RATE / (SAMPLE_FRAMES * stride));
  const time = (index: number) => index * stride * SAMPLE_FRAMES / SAMPLE_RATE;
  if (time(first - 1) >= start) first--;
  if (time(first) < start) first++;
  if (time(last + 1) <= end) last++;
  if (time(last) > end) last--;
  return Array.from({length:Math.max(0,last - first + 1)},(_, index) => time(first + index));
}

/** Preserve exact coverage baselines alongside the bounded absolute grid used by detailed observations. */
export function timelineObservationTimes(start: number, end: number, maxFrames = 1001): number[] {
  return [start,...timelineSampleTimes(start,end,maxFrames - 2).filter(time => time > start && time < end),end];
}

/** Sample register state immediately before each time, matching TimelineObservation's endpoint contract. */
export function sampleTimelineRegisters(registers: readonly number[], writes: Iterable<WriteObservation>, times: readonly number[]): RegisterFrame[] {
  const current = [...registers];
  const source = writes[Symbol.iterator]();
  let next = source.next();
  return times.map(time => {
    while (!next.done && next.value.timeSeconds < time) {
      const write = next.value;
      const address = write.address >= 0xd400 ? write.address & 31 : write.address;
      const register = write.sidNumber * 32 + address;
      if (Number.isInteger(write.sidNumber) && write.sidNumber >= 0 && address >= 0 && address < 32 && register < current.length) current[register] = write.value;
      next = source.next();
    }
    return {time,registers:current.slice()};
  });
}

/** Project complete ordered observations on a viewport-owned grid; packet baselines never become extra plotted events. */
export function timelinePlotFrames(observation: TimelineObservation, plotStart: number, plotEnd: number, maxFrames: number): RegisterFrame[] {
  const start = Math.max(plotStart,observation.start);
  const end = Math.min(plotEnd,observation.end);
  if (end < start) return [];
  let baseline: RegisterFrame | undefined;
  for (const frame of observation.frames) {
    if (frame.time > start) break;
    baseline = frame;
  }
  if (!baseline) return [];
  const times = timelineSampleTimes(plotStart,plotEnd,maxFrames).filter(time => time >= start && time <= end);
  return sampleTimelineRegisters(baseline.registers,observation.writes.filter(write => write.timeSeconds >= baseline.time),times);
}

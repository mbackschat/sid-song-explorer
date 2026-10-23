import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {CachedSidSession} from '../src/engine/cached-session.ts';
import {SidSession} from '../src/engine/session.ts';
import {ExplorerPlayer} from '../src/player.ts';
import {composeTimelineObservations, observationRegistersAt} from '../src/timeline.ts';
import {sampleTimelineRegisters, timelinePlotFrames, timelineSampleTimes} from '../src/timeline-sampling.ts';
import type {RegisterFrame, TimelineObservation, WriteObservation} from '../src/player-types.ts';

const writes: WriteObservation[] = [
  {timeSeconds:-0.001,address:15,value:0x10},
  {timeSeconds:0.021,address:24,value:15},
  {timeSeconds:0.0399,address:15,value:0xf0},
  {timeSeconds:0.04,address:22,value:127},
  {timeSeconds:0.0401,address:15,value:0x10},
  {timeSeconds:0.042,address:24,value:15},
  {timeSeconds:0.0549,address:15,value:0xd0},
  {timeSeconds:0.0551,address:15,value:0x10},
  {timeSeconds:0.063,address:24,value:15},
  {timeSeconds:0.0799,address:15,value:0xe0},
  {timeSeconds:0.0801,address:15,value:0x10},
  {timeSeconds:0.084,address:24,value:15},
].map(write => ({...write,cyclePhi1:Math.round(write.timeSeconds * 985000),sidNumber:0}));

function registersAt(seconds: number): number[] {
  const registers = Array<number>(32).fill(0);
  for (const write of writes) if (write.timeSeconds < seconds) registers[write.address] = write.value;
  return registers;
}

function recorded(frames: RegisterFrame[], ...blocks: ReturnType<SidSession['render']>[]) {
  const player = Object.create(ExplorerPlayer.prototype) as {state: {info: {sidChipBases: number[]}; frames: RegisterFrame[]; writes: WriteObservation[]; dropped: number; historyStart: number}; registers: number[]; record: (block: ReturnType<SidSession['render']>) => void};
  player.state = {info:{sidChipBases:[0xd400]},frames,writes:[],dropped:0,historyStart:0};
  player.registers = Array<number>(32).fill(0);
  for (const block of blocks) player.record(block);
  return player.state;
}

async function syntheticCache(context: TestContext) {
  let frontier = 0;
  context.mock.method(SidSession,'create',async () => ({
    load:async () => ({channels:1,registers:Array<number>(32).fill(0),sidChipBases:[0xd400]}),
    render:(frames: number) => {
      const startFrame = frontier;
      frontier += frames;
      return {startFrame,endFrame:frontier,pcm:new Int16Array(frames),dropped:0,
        writes:writes.filter(write => (startFrame === 0 || write.timeSeconds >= startFrame / 44100) && write.timeSeconds < frontier / 44100),
        registers:registersAt(frontier / 44100)};
    },
    dispose() {},
  }));
  const cached = await CachedSidSession.create();
  context.after(() => cached.dispose());
  await cached.load(new Uint8Array(),{clock:'PAL',model:'MOS6581',subtune:1});
  return cached;
}

const voiceThreeFrequency = (frame: RegisterFrame) => (frame.registers[15] << 8) | frame.registers[14];

test('prepared frequency excursions survive the handoff to scheduled observations',async context => {
  const cached = await syntheticCache(context);
  cached.prefetch(4410);
  const preview = cached.observe(0.02,0.1)!;
  const scheduled = recorded([{time:0,registers:Array<number>(32).fill(0)}],cached.render(4410));
  const after = composeTimelineObservations({...scheduled,start:0,end:0.1,endInclusive:false},{...preview,endInclusive:false});
  assert.equal(scheduled.frames[0].registers[15],0x10,'negative startup writes belong to the origin baseline');
  for (const center of [0.04,0.08]) {
    const peak = (observation: TimelineObservation) => Math.max(...observation.frames.filter(frame => Math.abs(frame.time-center) <= 0.01).map(voiceThreeFrequency));
    assert.equal(observationRegistersAt(preview,center)?.[15],observationRegistersAt(after,center)?.[15]);
    assert.ok(peak(preview) > 0x1000,'the independent synthetic pulse must be represented in the preview');
    assert.equal(peak(after),peak(preview),`the prepared pulse at ${center}s must retain its plotted peak`);
  }
});

test('packet edges and sparse baselines cannot add frequency excursions to the plotted grid',async context => {
  const cached = await syntheticCache(context);
  cached.prefetch(4410);
  const partial = cached.observe(0.001,0.055)!;
  const complete = cached.observe(0.001,0.095)!;
  assert.equal(voiceThreeFrequency(partial.frames.at(-1)!),0xd000,'the packet edge catches a real pulse between grid samples');
  const before = timelinePlotFrames(partial,0,0.1,1001);
  const after = timelinePlotFrames(complete,0,0.1,1001);
  assert.deepEqual(before,after.filter(frame => frame.time <= partial.end));
  assert.ok(before.every(frame => voiceThreeFrequency(frame) !== 0xd000));
  const sparse = {...complete,frames:[complete.frames[0],complete.frames.at(-1)!]};
  assert.deepEqual(timelinePlotFrames(sparse,0,0.1,1001),after);
  for (const frame of after) assert.deepEqual(frame.registers,registersAt(frame.time));
});

test('plot density follows the full viewport while available coverage and viewport origin move',async context => {
  const cached = await syntheticCache(context);
  cached.prefetch(4410);
  const observation = cached.observe(0,0.1)!;
  const partial = {...observation,end:0.055};
  const complete = timelinePlotFrames(observation,0,0.1,4);
  assert.deepEqual(timelinePlotFrames(partial,0,0.1,4),complete.filter(frame => frame.time <= partial.end));
  const first = timelinePlotFrames(observation,0.001,0.091,4);
  const shifted = timelinePlotFrames(observation,0.005,0.095,4);
  assert.deepEqual(first,shifted);
  for (const maxFrames of [2,3,10,1001]) {
    const times = timelineSampleTimes(0.0001,600.0001,maxFrames);
    assert.ok(times.length <= maxFrames);
    assert.deepEqual(times,timelineSampleTimes(0.001,600.001,maxFrames));
  }
});

test('sample boundaries preserve ordered chip writes strictly before each timestamp',() => {
  const ordered = [
    {timeSeconds:0.04,cyclePhi1:1,sidNumber:1,address:0xd404,value:17},
    {timeSeconds:0.04,cyclePhi1:2,sidNumber:1,address:0xd404,value:33},
    {timeSeconds:0.05,cyclePhi1:3,sidNumber:0,address:4,value:65},
  ];
  const baseline = Array<number>(64).fill(0);
  const frames = sampleTimelineRegisters(baseline,ordered,[0.04,0.06]);
  assert.equal(frames[0].registers[36],0);
  assert.equal(frames[1].registers[36],33);
  assert.equal(frames[1].registers[4],65);
  assert.deepEqual(baseline,Array<number>(64).fill(0));
});

test('translated viewport subtraction cannot cross an absolute-grid density threshold',() => {
  const absolute = timelineSampleTimes(0,200);
  for (const maxFrames of [3,4,10,1001]) {
    const span = (maxFrames - 1) * 0.02;
    for (const start of [0.001,10.123,100.234]) {
      const end = start + span;
      const expected = absolute.filter(time => time >= start && time <= end);
      assert.deepEqual(timelineSampleTimes(start,end,maxFrames),expected);
    }
  }
});

test('translating the observation request preserves interior sample times and settings',async context => {
  const cached = await syntheticCache(context);
  cached.prefetch(4410);
  const first = cached.observe(0.001,0.091)!;
  const shifted = cached.observe(0.005,0.095)!;
  const interior = (observation: TimelineObservation) => observation.frames.filter(frame => frame.time >= 0.02 && frame.time <= 0.08);
  assert.deepEqual(interior(first),interior(shifted));
  for (const frame of interior(first)) assert.deepEqual(frame.registers,registersAt(frame.time));
});

test('scheduled sampling is independent of render block boundaries, including a write at the boundary',async context => {
  const cached = await syntheticCache(context);
  cached.prefetch(4410);
  const whole = recorded([{time:0,registers:Array<number>(32).fill(0)}],cached.render(4410));
  await cached.seek(0);
  const split = recorded([{time:0,registers:Array<number>(32).fill(0)}],cached.render(1764),cached.render(2646));
  assert.deepEqual(split.frames,whole.frames);
  assert.deepEqual(split.writes,whole.writes);
});

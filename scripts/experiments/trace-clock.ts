import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import loadLibsidplayfp from 'libsidplayfp-wasm';
import {SidSession, SAMPLE_RATE, type PlaybackOptions, type SidWrite} from '../../src/engine/session.ts';

const bytes = new Uint8Array(await readFile('public/generated/rambo-loader-main.sid'));
const deadline = performance.now() + 60_000;
const checkBudget = () => assert.ok(performance.now() < deadline, '60-second experiment budget');
const output = process.argv[2] ?? 'build/seek-study/trace-clock.json';
const results = [];
const nominalClocks = {PAL:4433618.75 * 4 / 18, NTSC:3579545.455 * 4 / 14};

for (const options of [
  {clock:'PAL', model:'MOS6581', subtune:1},
  {clock:'NTSC', model:'MOS8580', subtune:1},
] as PlaybackOptions[]) {
  const nominal = nominalClocks[options.clock];
  const ratio = Math.floor(Math.trunc(nominal) * 16 / SAMPLE_RATE);
  const pcmClock = ratio / 16 * SAMPLE_RATE;
  const module = await loadLibsidplayfp({engine:'sidlite'});
  const raw = new module.SidPlayerContext();
  assert.ok(raw.configure(SAMPLE_RATE, false));
  assert.ok(raw.setEmulationConfig({frequency:SAMPLE_RATE, stereo:false, c64Model:options.clock,
    forceC64Model:true, sidModel:options.model, forceSidModel:true, powerOnDelay:0,
    secondSidAddress:0, thirdSidAddress:0}));
  raw.setSidWriteTraceEnabled(true);
  assert.ok(raw.loadSidBuffer(bytes));
  raw.getAndClearSidWriteTracesPacked();
  let calibrationFrames = 0;
  let firstWrite = 0;
  for (let probe = 0; probe < 20000; probe++) {
    checkBudget();
    const pcm = raw.render(1)!.slice();
    calibrationFrames += pcm.length;
    const packed = raw.getAndClearSidWriteTracesPacked();
    if (packed.length) {firstWrite = packed[3]; break;}
  }
  assert.ok(firstWrite);
  const origin = firstWrite - calibrationFrames * pcmClock / SAMPLE_RATE;
  const nominalOrigin = firstWrite - calibrationFrames * nominal / SAMPLE_RATE;
  assert.ok(raw.reset());
  raw.getAndClearSidWriteTracesPacked();
  let produced = 0;
  let nominalOutside = 0;
  let correctedOutside = 0;
  let maxCorrectedOutsideFrames = 0;
  let maxNominalEarlyFrames = 0;
  let rawCalls = 0;
  // Independently bound each write by the actual PCM made during the raw call
  // that emits it. This oracle uses no adapter delivery/caching decisions.
  while (produced < SAMPLE_RATE * 35) {
    checkBudget();
    const pcm = raw.render(20000)!.slice();
    const packed = raw.getAndClearSidWriteTracesPacked();
    const end = produced + pcm.length;
    for (let index = 0; index < packed.length; index += 4) {
      const correctedFrame = (packed[index + 3] - origin) / (ratio / 16);
      const nominalFrame = (packed[index + 3] - nominalOrigin) / nominal * SAMPLE_RATE;
      const correctedOutsideFrames = Math.max(produced - correctedFrame, correctedFrame - end, 0);
      maxCorrectedOutsideFrames = Math.max(maxCorrectedOutsideFrames, correctedOutsideFrames);
      if (correctedOutsideFrames > 1) correctedOutside++;
      if (nominalFrame < produced - 1 || nominalFrame > end + 1) nominalOutside++;
      maxNominalEarlyFrames = Math.max(maxNominalEarlyFrames, produced - nominalFrame);
    }
    produced = end;
    rawCalls++;
  }
  raw.delete();

  async function load(corrected: boolean) {
    const session = await SidSession.create();
    const info = await session.load(bytes, options);
    {
      // Explicit variants preserve the nominal-clock failure reproduction after
      // production adopts SIDLite's source rate, without changing PCM generation.
      const internal = session as unknown as {state:{traceCycleOrigin:number}; appendWrites:(state:{pendingWrites:SidWrite[]},packed:Float64Array)=>void};
      internal.state.traceCycleOrigin = corrected ? origin : nominalOrigin;
      internal.appendWrites = (state, packed) => {
        for (let index = 0; index < packed.length; index += 4) {
          const cyclePhi1 = packed[index + 3];
          state.pendingWrites.push({sidNumber:packed[index],address:packed[index + 1],value:packed[index + 2],cyclePhi1,
            timeSeconds:(cyclePhi1 - (corrected ? origin : nominalOrigin)) / (corrected ? pcmClock : nominal)});
        }
      };
    }
    return {session, info};
  }

  const variants = [];
  for (const corrected of [false,true]) {
    const {session:cached, info} = await load(corrected);
    const {session:replay} = await load(corrected);
    try {
      const pcm = new Int16Array(SAMPLE_RATE * 35);
      const writes:SidWrite[] = [];
      let intervalViolations = 0;
      for (let frame = 0; frame < pcm.length;) {
        checkBudget();
        const block = cached.render(Math.min(SAMPLE_RATE, pcm.length - frame));
        pcm.set(block.pcm, frame);
        writes.push(...block.writes);
        intervalViolations += block.writes.filter(write => write.timeSeconds < frame / SAMPLE_RATE || write.timeSeconds >= block.endFrame / SAMPLE_RATE).length;
        frame = block.endFrame;
      }
      const seeks = [];
      for (const seconds of [5.731234,30.731234]) {
        checkBudget();
        const frame = Math.floor(seconds * SAMPLE_RATE);
        const count = 4096;
        await replay.seek(seconds);
        const actual = replay.render(count);
        assert.deepEqual(actual.pcm, pcm.slice(frame,frame + count));
        const selected = writes.filter(write => write.timeSeconds >= frame / SAMPLE_RATE && write.timeSeconds < (frame + count) / SAMPLE_RATE);
        const registers = [...info.registers];
        for (const write of writes) {
          if (write.timeSeconds >= (frame + count) / SAMPLE_RATE) break;
          registers[write.address] = write.value;
        }
        const result = {seconds,pcmEqual:true,writesEqual:isDeepStrictEqual(selected,actual.writes),registersEqual:isDeepStrictEqual(registers,actual.registers),
          intervalViolations:actual.writes.filter(write => write.timeSeconds < frame / SAMPLE_RATE || write.timeSeconds >= (frame + count) / SAMPLE_RATE).length,
          selectedCount:selected.length,replayedCount:actual.writes.length};
        if (corrected) {
          assert.ok(result.writesEqual, 'corrected cache/replay writes');
          assert.ok(result.registersEqual, 'corrected cache/replay registers');
          assert.equal(result.intervalViolations,0);
        }
        seeks.push(result);
      }
      if (corrected) assert.equal(intervalViolations,0);
      variants.push({corrected,intervalViolations,seeks});
    } finally {cached.dispose();replay.dispose();}
  }
  assert.equal(correctedOutside,0);
  const result = {options,ratio,pcmClock,nominal,calibrationFrames,firstWrite,origin,rawOracle:{rawCalls,produced,nominalOutside,correctedOutside,maxCorrectedOutsideFrames,maxNominalEarlyFrames},variants};
  results.push(result);
  console.log(JSON.stringify(result));
}
await mkdir('build/seek-study',{recursive:true});
await writeFile(output,JSON.stringify({date:new Date().toISOString(),runtime:process.version,scope:'silent 35-second raw/adapter experiment; explicit nominal and SIDLite PCM clock variants are substituted only within this process',results},null,2)+'\n');
console.log(`Saved ${output}`);

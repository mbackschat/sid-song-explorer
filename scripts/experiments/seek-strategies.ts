import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {cpus, platform, arch} from 'node:os';
import {SidSession, SAMPLE_RATE, type PlaybackOptions, type RenderResult} from '../../src/engine/session.ts';

const output = process.argv[2] ?? 'build/seek-study/node.json';
const bytes = new Uint8Array(await readFile('public/generated/rambo-loader-main.sid'));
const deadline = performance.now() + 60_000;
const guard = () => assert.ok(performance.now() < deadline, 'Experiment exceeded its 60-second budget');
const results: unknown[] = [];

for (const [options, duration, targets] of [
  [{clock:'PAL', model:'MOS6581', subtune:1}, 193.35884353741497, [30.731234, 90.12345, 180.23456]],
  [{clock:'NTSC', model:'MOS8580', subtune:1}, 35, [5.731234, 30.12345]],
] as [PlaybackOptions, number, number[]][]) {
  const renderer = await SidSession.create();
  const replay = await SidSession.create();
  try {
    const start = performance.now();
    const info = await renderer.load(bytes, options);
    const loadMs = performance.now() - start;
    await replay.load(bytes, options);
    const initialRegisters = info.registers;
    const frames = Math.floor(duration * SAMPLE_RATE);
    const pcm = new Int16Array(frames);
    const blocks: Omit<RenderResult, 'pcm'>[] = [];
    const chunkMs: number[] = [];
    const milestones: {seconds:number; elapsedMs:number}[] = [];
    const renderStart = performance.now();
    for (let frame = 0; frame < frames;) {
      guard();
      const before = performance.now();
      const block = renderer.render(Math.min(SAMPLE_RATE, frames - frame));
      chunkMs.push(performance.now() - before);
      pcm.set(block.pcm, frame);
      const {pcm: _, ...observations} = block;
      blocks.push(observations);
      assert.equal(block.dropped, 0);
      frame = block.endFrame;
      if ([1, 30, 90, 180].includes(frame / SAMPLE_RATE)) milestones.push({seconds:frame / SAMPLE_RATE, elapsedMs:performance.now() - renderStart});
    }
    const cacheBuildMs = performance.now() - renderStart;
    console.log(`${options.clock}/${options.model}: ${duration.toFixed(2)} s cached in ${cacheBuildMs.toFixed(1)} ms`);

    const readCache = (frame:number, count:number) => {
      assert.ok(frame >= 0 && frame + count <= frames);
      const index = Math.floor(frame / SAMPLE_RATE);
      const registers = [...(index ? blocks[index - 1]!.registers : initialRegisters)];
      for (const write of blocks[index]!.writes) {
        if (write.timeSeconds >= frame / SAMPLE_RATE) break;
        registers[write.address] = write.value;
      }
      const writes = blocks.slice(index, Math.ceil((frame + count) / SAMPLE_RATE)).flatMap(block => block.writes)
        .filter(write => write.timeSeconds >= frame / SAMPLE_RATE && write.timeSeconds < (frame + count) / SAMPLE_RATE);
      for (const write of writes) registers[write.address] = write.value;
      return {pcm:pcm.slice(frame, frame + count), writes, registers};
    };
    const seeks: unknown[] = [];
    for (const seconds of targets) {
      guard();
      const frame = Math.floor(seconds * SAMPLE_RATE);
      const before = performance.now();
      await replay.seek(seconds);
      const replayMs = performance.now() - before;
      const actual = replay.render(4096);
      const cacheBefore = performance.now();
      const cached = readCache(frame, 4096);
      const cachedReadMs = performance.now() - cacheBefore;
      assert.deepEqual(cached.pcm, actual.pcm);
      assert.deepEqual(cached.writes, actual.writes);
      assert.deepEqual(cached.registers, actual.registers);
      const forwardTarget = frame + SAMPLE_RATE;
      const forwardBefore = performance.now();
      replay.render(forwardTarget - actual.endFrame);
      const advanceMs = performance.now() - forwardBefore;
      const advanced = replay.render(4096);
      const forwardCached = readCache(forwardTarget, 4096);
      assert.deepEqual(advanced.pcm, forwardCached.pcm);
      assert.deepEqual(advanced.writes, forwardCached.writes);
      assert.deepEqual(advanced.registers, forwardCached.registers);
      seeks.push({seconds, replayMs, cachedReadMs, advanceSeconds:(forwardTarget - actual.endFrame) / SAMPLE_RATE, advanceMs});
      console.log(`  ${seconds.toFixed(3)} s: replay ${replayMs.toFixed(1)} ms; cache ${cachedReadMs.toFixed(3)} ms; forward delta ${advanceMs.toFixed(1)} ms; PCM/writes/registers exact`);
    }
    const latencies: number[] = [];
    for (let index = 0; index < 1000; index++) {
      const frame = (index * 7919) % (frames - 4096);
      const before = performance.now();
      readCache(frame, 4096);
      latencies.push(performance.now() - before);
    }
    latencies.sort((a,b) => a-b);
    chunkMs.sort((a,b) => a-b);
    const writeCount = blocks.reduce((sum, block) => sum + block.writes.length, 0);
    results.push({options, duration, loadMs, cacheBuildMs, milestones, renderChunkMs:{p50:chunkMs[Math.floor(chunkMs.length*.5)],p95:chunkMs[Math.floor(chunkMs.length*.95)],max:chunkMs.at(-1)}, pcmBytes:pcm.byteLength, writeCount, packedObservationBytes:writeCount*32+blocks.length*32, objectObservationHeapBytes:null, cachedReadMs:{p50:latencies[500],p95:latencies[950],max:latencies.at(-1)}, seeks, verified:'4096-frame PCM, ordered writes and endpoint registers equal independent replay at non-block targets and forward continuation'});
  } finally {renderer.dispose();replay.dispose();}
}
await mkdir(dirname(output), {recursive:true});
await writeFile(output, JSON.stringify({date:new Date().toISOString(),runtime:process.version,platform:platform(),arch:arch(),cpu:cpus()[0]?.model,engine:'libsidplayfp-wasm 1.1.0 / SIDLite',sidSha256:createHash('sha256').update(bytes).digest('hex'),scope:'silent Node experiment; cache is experimental, not integrated into browser transport; packed bytes are a representation estimate, not observed JS heap usage',results}, null, 2)+'\n');
console.log(`Saved ${output}`);

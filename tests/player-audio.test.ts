import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {ExplorerPlayer} from '../src/player.ts';
import type {PlayerState, TuneDetails} from '../src/player-types.ts';

interface Request {id: number; method: string; payload: {frames?: number}}

function fixture(t: TestContext) {
  const requests: Request[] = [];
  let reply: (request: Request, result: unknown) => void = () => {};
  let tick = () => {};
  let contextTime = 0;
  const scheduled: {start: number; frames: number}[] = [];
  const globals = {
    Worker: class {
      onmessage?: (event: {data: unknown}) => void;
      constructor() { reply = (request, result) => this.onmessage?.({data: {id: request.id, result}}); }
      postMessage(request: Request) { requests.push(request); }
      terminate() {}
    },
    AudioContext: class {
      get currentTime() { return contextTime; }
      destination = {};
      async resume() {}
      async suspend() {}
      async close() {}
      createGain() { return {gain: {value: 1}, connect() {}, disconnect() {}}; }
      createChannelSplitter() { return {connect() {}, disconnect() {}}; }
      createAnalyser() { return {connect() {}, disconnect() {}}; }
      createBuffer(channels: number, frames: number) {
        const data = Array.from({length: channels}, () => new Float32Array(frames));
        return {length: frames, getChannelData: (channel: number) => data[channel]};
      }
      createBufferSource() {
        return {
          buffer: {length: 0},
          connect() {}, disconnect() {}, stop() {},
          start(time: number) { scheduled.push({start: time, frames: this.buffer.length}); },
        };
      }
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setInterval: (callback: () => void) => { tick = callback; return 1; },
    clearInterval: () => {},
  };
  const restore: (() => void)[] = [];
  for (const [name, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
    restore.push(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const player = new ExplorerPlayer();
  let state!: PlayerState;
  player.subscribe(value => { state = value; });
  t.after(() => {
    player.dispose();
    for (const reset of restore) reset();
  });
  const latest = (method: string) => {
    const request = [...requests].reverse().find(request => request.method === method);
    assert.ok(request);
    return request;
  };
  const registers = Array<number>(32).fill(0);
  const details: TuneDetails = {
    title: 'Scheduling fixture', author: '', released: '', songs: 1, subtune: 1,
    clock: 'PAL', model: 'MOS6581', installedSids: 1, channels: 1, sidChipBases: [0xd400], sampleRate: 44100, registers,
  };
  let frame = 0;
  const answered = new Set<number>();
  return {
    player, scheduled, latest, get state() { return state; },
    setTime(time: number) { contextTime = time; },
    tick() { tick(); },
    async load() {
      const loading = player.load(new Uint8Array([0]), {clock: 'PAL', model: 'MOS6581', subtune: 1, durationSeconds: 200});
      reply(latest('load'), details);
      await loading;
    },
    seekReply(seconds: number) { frame = seconds * 44100; reply(latest('seek'), {frame, registers}); },
    async drainRender() {
      for (let index = 0; index < 8; index++) {
        await Promise.resolve();
        const request = requests.find(request => request.method === 'render' && !answered.has(request.id));
        if (!request) continue;
        answered.add(request.id);
        const frames = request.payload.frames!;
        reply(request, {pcm: new Int16Array(frames), startFrame: frame, endFrame: frame + frames, writes: [], registers, dropped: 0});
        frame += frames;
      }
    },
  };
}

test('a delayed first render primes the existing audio horizon before starting the output clock', async t => {
  const value = fixture(t);
  await value.load();
  const playing = value.player.play();
  await Promise.resolve();
  value.setTime(0.2);
  await value.drainRender();
  await playing;
  assert.equal(value.scheduled[0].frames, 11025, 'the first source must already hold the 250ms refill horizon');
  assert.equal(value.scheduled[0].start, 0.26, 'anchor playback after PCM arrives, not before its worker round trip');
  assert.equal(value.state.underruns, 0, 'waiting for the first PCM is startup latency, not an interrupted stream');
  value.setTime(0.3);
  value.tick();
  value.setTime(0.45);
  await value.drainRender();
  assert.equal(value.scheduled[1].start, 0.51, 'the primed reserve must bridge a delayed refill without an audio gap');
  assert.equal(value.state.underruns, 0);
});

test('seek restart primes audio again while an exhausted running stream still reports an underrun', async t => {
  const value = fixture(t);
  await value.load();
  const playing = value.player.play();
  await value.drainRender();
  await playing;
  const seeking = value.player.seek(20);
  value.seekReply(20);
  await Promise.resolve();
  value.setTime(0.2);
  const previousSources = value.scheduled.length;
  await value.drainRender();
  await seeking;
  assert.equal(value.scheduled[previousSources].frames, 11025);
  assert.equal(value.scheduled[previousSources].start, 0.26);
  assert.equal(value.state.underruns, 0);
  const beforeStall = value.state.renderedUntil;
  value.setTime(1);
  value.tick();
  await value.drainRender();
  assert.equal(value.state.underruns, 1, 'actual depletion after playback starts must remain visible');
  assert.ok(value.state.renderedUntil > beforeStall);
  assert.equal(value.scheduled[previousSources + 1].start, 1.03);
});

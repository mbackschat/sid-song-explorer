import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {ExplorerPlayer} from '../src/player.ts';
import type {PlayerState, TuneDetails} from '../src/player-types.ts';

interface PostedRequest { id: number; method: string; payload: Record<string, unknown>; cacheEpoch?: number }

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  requests: PostedRequest[] = [];
  terminated = false;

  constructor() { FakeWorker.instances.push(this); }
  postMessage(request: PostedRequest) { this.requests.push(request); }
  terminate() { this.terminated = true; }
  lastRequest(method: string): PostedRequest {
    const request = [...this.requests].reverse().find((value) => value.method === method);
    assert.ok(request, `Expected a ${method} request`);
    return request;
  }
  reply(request: PostedRequest, result: unknown) {
    this.onmessage?.({data: {id: request.id, result}} as MessageEvent);
  }
  reject(request: PostedRequest, error: string) {
    this.onmessage?.({data: {id: request.id, error}} as MessageEvent);
  }
  coverage(epoch: number, seconds: number) {
    this.onmessage?.({data: {event: 'cache', coverage: {epoch, startFrame: 0, endFrame: seconds * 44100}}} as MessageEvent);
  }
  fail(message: string) {
    this.onerror?.({message, preventDefault() {}} as ErrorEvent);
  }
}

const profile = {clock: 'PAL', model: 'MOS6581', subtune: 1, durationSeconds: 200} as const;
const details: TuneDetails = {
  title: 'Transport fixture', author: '', released: '', songs: 1, subtune: 1,
  clock: 'PAL', model: 'MOS6581', installedSids: 1, sampleRate: 44100,
  registers: Array<number>(32).fill(0),
};
const position = (seconds: number) => ({frame: Math.floor(seconds * 44100), registers: details.registers.slice()});

function fixture(t: TestContext) {
  const names = ['Worker', 'requestAnimationFrame', 'cancelAnimationFrame'] as const;
  const originals = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  FakeWorker.instances = [];
  Object.defineProperty(globalThis, 'Worker', {configurable: true, writable: true, value: FakeWorker});
  Object.defineProperty(globalThis, 'requestAnimationFrame', {configurable: true, writable: true, value: () => 1});
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {configurable: true, writable: true, value: () => {}});
  const player = new ExplorerPlayer();
  let state!: PlayerState;
  const unsubscribe = player.subscribe((value) => { state = value; });
  t.after(() => {
    unsubscribe();
    player.dispose();
    for (const [index, name] of names.entries()) {
      const descriptor = originals[index];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  return {player, get state() { return state; }};
}

async function loaded(t: TestContext) {
  const value = fixture(t);
  const loading = value.player.load(new Uint8Array([0]), profile);
  const worker = FakeWorker.instances.at(-1)!;
  worker.reply(worker.lastRequest('load'), details);
  await loading;
  assert.equal(worker.lastRequest('load').cacheEpoch, 1);
  return {value, worker};
}

async function flushReplies() {
  for (let index = 0; index < 4; index++) await Promise.resolve();
}

test('mute clears prepared audio and rejects coverage from the previous mix epoch', async (t) => {
  const {value, worker} = await loaded(t);
  worker.coverage(1, 180);
  assert.deepEqual(value.state.preparedRange, {start: 0, end: 180});
  const muting = value.player.setMuted([true, false, false]);
  assert.equal(value.state.pendingOperation, 'voice-mix');
  const immediately = value.state.preparedRange;
  worker.coverage(1, 180);
  const staleWhilePending = value.state.preparedRange;
  const muteRequest = worker.lastRequest('mute');
  worker.reply(muteRequest, position(0));
  await flushReplies();
  worker.reply(worker.lastRequest('seek'), position(0));
  await muting;
  worker.coverage(2, 30);
  const currentMix = value.state.preparedRange;
  worker.coverage(1, 180);
  const staleAfterCompletion = value.state.preparedRange;
  assert.equal(muteRequest.cacheEpoch, 2);
  assert.equal(immediately, null, 'changing the mix invalidates prepared audio immediately');
  assert.equal(staleWhilePending, null, 'old-mix background events must not restore invalidated coverage');
  assert.deepEqual(currentMix, {start: 0, end: 30});
  assert.deepEqual(staleAfterCompletion, currentMix, 'old-mix events remain stale after mute completes');
});

test('muting during a delayed seek preserves its requested destination', async (t) => {
  const {value, worker} = await loaded(t);
  const initialSeek = value.player.seek(1);
  worker.reply(worker.lastRequest('seek'), position(1));
  await initialSeek;
  const seeking = value.player.seek(180);
  assert.equal(value.state.pendingOperation, 'seek');
  const pendingSeek = worker.lastRequest('seek');
  const muting = value.player.setMuted([false, true, false]);
  worker.reply(pendingSeek, position(180));
  await seeking;
  assert.equal(value.state.pendingOperation, 'voice-mix', 'superseded seek must not clear newer voice feedback');
  worker.reply(worker.lastRequest('mute'), position(180));
  await flushReplies();
  const finalSeek = worker.lastRequest('seek');
  worker.reply(finalSeek, position(finalSeek.payload.seconds as number));
  await muting;
  assert.equal(worker.lastRequest('mute').cacheEpoch, 2);
  assert.equal(finalSeek.payload.seconds, 180);
  assert.equal(value.state.pendingOperation, null);
  assert.equal(value.state.position, 180);
  assert.deepEqual(value.state.muted, [false, true, false]);
  assert.equal(value.state.status, 'paused');
});

test('an idle worker failure reports immediately, rejects future work and permits a fresh load', async (t) => {
  const {value, worker} = await loaded(t);
  worker.coverage(1, 180);
  worker.fail('Injected idle worker failure');
  assert.equal(value.state.status, 'error');
  assert.match(value.state.error ?? '', /Injected idle worker failure/);
  assert.equal(value.state.preparedRange, null);
  assert.equal(worker.terminated, true);
  let rejection: unknown;
  const seeking = value.player.seek(1).catch((error: unknown) => { rejection = error; });
  await flushReplies();
  assert.ok(rejection instanceof Error, 'a terminated engine must reject without waiting for its request timeout');
  assert.match(rejection.message, /Injected idle worker failure/);
  assert.equal(worker.requests.filter((request) => request.method === 'seek').length, 0);
  await seeking;

  const reloading = value.player.load(new Uint8Array([0]), profile);
  const replacement = FakeWorker.instances.at(-1)!;
  assert.notEqual(replacement, worker);
  worker.coverage(1, 190);
  worker.fail('Late failure from replaced worker');
  assert.equal(value.state.status, 'loading');
  assert.equal(value.state.preparedRange, null);
  replacement.reply(replacement.lastRequest('load'), details);
  await reloading;
  assert.equal(replacement.lastRequest('load').cacheEpoch, 1);
  replacement.coverage(1, 30);
  assert.equal(value.state.status, 'ready');
  assert.equal(value.state.error, null);
  assert.deepEqual(value.state.preparedRange, {start: 0, end: 30});
});


test('a rejected mute leaves the next accepted mix coverage synchronized with its request epoch', async (t) => {
  const {value, worker} = await loaded(t);
  const rejectedMute = value.player.setMuted([true, false, false]);
  const rejectedRequest = worker.lastRequest('mute');
  const rejected = assert.rejects(rejectedMute, /queue is full/);
  worker.reject(rejectedRequest, 'Engine request queue is full');
  await rejected;
  assert.equal(value.state.pendingOperation, null, 'failure clears pending feedback');
  const acceptedMute = value.player.setMuted([false, true, false]);
  const acceptedRequest = worker.lastRequest('mute');
  worker.reply(acceptedRequest, position(0));
  await flushReplies();
  worker.reply(worker.lastRequest('seek'), position(0));
  await acceptedMute;
  assert.equal(rejectedRequest.cacheEpoch, 2);
  assert.equal(acceptedRequest.cacheEpoch, 3);
  worker.coverage(acceptedRequest.cacheEpoch!, 30);
  assert.deepEqual(value.state.preparedRange, {start: 0, end: 30});
  worker.coverage(rejectedRequest.cacheEpoch!, 180);
  assert.deepEqual(value.state.preparedRange, {start: 0, end: 30});
});

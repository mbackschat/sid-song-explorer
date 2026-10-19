import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {ExplorerPlayer} from '../src/player.ts';
import type {PlayerState, TimelineObservation, TuneDetails} from '../src/player-types.ts';

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
  const names = ['Worker', 'requestAnimationFrame', 'cancelAnimationFrame', 'setInterval', 'clearInterval'] as const;
  const originals = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  FakeWorker.instances = [];
  Object.defineProperty(globalThis, 'Worker', {configurable: true, writable: true, value: FakeWorker});
  Object.defineProperty(globalThis, 'requestAnimationFrame', {configurable: true, writable: true, value: () => 1});
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {configurable: true, writable: true, value: () => {}});
  let interval: (() => void) | undefined;
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  Object.defineProperty(globalThis, 'setInterval', {configurable: true, writable: true, value: (callback: () => void) => { interval = callback; return 1; }});
  Object.defineProperty(globalThis, 'clearInterval', {configurable: true, writable: true, value: () => { interval = undefined; }});
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
  return {player, get state() { return state; }, advance(milliseconds: number) { now += milliseconds; interval?.(); }};
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

const preview = (start: number, end: number): TimelineObservation => ({
  start, end, frames: [{time: start, registers: details.registers.slice()}, {time: end, registers: details.registers.slice()}], writes: [], dropped: 0,
});

test('preview requests use a centered bounded window while ready or paused and permit one throttled request', async (t) => {
  const {value, worker} = await loaded(t);
  const initial = worker.lastRequest('observe');
  assert.deepEqual(initial.payload, {startSeconds: 0, endSeconds: 6});
  value.advance(1000);
  worker.coverage(1, 30);
  assert.equal(worker.requests.filter((request) => request.method === 'observe').length, 1);
  worker.reply(initial, preview(0, 3));
  await flushReplies();
  assert.deepEqual(value.state.preview, preview(0, 3));
  const next = worker.lastRequest('observe');
  assert.notEqual(next.id, initial.id, 'prefetched observations refresh even before playing');
  worker.reply(next, preview(0, 6));
  await flushReplies();
  const count = worker.requests.filter((request) => request.method === 'observe').length;
  value.advance(249);
  assert.equal(worker.requests.filter((request) => request.method === 'observe').length, count);
  value.advance(1);
  assert.equal(worker.requests.filter((request) => request.method === 'observe').length, count + 1);
  worker.reply(worker.lastRequest('observe'), preview(0, 6));
  await flushReplies();
  const seeking = value.player.seek(198);
  assert.equal(value.state.preview, null);
  worker.reply(worker.lastRequest('seek'), position(198));
  await seeking;
  assert.equal(value.state.status, 'paused');
  const ending = worker.lastRequest('observe');
  assert.deepEqual(ending.payload, {startSeconds: 193, endSeconds: 200});
  worker.reply(ending, preview(193, 199));
  await flushReplies();
  assert.deepEqual(value.state.preview, preview(193, 199), 'partial prepared coverage remains explicit');
});

test('seeks and voice changes invalidate previews immediately and reject obsolete window responses', async (t) => {
  const {value, worker} = await loaded(t);
  const oldWindow = worker.lastRequest('observe');
  const seeking = value.player.seek(18);
  worker.reply(oldWindow, preview(0, 5));
  await flushReplies();
  assert.equal(value.state.preview, null);
  assert.equal(worker.lastRequest('observe').id, oldWindow.id, 'pending transport must not issue a preview');
  worker.reply(worker.lastRequest('seek'), position(18));
  await seeking;
  const seekWindow = worker.lastRequest('observe');
  assert.deepEqual(seekWindow.payload, {startSeconds: 13, endSeconds: 24});
  const muting = value.player.setMuted([true, false, false]);
  worker.reply(seekWindow, preview(13, 24));
  await flushReplies();
  assert.equal(value.state.preview, null);
  worker.reply(worker.lastRequest('mute'), position(18));
  await flushReplies();
  worker.reply(worker.lastRequest('seek'), position(18));
  await muting;
  const mixWindow = worker.lastRequest('observe');
  assert.notEqual(mixWindow.id, seekWindow.id);
  worker.reply(mixWindow, preview(13, 24));
  await flushReplies();
  assert.deepEqual(value.state.preview, preview(13, 24));
  const looping = value.player.setLoop({start: 10, end: 20});
  assert.equal(value.state.preview, null);
  worker.reply(worker.lastRequest('seek'), position(18));
  await looping;
  assert.deepEqual(worker.lastRequest('observe').payload, {startSeconds: 13, endSeconds: 20});
});

test('prepared previews cover the moving visible right edge through the refresh interval and RPC delay', async (t) => {
  const {value, worker} = await loaded(t);
  worker.reply(worker.lastRequest('observe'), preview(0, 6));
  await flushReplies();
  const seeking = value.player.seek(10);
  worker.reply(worker.lastRequest('seek'), position(10));
  await seeking;
  const initial = worker.lastRequest('observe');
  worker.reply(initial, preview(initial.payload.startSeconds as number, initial.payload.endSeconds as number));
  await flushReplies();
  value.state.position = 10.249;
  value.advance(249);
  assert.ok(value.state.preview!.end >= value.state.position + 5, 'the accepted snapshot covers the viewport before the next request');
  value.state.position = 10.25;
  value.advance(1);
  const refreshing = worker.lastRequest('observe');
  assert.notEqual(refreshing.id, initial.id);
  value.state.position = 10.35;
  value.advance(100);
  assert.ok(value.state.preview!.end >= value.state.position + 5, 'the previous snapshot covers the viewport during a 100ms worker round trip');
  worker.reply(refreshing, preview(refreshing.payload.startSeconds as number, refreshing.payload.endSeconds as number));
  await flushReplies();
  assert.ok(value.state.preview!.end >= value.state.position + 5);
  assert.equal(worker.requests.filter((request) => request.method === 'render').length, 0, 'observation refresh does not schedule audio');
});

test('replaced, failed and disposed sessions cannot restore preview responses', async (t) => {
  const {value, worker} = await loaded(t);
  const stale = worker.lastRequest('observe');
  const reloading = value.player.load(new Uint8Array([0]), profile);
  const replacement = FakeWorker.instances.at(-1)!;
  worker.reply(stale, preview(0, 5));
  await flushReplies();
  assert.equal(value.state.preview, null);
  replacement.reply(replacement.lastRequest('load'), details);
  await reloading;
  const active = replacement.lastRequest('observe');
  replacement.fail('observation worker failed');
  replacement.reply(active, preview(0, 5));
  await flushReplies();
  assert.equal(value.state.status, 'error');
  assert.equal(value.state.preview, null);
  const freshLoad = value.player.load(new Uint8Array([0]), profile);
  const fresh = FakeWorker.instances.at(-1)!;
  fresh.reply(fresh.lastRequest('load'), details);
  await freshLoad;
  const pending = fresh.lastRequest('observe');
  value.player.dispose();
  fresh.reply(pending, preview(0, 5));
  await flushReplies();
  assert.equal(value.state.preview, null);
});

test('an idle preview deadline reports the terminated worker instead of leaving a ready session', async (t) => {
  const deadlines = new Map<number, () => void>();
  let sequence = 0;
  t.mock.method(globalThis, 'setTimeout', (callback: () => void) => {
    const id = ++sequence;
    deadlines.set(id, callback);
    return id as unknown as ReturnType<typeof setTimeout>;
  });
  t.mock.method(globalThis, 'clearTimeout', (id: ReturnType<typeof setTimeout>) => { deadlines.delete(Number(id)); });
  const {value, worker} = await loaded(t);
  const observation = worker.lastRequest('observe');
  assert.equal(deadlines.size, 1, 'only the idle observation remains pending after load');
  deadlines.values().next().value!();
  assert.equal(worker.terminated, true);
  assert.equal(value.state.status, 'error');
  assert.match(value.state.error ?? '', /observe exceeded 30 seconds/);
  worker.reply(observation, preview(0, 5));
  await flushReplies();
  assert.equal(value.state.preview, null);
  assert.equal(deadlines.size, 0, 'fatal termination clears every pending deadline');
});

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

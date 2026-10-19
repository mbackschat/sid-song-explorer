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

test('timeline windows follow measured widths without changing transport or accepting invalid spans', async (t) => {
  const {value, worker} = await loaded(t);
  assert.equal(value.state.timelineWindowSeconds, 10);
  worker.reply(worker.lastRequest('observe'), preview(0, 6));
  await flushReplies();
  const sameWindowRequests = worker.requests.length;
  const sameWindowPreview = value.state.preview;
  value.player.setTimelineWindow(10);
  assert.equal(value.state.preview, sameWindowPreview);
  assert.equal(worker.requests.length, sameWindowRequests);
  const before = structuredClone(value.state);
  for (const invalid of [0, -1, NaN, Infinity, '10', null]) {
    assert.throws(() => value.player.setTimelineWindow(invalid as number), /finite|positive|window/i);
    assert.deepEqual(value.state, before);
    assert.equal(worker.requests.length, sameWindowRequests);
  }
  const seeking = value.player.seek(100);
  worker.reply(worker.lastRequest('seek'), position(100));
  await seeking;
  worker.reply(worker.lastRequest('observe'), preview(95, 106));
  await flushReplies();
  const transport = worker.requests.filter((request) => request.method !== 'observe');
  const playback = [value.state.position, value.state.renderedUntil, value.state.status, value.state.epoch];
  for (const seconds of [5, 10, 20, 37.5, 800]) {
    value.player.setTimelineWindow(seconds);
    value.advance(250);
    const request = worker.lastRequest('observe');
    assert.deepEqual(request.payload, {
      startSeconds: Math.max(0, 100 - seconds / 2),
      endSeconds: Math.min(200, 100 + seconds / 2 + 1),
    });
    assert.equal(value.state.timelineWindowSeconds, seconds);
    worker.reply(request, preview(request.payload.startSeconds as number, request.payload.endSeconds as number));
    await flushReplies();
    assert.deepEqual([value.state.position, value.state.renderedUntil, value.state.status, value.state.epoch], playback);
    assert.deepEqual(worker.requests.filter((request) => request.method !== 'observe'), transport);
  }
});

test('zoom keeps valid data while rejecting outdated responses and preserving the refresh throttle', async (t) => {
  const {value, worker} = await loaded(t);
  worker.reply(worker.lastRequest('observe'), preview(0, 6));
  await flushReplies();
  const accepted = value.state.preview;
  value.advance(250);
  const obsolete = worker.lastRequest('observe');
  const requestCount = worker.requests.length;
  value.player.setTimelineWindow(20);
  value.player.setTimelineWindow(37.5);
  assert.equal(value.state.preview, accepted, 'same-configuration data remains valid while the viewport changes');
  assert.equal(worker.requests.length, requestCount, 'zoom cannot add another in-flight request');
  worker.reply(obsolete, preview(0, 6));
  await flushReplies();
  assert.equal(value.state.preview, accepted, 'a response for an obsolete span cannot replace valid data');
  assert.equal(worker.requests.length, requestCount, 'resizing does not reset the refresh throttle');
  value.advance(249);
  assert.equal(worker.requests.length, requestCount);
  value.advance(1);
  const current = worker.lastRequest('observe');
  assert.deepEqual(current.payload, {startSeconds: 0, endSeconds: 19.75});
  worker.reply(current, preview(0, 19.75));
  await flushReplies();
  assert.deepEqual(value.state.preview, preview(0, 19.75));
});

test('zooming during a pending seek preserves its transport generation and requested destination', async (t) => {
  const {value, worker} = await loaded(t);
  const oldPreview = worker.lastRequest('observe');
  const seeking = value.player.seek(50);
  value.player.setTimelineWindow(20);
  worker.reply(oldPreview, preview(0, 6));
  await flushReplies();
  worker.reply(worker.lastRequest('seek'), position(50));
  await seeking;
  assert.equal(value.state.status, 'paused');
  assert.equal(value.state.pendingOperation, null);
  assert.equal(value.state.position, 50);
  assert.deepEqual(worker.lastRequest('observe').payload, {startSeconds: 40, endSeconds: 61});
});

test('timeline browsing changes prepared coverage without seeking, rendering or accepting invalid centers', async (t) => {
  const {value, worker} = await loaded(t);
  assert.equal(value.state.timelineCenterSeconds, null);
  worker.reply(worker.lastRequest('observe'), preview(0, 6));
  await flushReplies();
  const transport = worker.requests.filter((request) => request.method !== 'observe');
  const playback = [value.state.position, value.state.renderedUntil, value.state.status, value.state.epoch];
  for (const [center, start, end] of [[100, 90, 110], [0, 0, 10], [199, 189, 200]]) {
    value.player.setTimelineCenter(center);
    value.advance(250);
    const request = worker.lastRequest('observe');
    assert.deepEqual(request.payload, {startSeconds: start, endSeconds: end});
    assert.equal(value.state.timelineCenterSeconds, center);
    worker.reply(request, preview(start, end));
    await flushReplies();
    assert.deepEqual([value.state.position, value.state.renderedUntil, value.state.status, value.state.epoch], playback);
    assert.deepEqual(worker.requests.filter((request) => request.method !== 'observe'), transport);
  }
  const sameCenterRequests = worker.requests.length;
  const sameCenterPreview = value.state.preview;
  value.player.setTimelineCenter(199);
  assert.equal(worker.requests.length, sameCenterRequests);
  assert.equal(value.state.preview, sameCenterPreview);
  value.player.setTimelineCenter(600);
  assert.equal(value.state.timelineCenterSeconds, 600);
  const before = structuredClone(value.state);
  const beforeRequests = worker.requests.length;
  for (const invalid of [-1, 600.001, NaN, Infinity, '100', undefined]) {
    assert.throws(() => value.player.setTimelineCenter(invalid as number), /finite|center|600/i);
    assert.deepEqual(value.state, before);
    assert.equal(worker.requests.length, beforeRequests);
  }
});

test('browsing and Follow retain valid data while rejecting stale view replies through the refresh throttle', async (t) => {
  const {value, worker} = await loaded(t);
  worker.reply(worker.lastRequest('observe'), preview(0, 6));
  await flushReplies();
  const accepted = value.state.preview;
  value.advance(250);
  const obsoleteFollow = worker.lastRequest('observe');
  const requests = worker.requests.length;
  value.player.setTimelineCenter(60);
  value.player.setTimelineCenter(80);
  assert.equal(value.state.preview, accepted);
  assert.equal(worker.requests.length, requests);
  worker.reply(obsoleteFollow, preview(0, 6));
  await flushReplies();
  assert.equal(value.state.preview, accepted);
  value.advance(99);
  assert.equal(worker.requests.length, requests);
  value.advance(1);
  const obsoleteBrowse = worker.lastRequest('observe');
  assert.deepEqual(obsoleteBrowse.payload, {startSeconds: 70, endSeconds: 90});
  value.state.position = 3;
  value.player.setTimelineCenter(null);
  worker.reply(obsoleteBrowse, preview(70, 90));
  await flushReplies();
  assert.equal(value.state.preview, accepted);
  value.advance(250);
  const following = worker.lastRequest('observe');
  assert.deepEqual(following.payload, {startSeconds: 0, endSeconds: 9});
  worker.reply(following, preview(0, 9));
  await flushReplies();
  assert.equal(value.state.timelineCenterSeconds, null);
  assert.equal(value.state.position, 3);
  assert.deepEqual(value.state.preview, preview(0, 9));
});

test('browsing preserves pending seek and mute destinations and resets to heard-follow on load', async (t) => {
  const {value, worker} = await loaded(t);
  value.player.setTimelineCenter(75);
  const oldPreview = worker.lastRequest('observe');
  const seeking = value.player.seek(10);
  value.player.setTimelineCenter(80);
  worker.reply(oldPreview, preview(0, 6));
  await flushReplies();
  worker.reply(worker.lastRequest('seek'), position(10));
  await seeking;
  assert.equal(value.state.position, 10);
  assert.equal(value.state.status, 'paused');
  assert.equal(value.state.timelineCenterSeconds, 80);
  worker.reply(worker.lastRequest('observe'), preview(70, 90));
  await flushReplies();
  const muting = value.player.setMuted([true, false, false]);
  worker.reply(worker.lastRequest('mute'), position(10));
  await flushReplies();
  worker.reply(worker.lastRequest('seek'), position(10));
  await muting;
  assert.equal(value.state.position, 10);
  assert.equal(value.state.timelineCenterSeconds, 80);
  assert.deepEqual(worker.lastRequest('observe').payload, {startSeconds: 70, endSeconds: 90});
  const reloading = value.player.load(new Uint8Array([0]), profile);
  assert.equal(value.state.timelineCenterSeconds, null);
  const replacement = FakeWorker.instances.at(-1)!;
  replacement.reply(replacement.lastRequest('load'), details);
  await reloading;
  await flushReplies();
  assert.deepEqual(replacement.lastRequest('observe').payload, {startSeconds: 0, endSeconds: 6});
});

test('browsing can inspect prepared regions beyond loop B while following stays clipped', async (t) => {
  const {value, worker} = await loaded(t);
  worker.reply(worker.lastRequest('observe'), preview(0, 6));
  await flushReplies();
  const seeking = value.player.seek(18);
  worker.reply(worker.lastRequest('seek'), position(18));
  await seeking;
  worker.reply(worker.lastRequest('observe'), preview(13, 24));
  await flushReplies();
  const looping = value.player.setLoop({start: 10, end: 20});
  worker.reply(worker.lastRequest('seek'), position(18));
  await looping;
  assert.deepEqual(worker.lastRequest('observe').payload, {startSeconds: 13, endSeconds: 20});
  worker.reply(worker.lastRequest('observe'), preview(13, 20));
  await flushReplies();
  const transport = worker.requests.filter((request) => request.method !== 'observe');
  value.player.setTimelineCenter(40);
  value.advance(250);
  const browsing = worker.lastRequest('observe');
  assert.deepEqual(browsing.payload, {startSeconds: 30, endSeconds: 50});
  worker.reply(browsing, preview(30, 50));
  await flushReplies();
  value.player.setTimelineCenter(18);
  value.advance(100);
  const crossing = worker.lastRequest('observe');
  assert.deepEqual(crossing.payload, {startSeconds: 8, endSeconds: 28});
  value.player.setTimelineCenter(null);
  assert.equal(value.state.preview, null, 'following a loop discards accepted browse data extending beyond loop B');
  worker.reply(crossing, preview(8, 28));
  await flushReplies();
  assert.equal(value.state.preview, null, 'a pending browse reply cannot restore activity after loop B');
  value.advance(250);
  assert.deepEqual(worker.lastRequest('observe').payload, {startSeconds: 13, endSeconds: 20});
  assert.deepEqual(worker.requests.filter((request) => request.method !== 'observe'), transport);
  assert.deepEqual(value.state.loop, {start: 10, end: 20});
});

test('entering browsing reuses useful in-flight follow data while a padded request catches up', async (t) => {
  const {value, worker} = await loaded(t);
  worker.reply(worker.lastRequest('observe'), preview(0, 6));
  await flushReplies();
  const seeking = value.player.seek(20);
  worker.reply(worker.lastRequest('seek'), position(20));
  await seeking;
  const follow = worker.lastRequest('observe');
  assert.deepEqual(follow.payload, {startSeconds: 15, endSeconds: 26});
  const transport = worker.requests.filter((request) => request.method !== 'observe');
  value.player.setTimelineCenter(21);
  worker.reply(follow, preview(15, 26));
  await flushReplies();
  assert.deepEqual(value.state.preview, preview(15, 26));
  value.advance(100);
  const browsing = worker.lastRequest('observe');
  assert.deepEqual(browsing.payload, {startSeconds: 11, endSeconds: 31});
  value.player.setTimelineCenter(23);
  worker.reply(browsing, preview(11, 31));
  await flushReplies();
  assert.deepEqual(value.state.preview, preview(11, 31));
  assert.equal(value.state.position, 20);
  assert.deepEqual(worker.requests.filter((request) => request.method !== 'observe'), transport);
});

test('continuous browsing accepts useful pending coverage without waiting for dragging to stop', async (t) => {
  const {value, worker} = await loaded(t);
  worker.reply(worker.lastRequest('observe'), preview(0, 6));
  await flushReplies();
  const transport = worker.requests.filter((request) => request.method !== 'observe');
  value.player.setTimelineCenter(50);
  value.advance(100);
  const first = worker.lastRequest('observe');
  assert.deepEqual(first.payload, {startSeconds: 40, endSeconds: 60});
  for (const center of [51, 52, 53]) {
    value.player.setTimelineCenter(center);
    value.advance(20);
  }
  worker.reply(first, preview(40, 60));
  await flushReplies();
  assert.deepEqual(value.state.preview, preview(40, 60), 'same-configuration data that improves the moving viewport must remain usable');
  assert.ok(value.state.preview!.start <= 48 && value.state.preview!.end >= 58);
  value.player.setTimelineCenter(54);
  value.advance(39);
  assert.equal(worker.lastRequest('observe').id, first.id);
  value.player.setTimelineCenter(55);
  value.advance(1);
  const next = worker.lastRequest('observe');
  assert.deepEqual(next.payload, {startSeconds: 45, endSeconds: 65});
  for (const center of [56, 57, 58]) {
    value.player.setTimelineCenter(center);
    value.advance(20);
  }
  worker.reply(next, preview(45, 65));
  await flushReplies();
  assert.deepEqual(value.state.preview, preview(45, 65));
  assert.ok(value.state.preview!.start <= 53 && value.state.preview!.end >= 63);
  assert.deepEqual(worker.requests.filter((request) => request.method !== 'observe'), transport);
  assert.equal(value.state.position, 0);
});

test('obsolete browsing responses cannot replace current data with equal or smaller visible coverage', async (t) => {
  const {value, worker} = await loaded(t);
  worker.reply(worker.lastRequest('observe'), preview(0, 6));
  await flushReplies();
  value.player.setTimelineCenter(50);
  value.advance(100);
  worker.reply(worker.lastRequest('observe'), preview(45, 55));
  await flushReplies();
  const accepted = value.state.preview;
  assert.deepEqual(accepted, preview(45, 55));
  value.player.setTimelineCenter(52);
  value.advance(100);
  const lessCoverage = worker.lastRequest('observe');
  value.player.setTimelineCenter(53);
  worker.reply(lessCoverage, preview(48, 53));
  await flushReplies();
  assert.equal(value.state.preview, accepted);
  value.player.setTimelineCenter(54);
  value.advance(100);
  const equalCoverage = worker.lastRequest('observe');
  value.player.setTimelineCenter(55);
  worker.reply(equalCoverage, preview(50, 55));
  await flushReplies();
  assert.equal(value.state.preview, accepted);
});

test('continuous browsing refreshes at most ten times per second without changing follow timing', async (t) => {
  const {value, worker} = await loaded(t);
  worker.reply(worker.lastRequest('observe'), preview(0, 6));
  await flushReplies();
  let replied = worker.lastRequest('observe').id;
  const before = worker.requests.length;
  for (let index = 1; index <= 100; index++) {
    value.player.setTimelineCenter(50 + index / 10);
    value.advance(10);
    const request = worker.lastRequest('observe');
    if (request.id !== replied) {
      worker.reply(request, preview(request.payload.startSeconds as number, request.payload.endSeconds as number));
      replied = request.id;
      await flushReplies();
    }
  }
  const browseRequests = worker.requests.length - before;
  assert.equal(browseRequests, 10);
  value.player.setTimelineCenter(null);
  value.advance(249);
  assert.equal(worker.requests.length - before, browseRequests);
  value.advance(1);
  assert.equal(worker.requests.length - before, browseRequests + 1);
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

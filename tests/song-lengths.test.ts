import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SongLengthLookup, SONG_LENGTHS_URL} from '../src/song-lengths.ts';

function sid(clockBits = 1, songs = 2, startSong = 2, version = 2): Uint8Array {
  const bytes = new Uint8Array(128);
  bytes.set([80, 83, 73, 68]);
  const header = new DataView(bytes.buffer);
  for (const [offset, value] of [[4, version], [6, 124], [8, 0x1000], [10, 0x1000], [12, 0x1003], [14, songs], [16, startSong]]) header.setUint16(offset, value);
  header.setUint16(118, clockBits << 2);
  bytes.set([0x60, 0xea, 0xea, 0x60], 124);
  return bytes;
}

function database(bytes: Uint8Array, times = '1:02.5 0:03.125'): string {
  const md5 = createHash('md5').update(bytes).digest('hex');
  return `[Database]\r\n; /MUSICIANS/E/Example.sid\r\n${md5}=${times}\r\n`;
}

test('the default fetch keeps the global receiver required by browsers', async t => {
  const bytes = sid();
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async function (this: unknown) {
    assert.equal(this, globalThis);
    requests++;
    return new Response(database(bytes));
  });
  const lookup = new SongLengthLookup();
  assert.equal(await lookup.lookup(bytes, 1, 'PAL'), 62.5);
  assert.equal(requests, 1);
});

test('original full-file MD5 identifies each subtune without changing its default-song header', async () => {
  const original = sid();
  const before = original.slice();
  const backing = new Uint8Array(original.length + 14);
  backing.set(original, 7);
  const bytes = backing.subarray(7, 7 + original.length);
  let requests = 0;
  const lookup = new SongLengthLookup(async (input, init) => {
    requests++;
    assert.equal(input, 'https://hvsc.c64.org/download/C64Music/DOCUMENTS/Songlengths.md5');
    assert.equal(input, SONG_LENGTHS_URL);
    assert.equal(init?.credentials, 'omit');
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(new URL(String(input)).search, '');
    return new Response(database(original));
  });
  assert.equal(requests, 0);
  assert.equal(await lookup.lookup(bytes, 1, 'PAL'), 62.5);
  assert.equal(await lookup.lookup(bytes, 2, 'PAL'), 3.125);
  assert.deepEqual(bytes, before);
  assert.equal(requests, 1);
  const changedHeader = bytes.slice();
  changedHeader[22] = 1;
  assert.equal(await lookup.lookup(changedHeader, 1, 'PAL'), null);
  assert.equal(requests, 1);
});

test('concurrent lookups share one fetch and keep the successful database', async () => {
  const bytes = sid();
  let requests = 0;
  let respond!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { respond = resolve; });
  const lookup = new SongLengthLookup(async () => { requests++; return response; });
  const first = lookup.lookup(bytes, 1, 'PAL');
  const second = lookup.lookup(bytes, 2, 'PAL');
  assert.equal(requests, 1);
  respond(new Response(database(bytes)));
  assert.deepEqual(await Promise.all([first, second]), [62.5, 3.125]);
  assert.equal(await lookup.lookup(bytes, 1, 'PAL'), 62.5);
  assert.equal(requests, 1);
});

test('incompatible clocks and invalid subtunes do not fetch the database', async () => {
  let requests = 0;
  const lookup = new SongLengthLookup(async () => { requests++; return new Response('[Database]'); });
  for (const clockBits of [0, 1, 3]) assert.equal(await lookup.lookup(sid(clockBits), 1, 'NTSC'), null);
  assert.equal(await lookup.lookup(sid(2), 1, 'PAL'), null);
  for (const subtune of [-1, 0, 1.5, NaN, Infinity, 3]) assert.equal(await lookup.lookup(sid(), subtune, 'PAL'), null);
  assert.equal(await lookup.lookup(new Uint8Array(0), 1, 'PAL'), null);
  assert.equal(requests, 0);
});

test('NTSC-specific files and PAL defaults use their matching header clock', async () => {
  for (const [clockBits, clock] of [[0, 'PAL'], [1, 'PAL'], [2, 'NTSC'], [3, 'PAL']] as const) {
    const bytes = sid(clockBits);
    const lookup = new SongLengthLookup(async () => new Response(database(bytes)));
    assert.equal(await lookup.lookup(bytes, 1, clock), 62.5);
  }
  const versionOne = sid(2, 2, 2, 1);
  const lookup = new SongLengthLookup(async () => new Response(database(versionOne)));
  assert.equal(await lookup.lookup(versionOne, 1, 'PAL'), 62.5);
});

test('unknown, zero and unsupported lengths remain unknown instead of being clamped', async () => {
  const bytes = sid(1, 5);
  const lookup = new SongLengthLookup(async () => new Response(database(bytes, '0:00 10:00.001 10:00 0:00.5')));
  assert.deepEqual(await Promise.all([1, 2, 3, 4, 5].map(subtune => lookup.lookup(bytes, subtune, 'PAL'))), [null, null, 600, 0.5, null]);
});

test('failed responses are not cached and only another explicit lookup retries', async () => {
  const bytes = sid();
  for (const failure of [
    () => { throw new Error('offline'); },
    () => new Response('unavailable', {status: 503}),
    () => new Response('<html>unavailable</html>'),
    () => new Response('[Database]\nnot a usable entry'),
    () => new Response(database(bytes).replace('[Database]', '[Other]')),
  ]) {
    let requests = 0;
    const lookup = new SongLengthLookup(async () => {
      requests++;
      return requests === 1 ? failure() : new Response(database(bytes));
    });
    assert.deepEqual(await Promise.all([lookup.lookup(bytes, 1, 'PAL'), lookup.lookup(bytes, 2, 'PAL')]), [null, null]);
    assert.equal(requests, 1);
    assert.equal(await lookup.lookup(bytes, 1, 'PAL'), 62.5);
    assert.equal(requests, 2);
  }
});

test('the fixed fetch deadline aborts rather than reporting a length', async t => {
  const controller = new AbortController();
  let timeoutMs = 0;
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    timeoutMs = milliseconds;
    return controller.signal;
  });
  const lookup = new SongLengthLookup(async (_, init) => new Promise<Response>((_, reject) => {
    init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), {once: true});
  }));
  const pending = lookup.lookup(sid(), 1, 'PAL');
  assert.equal(timeoutMs, 8000);
  controller.abort(new DOMException('Deadline reached', 'TimeoutError'));
  assert.equal(await pending, null);
});

test('a stalled response body is cancelled at the deadline without awaiting cancellation', async t => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', () => controller.signal);
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() { cancelled = true; return new Promise<void>(() => {}); },
  });
  const lookup = new SongLengthLookup(async () => new Response(body));
  const pending = lookup.lookup(sid(), 1, 'PAL');
  await Promise.resolve();
  controller.abort();
  assert.equal(await pending, null);
  assert.equal(cancelled, true);
});

test('an oversized streamed body is cancelled even without a Content-Length header', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); },
    cancel() { cancelled = true; return new Promise<void>(() => {}); },
  });
  const lookup = new SongLengthLookup(async () => new Response(body));
  assert.equal(await lookup.lookup(sid(), 1, 'PAL'), null);
  assert.equal(cancelled, true);
});

test('invalid UTF-8 cancels the unfinished body instead of retaining its download', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array([0xff])); },
    cancel() { cancelled = true; },
  });
  const lookup = new SongLengthLookup(async () => new Response(body));
  assert.equal(await lookup.lookup(sid(), 1, 'PAL'), null);
  assert.equal(cancelled, true);
});

test('an oversized declared body is cancelled before downloading', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({cancel() { cancelled = true; }});
  const lookup = new SongLengthLookup(async () => new Response(body, {headers: {'content-length': String(8 * 1024 * 1024 + 1)}}));
  assert.equal(await lookup.lookup(sid(), 1, 'PAL'), null);
  assert.equal(cancelled, true);
});

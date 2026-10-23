import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalHvscPath, fetchHvscSong, hvscSongUrl} from '../src/hvsc-download.ts';

const song = {path: 'MUSICIANS/E/Example/Tune.sid', title: 'Tune'};

test('HVSC paths share one identity with or without the C64Music prefix', () => {
  assert.equal(canonicalHvscPath(song.path), song.path);
  assert.equal(canonicalHvscPath(`C64Music/${song.path}`), song.path);
  assert.equal(canonicalHvscPath('DEMOS/Example.SID'), 'DEMOS/Example.SID');
});

test('download URLs encode HVSC path segments on the fixed official origin', () => {
  assert.equal(hvscSongUrl({path: `C64Music/${song.path}`}), 'https://www.hvsc.c64.org/download/C64Music/MUSICIANS/E/Example/Tune.sid');
  assert.equal(hvscSongUrl({path: 'MUSICIANS/Ö örni/A #?%.sid'}), 'https://www.hvsc.c64.org/download/C64Music/MUSICIANS/%C3%96%20%C3%B6rni/A%20%23%3F%25.sid');
  assert.equal(hvscSongUrl({path: 'MUSICIANS/Example/A:B.sid'}), 'https://www.hvsc.c64.org/download/C64Music/MUSICIANS/Example/A%3AB.sid');
});

for (const path of [
  '', '/', '/Tune.sid', '//example.test/Tune.sid', 'https://example.test/Tune.sid', 'C:\\Tune.sid',
  'Tune.mp3', 'Tune.sid/Other', 'MUSICIANS//Tune.sid', './Tune.sid', '../Tune.sid',
  'MUSICIANS/../Tune.sid', 'MUSICIANS/./Tune.sid', 'MUSICIANS\\Tune.sid', 'MUSICIANS/\u0000Tune.sid',
  'MUSICIANS/%2e%2e/Tune.sid', 'MUSICIANS/%2ETune/../Tune.sid', 'MUSICIANS/%2f/Tune.sid', 'MUSICIANS/%5c/Tune.sid',
  'MUSICIANS/\ud800/Tune.sid',
]) {
  test(`unsafe or non-SID path ${JSON.stringify(path)} is rejected before requesting`, async () => {
    assert.equal(canonicalHvscPath(path), null);
    let requested = false;
    await assert.rejects(fetchHvscSong({...song, path}, async () => { requested = true; return new Response(); }), /HVSC.*path|path.*HVSC/i);
    assert.equal(requested, false);
  });
}

test('generic downloads retain SID bytes without applying a highlight profile', async () => {
  const bytes = new Uint8Array([82, 83, 73, 68, 0, 2, 0, 124]);
  assert.deepEqual(await fetchHvscSong(song, async (url, init) => {
    assert.equal(url, 'https://www.hvsc.c64.org/download/C64Music/MUSICIANS/E/Example/Tune.sid');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.referrerPolicy, 'no-referrer');
    assert.ok(init?.signal instanceof AbortSignal);
    return new Response(bytes);
  }), bytes);
});

test('the default downloader retains the browser fetch receiver', async t => {
  t.mock.method(globalThis, 'fetch', async function (this: unknown) {
    assert.equal(this, globalThis);
    return new Response(new Uint8Array([1, 2]));
  });
  assert.deepEqual(await fetchHvscSong(song), new Uint8Array([1, 2]));
});

test('the exact 65,662-byte streamed limit is accepted', async () => {
  const expected = new Uint8Array(65_662).fill(7);
  const body = new ReadableStream<Uint8Array>({start(controller) {
    controller.enqueue(expected.subarray(0, 123));
    controller.enqueue(expected.subarray(123));
    controller.close();
  }});
  assert.deepEqual(await fetchHvscSong(song, async () => new Response(body)), expected);
});

for (const contentLength of [undefined, '128', '65663']) {
  test(`oversized downloads are cancelled with declared length ${contentLength ?? 'absent'}`, async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(65_663)); },
      cancel() { cancelled = true; return new Promise<void>(() => {}); },
    });
    const headers = contentLength ? {'content-length': contentLength} : undefined;
    await assert.rejects(fetchHvscSong(song, async () => new Response(body, {headers})), /65.?662|size|large/i);
    assert.equal(cancelled, true);
  });
}

test('HTTP failures identify the song and cancel unfinished bodies', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({cancel() { cancelled = true; }});
  await assert.rejects(fetchHvscSong(song, async () => new Response(body, {status: 503, statusText: 'Unavailable'})), /Tune.*503.*Unavailable/);
  assert.equal(cancelled, true);
});

test('missing bodies produce an explicit failure', async () => {
  await assert.rejects(fetchHvscSong(song, async () => new Response(null)), /empty.*body/i);
});

test('the fifteen-second deadline aborts a stalled fetch', async t => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    assert.equal(milliseconds, 15_000);
    return controller.signal;
  });
  const pending = fetchHvscSong(song, async (_, init) => new Promise<Response>((_, reject) => {
    init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), {once: true});
  }));
  const rejected = assert.rejects(pending, /deadline/i);
  controller.abort(new DOMException('Download deadline reached', 'TimeoutError'));
  await rejected;
});

test('an elapsed deadline cancels a stalled body without awaiting cancellation', async t => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', () => controller.signal);
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({cancel() { cancelled = true; return new Promise<void>(() => {}); }});
  const pending = fetchHvscSong(song, async () => new Response(body));
  const rejected = assert.rejects(pending, /deadline/i);
  await Promise.resolve();
  controller.abort(new DOMException('Download deadline reached', 'TimeoutError'));
  await rejected;
  assert.equal(cancelled, true);
});

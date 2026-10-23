import test from 'node:test';
import assert from 'node:assert/strict';
import {SID_HIGHLIGHTS, highlightUrl, fetchHighlight, type SidHighlight} from '../src/sid-highlights.ts';

const highlights: SidHighlight[] = [
  {id: 'h-Ch6K1h', title: 'Axel F.', author: 'Chris Hülsbeck', path: 'MUSICIANS/H/Huelsbeck_Chris/Axel_F.sid', model: 'MOS6581', chips: 1},
  {id: 'QfM49EtP', title: 'Cybernoid II', author: 'Jeroen Tel', path: 'MUSICIANS/T/Tel_Jeroen/Cybernoid_II.sid', model: 'MOS6581', chips: 1},
  {id: 'UpU3jayw', title: 'Commando', author: 'Rob Hubbard', path: 'MUSICIANS/H/Hubbard_Rob/Commando.sid', model: 'MOS6581', chips: 1},
  {id: 'UopzMIF-', title: 'Monty on the Run', author: 'Rob Hubbard', path: 'MUSICIANS/H/Hubbard_Rob/Monty_on_the_Run.sid', model: 'MOS6581', chips: 1},
  {id: 'XGpHOfuE', title: 'Ghostbusters', author: 'Benjamin Dibbert (Nordischsound)', path: 'MUSICIANS/N/Nordischsound/Ghostbusters.sid', model: 'MOS8580', chips: 1},
  {id: 'gNRPKidk', title: 'Pink Panther', author: 'Thomas E. Petersen (Laxity)', path: 'MUSICIANS/L/Laxity/Pink_Panther.sid', model: 'MOS6581', chips: 1},
  {id: 'GBRDw0sq', title: 'Sleepwalk', author: 'Lasse Öörni (Cadaver)', path: 'MUSICIANS/C/Cadaver/Sleepwalk_2SID.sid', model: 'MOS6581', chips: 2},
  {id: 'ApA9_eLG', title: 'Phonky', author: 'Mihály Horváth (Hermit)', path: 'MUSICIANS/H/Hermit/Phonky_2SID.sid', model: 'MOS8580', chips: 2},
  {id: 'LOKaOUbV', title: 'R-Type: Amiga to 2SID', author: 'Jason Page', path: 'MUSICIANS/P/Page_Jason/R-Type_Amiga_to_2SID_2SID.sid', model: 'MOS8580', chips: 2},
  {id: '4D2HfMg6', title: 'Zoids 2SID-Remake', author: 'Sami Louko (Proton)', path: 'MUSICIANS/P/Proton/Zoids_2SID-Remake_2SID.sid', model: 'MOS8580', chips: 2},
];

function sid(entry: SidHighlight, size = 128): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  bytes.set([80, 83, 73, 68]);
  const header = new DataView(bytes.buffer);
  header.setUint16(4, entry.chips === 2 ? 3 : 2);
  header.setUint16(6, 124);
  const modelBits = entry.model === 'MOS6581' ? 1 : 2;
  header.setUint16(118, 4 | modelBits << 4 | (entry.chips === 2 ? modelBits << 6 : 0));
  bytes[122] = entry.chips === 2 ? 0x42 : 0;
  return bytes;
}

test('the static highlights preserve the ten verified files and their advertised profiles', () => {
  assert.deepEqual(SID_HIGHLIGHTS, highlights);
  assert.equal(new Set(SID_HIGHLIGHTS.map(entry => entry.id)).size, 10);
  assert.equal(SID_HIGHLIGHTS.filter(entry => entry.chips === 2).length, 4);
  assert.deepEqual([...new Set(SID_HIGHLIGHTS.map(entry => entry.model))].sort(), ['MOS6581', 'MOS8580']);
  assert.equal(SID_HIGHLIGHTS.some(entry => /rambo/i.test(entry.path)), false);
});

test('highlight URLs use the official HVSC origin and encode each path segment', () => {
  assert.equal(highlightUrl(highlights[0]), 'https://www.hvsc.c64.org/download/C64Music/MUSICIANS/H/Huelsbeck_Chris/Axel_F.sid');
  assert.equal(highlightUrl({...highlights[0], path: 'MUSICIANS/Ö örni/A #?%.sid'}), 'https://www.hvsc.c64.org/download/C64Music/MUSICIANS/%C3%96%20%C3%B6rni/A%20%23%3F%25.sid');
});

test('default fetch retains its browser global receiver', async t => {
  t.mock.method(globalThis, 'fetch', async function (this: unknown) {
    assert.equal(this, globalThis);
    return new Response(sid(highlights[0]));
  });
  assert.deepEqual(await fetchHighlight(highlights[0]), sid(highlights[0]));
});

test('every advertised profile can be downloaded without credentials or a referrer', async () => {
  for (const entry of highlights) {
    const expected = sid(entry);
    const actual = await fetchHighlight(entry, async (url, init) => {
      assert.equal(url, highlightUrl(entry));
      assert.equal(init?.credentials, 'omit');
      assert.equal(init?.referrerPolicy, 'no-referrer');
      assert.ok(init?.signal instanceof AbortSignal);
      return new Response(expected);
    });
    assert.deepEqual(actual, expected);
  }
});

test('chunked downloads accept the exact size limit', async () => {
  const bytes = sid(highlights[0], 65_662);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 63));
      controller.enqueue(bytes.subarray(63, 124));
      controller.enqueue(bytes.subarray(124));
      controller.close();
    },
  });
  assert.deepEqual(await fetchHighlight(highlights[0], async () => new Response(body)), bytes);
});

test('failed HTTP responses include the status and cancel the unfinished download', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({cancel() { cancelled = true; }});
  await assert.rejects(fetchHighlight(highlights[0], async () => new Response(body, {status: 503, statusText: 'Service Unavailable'})), /503.*Service Unavailable/);
  assert.equal(cancelled, true);
});

test('a missing response body produces a useful failure', async () => {
  await assert.rejects(fetchHighlight(highlights[0], async () => new Response(null)), /empty|body/i);
});

test('an oversized declared download is cancelled before reading', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({cancel() { cancelled = true; return new Promise<void>(() => {}); }});
  await assert.rejects(fetchHighlight(highlights[0], async () => new Response(body, {headers: {'content-length': '65663'}})), /65.?662|size|large/i);
  assert.equal(cancelled, true);
});

for (const declaredLength of [undefined, '128']) {
  test(`an oversized stream is cancelled with Content-Length ${declaredLength ?? 'absent'}`, async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(65_663)); },
      cancel() { cancelled = true; return new Promise<void>(() => {}); },
    });
    const headers = declaredLength ? {'content-length': declaredLength} : undefined;
    await assert.rejects(fetchHighlight(highlights[0], async () => new Response(body, {headers})), /65.?662|size|large/i);
    assert.equal(cancelled, true);
  });
}

test('the fixed fifteen-second deadline aborts a stalled request', async t => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    assert.equal(milliseconds, 15_000);
    return controller.signal;
  });
  const pending = fetchHighlight(highlights[0], async (_, init) => new Promise<Response>((_, reject) => {
    init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), {once: true});
  }));
  const rejected = assert.rejects(pending, /deadline/i);
  controller.abort(new DOMException('Download deadline reached', 'TimeoutError'));
  await rejected;
});

test('the deadline cancels a stalled response body without awaiting its cancellation', async t => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', () => controller.signal);
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({cancel() { cancelled = true; return new Promise<void>(() => {}); }});
  const pending = fetchHighlight(highlights[0], async () => new Response(body));
  const rejected = assert.rejects(pending, /deadline/i);
  await Promise.resolve();
  controller.abort(new DOMException('Download deadline reached', 'TimeoutError'));
  await rejected;
  assert.equal(cancelled, true);
});

test('an already elapsed deadline cancels the body before attempting to read', async t => {
  const controller = new AbortController();
  controller.abort(new DOMException('Download deadline reached', 'TimeoutError'));
  t.mock.method(AbortSignal, 'timeout', () => controller.signal);
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({cancel() { cancelled = true; }});
  await assert.rejects(fetchHighlight(highlights[0], async () => new Response(body)), /deadline/i);
  assert.equal(cancelled, true);
});

const invalidProfiles: [string, (bytes: Uint8Array) => void][] = [
  ['truncated header', bytes => bytes.fill(0)],
  ['RSID', bytes => { bytes[0] = 82; }],
  ['version one without model declarations', bytes => { bytes[5] = 1; }],
  ['unsupported version', bytes => { bytes[5] = 5; }],
  ['unknown clock', bytes => { bytes[119] &= ~12; }],
  ['NTSC clock', bytes => { bytes[119] = (bytes[119] & ~12) | 8; }],
  ['either clock', bytes => { bytes[119] |= 12; }],
  ['unknown first model', bytes => { bytes[119] &= ~48; }],
  ['wrong first model', bytes => { bytes[119] = (bytes[119] & ~48) | 32; }],
  ['either first model', bytes => { bytes[119] |= 48; }],
  ['unexpected third chip', bytes => { bytes[5] = 4; bytes[123] = 0x44; }],
];
for (const [name, alter] of invalidProfiles) {
  test(`a downloaded ${name} cannot acquire the highlight's labels`, async () => {
    const bytes = sid(highlights[0]);
    alter(bytes);
    await assert.rejects(fetchHighlight(highlights[0], async () => new Response(bytes)), /PSID|PAL|model|chip|header/i);
  });
}

test('a truncated extended PSID header is rejected', async () => {
  await assert.rejects(fetchHighlight(highlights[0], async () => new Response(sid(highlights[0]).subarray(0, 123))), /header|PSID/i);
});

test('mono and dual-SID downloads must match the advertised chip count', async () => {
  await assert.rejects(fetchHighlight(highlights[0], async () => new Response(sid(highlights[6]))), /chip/i);
  await assert.rejects(fetchHighlight(highlights[6], async () => new Response(sid(highlights[0]))), /chip/i);
});

test('both declared models of a dual-SID download must match the label', async () => {
  for (const modelBits of [0, 1, 3]) {
    const bytes = sid(highlights[7]);
    bytes[119] = (bytes[119] & ~192) | modelBits << 6;
    await assert.rejects(fetchHighlight(highlights[7], async () => new Response(bytes)), /model/i);
  }
});

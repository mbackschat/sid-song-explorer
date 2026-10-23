export interface SidHighlight {
  id: string;
  title: string;
  author: string;
  path: string;
  model: 'MOS6581' | 'MOS8580';
  chips: 1 | 2;
}

export const SID_HIGHLIGHTS: readonly SidHighlight[] = [
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

const MAX_SID_BYTES = 65_662;

export function highlightUrl(entry: SidHighlight): string {
  return `https://www.hvsc.c64.org/download/C64Music/${entry.path.split('/').map(encodeURIComponent).join('/')}`;
}

function cancelStream(stream: ReadableStream<Uint8Array> | ReadableStreamDefaultReader<Uint8Array>): void {
  void stream.cancel().catch(() => {});
}

async function readSid(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<Uint8Array> {
  const reader = body.getReader();
  const cancel = () => cancelStream(reader);
  const bytes = new Uint8Array(MAX_SID_BYTES);
  let size = 0;
  signal.addEventListener('abort', cancel, {once: true});
  try {
    signal.throwIfAborted();
    while (true) {
      const {done, value} = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      if (value.byteLength > MAX_SID_BYTES - size) throw new Error(`The SID download exceeds ${MAX_SID_BYTES.toLocaleString('en-US')} bytes.`);
      bytes.set(value, size);
      size += value.byteLength;
    }
    return bytes.slice(0, size);
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

function checkProfile(bytes: Uint8Array, entry: SidHighlight): void {
  if (bytes.byteLength < 124 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'PSID') {
    throw new Error('The highlight download is not a complete PSID header.');
  }
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = header.getUint16(4);
  if (version < 2 || version > 4) throw new Error('The highlight requires a PSID version 2–4 header with explicit clock and model declarations.');
  const chips = version >= 3 && bytes[122] ? 2 : 1;
  if (bytes[123] || chips !== entry.chips) throw new Error(`The highlight download does not declare the expected ${entry.chips} SID chip${entry.chips === 1 ? '' : 's'}.`);
  const flags = header.getUint16(118);
  if (((flags >> 2) & 3) !== 1) throw new Error('The highlight download does not declare the expected PAL clock.');
  const modelBits = entry.model === 'MOS6581' ? 1 : 2;
  if (((flags >> 4) & 3) !== modelBits || entry.chips === 2 && ((flags >> 6) & 3) !== modelBits) {
    throw new Error(`The highlight download does not declare the expected ${entry.model} model for every chip.`);
  }
}

export async function fetchHighlight(entry: SidHighlight, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(15_000);
  const response = await fetcher(highlightUrl(entry), {credentials: 'omit', referrerPolicy: 'no-referrer', signal});
  if (!response.ok) {
    if (response.body) cancelStream(response.body);
    throw new Error(`Could not download ${entry.title} from HVSC: HTTP ${response.status} ${response.statusText}.`);
  }
  if (!response.body) throw new Error('HVSC returned an empty SID response body.');
  if (Number(response.headers.get('content-length')) > MAX_SID_BYTES) {
    cancelStream(response.body);
    throw new Error(`The SID download exceeds ${MAX_SID_BYTES.toLocaleString('en-US')} bytes.`);
  }
  const bytes = await readSid(response.body, signal);
  checkProfile(bytes, entry);
  return bytes;
}

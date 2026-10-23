const MAX_SID_BYTES = 65_662;

export function canonicalHvscPath(path: string): string | null {
  if (path.length > 2048 || /^[a-z][a-z0-9+.-]*:/i.test(path) || /[\\\p{Cc}\p{Cs}]/u.test(path)) return null;
  const relative = path.startsWith('C64Music/') ? path.slice('C64Music/'.length) : path;
  const segments = relative.split('/');
  if (!/\.sid$/i.test(relative) || segments.some(segment => !segment || segment === '.' || segment === '..')) return null;
  for (const segment of segments) {
    const decoded = segment.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
    if (decoded === '.' || decoded === '..' || /[/\\\p{Cc}]/u.test(decoded)) return null;
  }
  return relative;
}

export function hvscSongUrl(song: {path: string}): string {
  const path = canonicalHvscPath(song.path);
  if (!path) throw new Error('The song does not have a safe relative HVSC SID path.');
  return `https://www.hvsc.c64.org/download/C64Music/${path.split('/').map(encodeURIComponent).join('/')}`;
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

export async function fetchHvscSong(song: {path: string; title: string}, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<Uint8Array> {
  const url = hvscSongUrl(song);
  const signal = AbortSignal.timeout(15_000);
  const response = await fetcher(url, {credentials: 'omit', referrerPolicy: 'no-referrer', signal});
  if (!response.ok) {
    if (response.body) cancelStream(response.body);
    throw new Error(`Could not download ${song.title} from HVSC: HTTP ${response.status} ${response.statusText}.`);
  }
  if (!response.body) throw new Error('HVSC returned an empty SID response body.');
  if (Number(response.headers.get('content-length')) > MAX_SID_BYTES) {
    cancelStream(response.body);
    throw new Error(`The SID download exceeds ${MAX_SID_BYTES.toLocaleString('en-US')} bytes.`);
  }
  return readSid(response.body, signal);
}

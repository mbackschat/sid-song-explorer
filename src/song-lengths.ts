import {md5} from '@noble/hashes/legacy.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {SonglengthDatabase} from 'libsidplayfp-wasm/dist/songlengths.js';

export const SONG_LENGTHS_URL = 'https://hvsc.c64.org/download/C64Music/DOCUMENTS/Songlengths.md5';
const MAX_DATABASE_BYTES = 8 * 1024 * 1024;

function cancelStream(stream: ReadableStream<Uint8Array> | ReadableStreamDefaultReader<Uint8Array>) {
  void stream.cancel().catch(() => {});
}

async function readDatabase(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<string | null> {
  const reader = body.getReader();
  const cancel = () => cancelStream(reader);
  const decoder = new TextDecoder('utf-8', {fatal: true});
  const parts: string[] = [];
  let size = 0;
  signal.addEventListener('abort', cancel, {once: true});
  try {
    if (signal.aborted) { cancel(); return null; }
    while (true) {
      const {done, value} = await reader.read();
      if (signal.aborted) return null;
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DATABASE_BYTES) { cancel(); return null; }
      parts.push(decoder.decode(value, {stream: true}));
    }
    parts.push(decoder.decode());
    return parts.join('');
  } catch {
    cancel();
    return null;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

/** Resolves HVSC reference durations using original SID bytes and their expected clock. */
export class SongLengthLookup {
  private readonly fetcher: typeof fetch;
  private database: Promise<SonglengthDatabase | null> | null = null;

  constructor(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.fetcher = fetcher;
  }

  /**
   * Returns seconds for a 1-based subtune, or null when unavailable or unsupported.
   *
   * Explorer's playback boundary is ten minutes, so longer HVSC durations remain
   * unknown rather than becoming a truncated claim about the tune's ending.
   */
  async lookup(bytes: Uint8Array, subtune: number, clock: 'PAL' | 'NTSC'): Promise<number | null> {
    if (bytes.byteLength < 118 || !Number.isInteger(subtune) || subtune < 1) return null;
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = header.getUint16(4);
    if (version >= 2 && bytes.byteLength < 120 || subtune > header.getUint16(14)) return null;
    const flags = version >= 2 ? header.getUint16(118) : 0;
    if (clock !== (((flags >> 2) & 3) === 2 ? 'NTSC' : 'PAL')) return null;

    // HVSC Songlengths.faq includes the original header in its MD5; createState rewrites the start song.
    const hash = bytesToHex(md5(bytes));
    const database = await this.getDatabase();
    const seconds = database?.lengthSeconds(hash, subtune);
    return seconds !== null && seconds !== undefined && Number.isFinite(seconds) && seconds > 0 && seconds <= 600 ? seconds : null;
  }

  private getDatabase(): Promise<SonglengthDatabase | null> {
    if (!this.database) {
      const pending = this.fetchDatabase();
      this.database = pending;
      void pending.then(database => {
        if (!database && this.database === pending) this.database = null;
      });
    }
    return this.database;
  }

  private async fetchDatabase(): Promise<SonglengthDatabase | null> {
    try {
      const signal = AbortSignal.timeout(8000);
      const response = await this.fetcher(SONG_LENGTHS_URL, {credentials: 'omit', referrerPolicy: 'no-referrer', signal});
      if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_DATABASE_BYTES) {
        if (response.body) cancelStream(response.body);
        return null;
      }
      const text = await readDatabase(response.body, signal);
      if (text === null || !/^\s*\[Database\][ \t]*(?:\r?\n|$)/.test(text)) return null;
      const database = SonglengthDatabase.parse(text);
      return database.size > 0 ? database : null;
    } catch {
      return null;
    }
  }
}

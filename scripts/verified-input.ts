import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';

export type VerifiedInput = { filename: string; url: string; bytes: number; sha256: string };
type DownloadOptions = { maxBytes: number; fetcher?: typeof fetch; timeoutMs?: number };

function checkSize(file: VerifiedInput, maximum: number): void {
  if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > maximum) throw new Error(`${file.filename}: input size limit exceeded`);
}

export function verifyInput(bytes: Uint8Array, file: VerifiedInput): void {
  if (bytes.byteLength !== file.bytes) throw new Error(`${file.filename}: byte length mismatch (expected ${file.bytes}, got ${bytes.byteLength})`);
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`${file.filename}: SHA-256 mismatch`);
}

export async function readVerifiedInput(filename: string, file: VerifiedInput, maxBytes: number): Promise<Uint8Array> {
  checkSize(file, maxBytes);
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.size !== file.bytes) throw new Error(`${file.filename}: byte length mismatch or non-regular file`);
  const handle = await open(filename, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== file.bytes) throw new Error(`${file.filename}: byte length mismatch or non-regular file`);
    const buffer = Buffer.alloc(file.bytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await handle.read(buffer, length, buffer.length - length, length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    const bytes = buffer.subarray(0, length);
    verifyInput(bytes, file);
    return bytes;
  } finally {
    await handle.close();
  }
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export async function downloadVerifiedInput(file: VerifiedInput, options: DownloadOptions): Promise<Uint8Array> {
  checkSize(file, options.maxBytes);
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) throw new Error(`${file.filename}: timeout must be between 1 and 30000 milliseconds`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${file.filename}: timeout exceeded`)), timeoutMs);
  const { signal } = controller;
  try {
    const response = await abortable((options.fetcher ?? fetch)(file.url, { signal, redirect: 'error' }), signal);
    if (!response.ok || response.redirected || (response.url && response.url !== file.url)) {
      void response.body?.cancel().catch(() => {});
      if (!response.ok) throw new Error(`${file.filename}: HTTP ${response.status}`);
      throw new Error(`${file.filename}: unexpected redirect`);
    }
    const contentLength = response.headers.get('content-length');
    const encoding = response.headers.get('content-encoding');
    // Node fetch retains the compressed wire length after decoding; docs/integration/poc-sources.md records the asset precedent.
    if ((!encoding || encoding === 'identity') && contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) !== file.bytes)) {
      void response.body?.cancel().catch(() => {});
      throw new Error(`${file.filename}: byte length mismatch in Content-Length`);
    }
    if (!response.body) throw new Error(`${file.filename}: empty response body`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const chunk = await abortable(reader.read(), signal);
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > file.bytes) throw new Error(`${file.filename}: download size limit exceeded`);
        chunks.push(chunk.value);
      }
    } finally {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks, length);
    verifyInput(bytes, file);
    return bytes;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

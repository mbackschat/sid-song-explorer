import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetSourcePath, MAX_ASSET_BYTES, parseCatalog } from '../src/catalog.ts';
import type { Catalog, CatalogFile } from '../src/catalog.ts';

type PreparationOptions = {
  outputDirectory: string;
  sourceRoot?: string;
  fetcher?: typeof fetch;
};

type PreparedFile = { filename: string; status: 'written' | 'verified' };

function verify(bytes: Uint8Array, file: CatalogFile): void {
  if (bytes.byteLength !== file.bytes) throw new Error(`${file.filename}: byte length mismatch (expected ${file.bytes}, got ${bytes.byteLength})`);
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`${file.filename}: SHA-256 mismatch`);
}

async function readVerified(filename: string, file: CatalogFile): Promise<Uint8Array> {
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.size !== file.bytes) throw new Error(`${file.filename}: byte length mismatch or non-regular file`);
  const bytes = await readFile(filename);
  verify(bytes, file);
  return bytes;
}

async function download(file: CatalogFile, fetcher: typeof fetch): Promise<Uint8Array> {
  const response = await fetcher(file.url, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
  if (!response.ok) throw new Error(`${file.filename}: HTTP ${response.status}`);
  const contentLength = response.headers.get('content-length');
  const encoding = response.headers.get('content-encoding');
  // Node fetch decodes gzip while retaining its wire length; see docs/integration/poc-sources.md.
  if ((!encoding || encoding === 'identity') && contentLength !== null && Number(contentLength) !== file.bytes) {
    await response.body?.cancel();
    throw new Error(`${file.filename}: byte length mismatch in Content-Length`);
  }
  if (!response.body) throw new Error(`${file.filename}: empty response body`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > file.bytes || size > MAX_ASSET_BYTES) throw new Error(`${file.filename}: download size limit exceeded`);
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks, size);
  verify(bytes, file);
  return bytes;
}

export async function prepareSamples(catalog: Catalog, options: PreparationOptions): Promise<PreparedFile[]> {
  parseCatalog(catalog);
  await mkdir(options.outputDirectory, { recursive: true });
  const results: PreparedFile[] = [];
  for (const entry of catalog.entries) {
    for (const file of Object.values(entry.files)) {
      const destination = path.join(options.outputDirectory, file.filename);
      try {
        await readVerified(destination, file);
        results.push({ filename: file.filename, status: 'verified' });
        continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const bytes = options.sourceRoot
        ? await readVerified(path.join(options.sourceRoot, assetSourcePath(catalog.source, file.url)), file)
        : await download(file, options.fetcher ?? fetch);
      await writeFile(destination, bytes, { flag: 'wx' });
      results.push({ filename: file.filename, status: 'written' });
    }
  }
  return results;
}

async function main(args: string[]): Promise<void> {
  let sourceRoot: string | undefined;
  if (args.length > 0) {
    if (args.length !== 2 || args[0] !== '--source-root' || !args[1]) throw new Error('Usage: node scripts/prepare-samples.ts [--source-root /path/to/sid-song-crafter]');
    sourceRoot = path.resolve(args[1]);
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  const catalog = parseCatalog(JSON.parse(await readFile(path.join(root, 'config/catalog.json'), 'utf8')));
  const files = await prepareSamples(catalog, { outputDirectory: path.join(root, 'public/generated'), sourceRoot });
  for (const file of files) process.stdout.write(`${file.status}: public/generated/${file.filename}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

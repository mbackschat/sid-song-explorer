import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetSourcePath, MAX_ASSET_BYTES, parseCatalog } from '../src/catalog.ts';
import type { Catalog } from '../src/catalog.ts';
import { downloadVerifiedInput, readVerifiedInput } from './verified-input.ts';

type PreparationOptions = {
  outputDirectory: string;
  sourceRoot?: string;
  fetcher?: typeof fetch;
};

type PreparedFile = { filename: string; status: 'written' | 'verified' };

export async function prepareSamples(catalog: Catalog, options: PreparationOptions): Promise<PreparedFile[]> {
  parseCatalog(catalog);
  await mkdir(options.outputDirectory, { recursive: true });
  const results: PreparedFile[] = [];
  for (const entry of catalog.entries) {
    for (const file of Object.values(entry.files)) {
      const destination = path.join(options.outputDirectory, file.filename);
      try {
        await readVerifiedInput(destination, file, MAX_ASSET_BYTES);
        results.push({ filename: file.filename, status: 'verified' });
        continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const bytes = options.sourceRoot
        ? await readVerifiedInput(path.join(options.sourceRoot, assetSourcePath(catalog.source, file.url)), file, MAX_ASSET_BYTES)
        : await downloadVerifiedInput(file, { maxBytes: MAX_ASSET_BYTES, fetcher: options.fetcher });
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

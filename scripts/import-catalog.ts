import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { adaptProducerCatalog, MAX_INDEX_BYTES, parseProducerJson, parseProducerPin, producerIndexUrl } from '../src/producer-catalog.ts';
import type { Catalog } from '../src/catalog.ts';
import { downloadVerifiedInput, readVerifiedInput } from './verified-input.ts';

type LoadOptions = {
  indexFile?: string;
  sourceRoot?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

type ImportOptions = LoadOptions & { outputFile: string; check?: boolean };

export async function loadPinnedCatalog(value: unknown, options: LoadOptions = {}): Promise<Catalog> {
  const pin = parseProducerPin(value);
  if (options.indexFile && options.sourceRoot) throw new Error('Producer index: local input options are mutually exclusive');
  let indexFile = options.indexFile;
  if (options.sourceRoot) {
    const sourceRoot = await realpath(options.sourceRoot);
    indexFile = path.join(sourceRoot, pin.path);
    const resolved = await realpath(indexFile);
    if (!resolved.startsWith(`${sourceRoot}${path.sep}`)) throw new Error('Producer index: source-root path escapes its root');
  }
  const input = { filename: 'Producer index', url: producerIndexUrl(pin), bytes: pin.bytes, sha256: pin.sha256 };
  const bytes = indexFile
    ? await readVerifiedInput(indexFile, input, MAX_INDEX_BYTES)
    : await downloadVerifiedInput(input, { maxBytes: MAX_INDEX_BYTES, fetcher: options.fetcher, timeoutMs: options.timeoutMs });
  const catalog = adaptProducerCatalog(parseProducerJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  if (catalog.source.repository !== pin.repository) throw new Error('Producer index: source repository does not match producer pin repository');
  return catalog;
}

export async function importCatalog(pin: unknown, options: ImportOptions): Promise<Catalog> {
  const catalog = await loadPinnedCatalog(pin, options);
  if (options.check) {
    const actual = JSON.parse(await readFile(options.outputFile, 'utf8'));
    if (!isDeepStrictEqual(actual, catalog)) throw new Error(`Generated catalog differs from ${options.outputFile}`);
    return catalog;
  }
  await mkdir(path.dirname(options.outputFile), { recursive: true });
  const temporary = `${options.outputFile}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, options.outputFile);
  } finally {
    await rm(temporary, { force: true });
  }
  return catalog;
}

async function main(args: string[]): Promise<void> {
  const usage = 'Usage: node scripts/import-catalog.ts --pin FILE [--index FILE | --source-root DIR] --output FILE [--check]';
  const values = new Map<string, string>();
  let check = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    if (flag === '--check' && !check) { check = true; continue; }
    if (!['--pin', '--index', '--source-root', '--output'].includes(flag) || values.has(flag) || !args[index + 1] || args[index + 1]!.startsWith('--')) throw new Error(usage);
    values.set(flag, args[++index]!);
  }
  if (!values.has('--pin') || !values.has('--output') || (values.has('--index') && values.has('--source-root'))) throw new Error(usage);
  const pin = parseProducerPin(parseProducerJson(await readFile(values.get('--pin')!, 'utf8')));
  const catalog = await importCatalog(pin, { outputFile: values.get('--output')!, indexFile: values.get('--index'), sourceRoot: values.get('--source-root'), check });
  process.stdout.write(`${check ? 'verified' : 'imported'}: ${catalog.entries.length} playable entries, ${catalog.materials.length} materials; ${values.get('--output')}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

import {mkdir, readFile, realpath, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseCatalog, type Catalog} from '../src/catalog.ts';
import {parseProducerPin, parseProducerJson, producerIndexUrl, MAX_INDEX_BYTES} from '../src/producer-catalog.ts';
import {parseCompositionPackage, compositionMatchesEntry, type CompositionPackage} from '../src/composition-package.ts';
import {downloadVerifiedInput, readVerifiedInput} from './verified-input.ts';
import {parseCompositionTiming, projectCompositionPackage, type CompositionTiming} from '../src/composition-time.ts';

type ImportOptions = {inputFile?: string; sourceRoot?: string; outputFile?: string};

export async function verifyCompositionTiming(value: unknown, pinValue: unknown, pkg: CompositionPackage): Promise<CompositionTiming> {
  const timing = parseCompositionTiming(value);
  const pin = parseProducerPin(pinValue);
  if (timing.packageSha256 !== pin.sha256) throw new Error('Composition timing package fingerprint differs');
  const root = fileURLToPath(new URL('../', import.meta.url));
  for (const [field, filename] of [
    ['moduleSha256', 'build/engine/libsidplayfp.js'],
    ['wasmSha256', 'build/engine/libsidplayfp.wasm'],
    ['sessionSha256', 'src/engine/session.ts'],
  ] as const) {
    const actual = createHash('sha256').update(await readFile(path.join(root, filename))).digest('hex');
    if (actual !== timing.engine[field]) throw new Error(`Composition timing is stale for ${filename}; rerun the bounded calibration`);
  }
  const events = new Map(pkg.passages.flatMap(passage => passage.events).map(event => [event.id, event]));
  if (timing.checkedEvents !== events.size || ![...events.values()].some(event => event.sourceCall === timing.anchor.sourceCall)) throw new Error('Composition timing event coverage differs');
  projectCompositionPackage(pkg, timing);
  return timing;
}

export async function importComposition(value: unknown, catalog: Catalog, options: ImportOptions = {}): Promise<CompositionPackage> {
  const pin = parseProducerPin(value);
  if (options.inputFile && options.sourceRoot) throw new Error('Composition local input options are mutually exclusive');
  let inputFile = options.inputFile;
  if (options.sourceRoot) {
    const sourceRoot = await realpath(options.sourceRoot);
    inputFile = await realpath(path.join(sourceRoot, pin.path));
    if (!inputFile.startsWith(`${sourceRoot}${path.sep}`)) throw new Error('Composition source path escapes its root');
  }
  const input = {filename: 'Composition package', url: producerIndexUrl(pin), bytes: pin.bytes, sha256: pin.sha256};
  const bytes = inputFile ? await readVerifiedInput(inputFile, input, MAX_INDEX_BYTES) : await downloadVerifiedInput(input, {maxBytes: MAX_INDEX_BYTES});
  const pkg = parseCompositionPackage(parseProducerJson(new TextDecoder('utf-8', {fatal: true}).decode(bytes)));
  if (pkg.source.repository !== pin.repository || pkg.source.repository !== catalog.source.repository) throw new Error('Composition source repository does not match its pin and catalog');
  if (!catalog.entries.some(entry => compositionMatchesEntry(pkg, entry))) throw new Error('Composition package does not match a catalog export and duration');
  if (options.outputFile) {
    await mkdir(path.dirname(options.outputFile), {recursive: true});
    const temporary = `${options.outputFile}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, bytes, {flag: 'wx'});
      await rename(temporary, options.outputFile);
    } finally {
      await rm(temporary, {force: true});
    }
  }
  return pkg;
}

async function main(args: string[]): Promise<void> {
  const usage = 'Usage: node scripts/import-composition.ts --pin FILE --catalog FILE [--input FILE | --source-root DIR] [--timing FILE] [--output FILE | --check]';
  const values = new Map<string, string>();
  let check = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    if (flag === '--check' && !check) {check = true; continue;}
    if (!['--pin', '--catalog', '--input', '--source-root', '--output', '--timing'].includes(flag) || values.has(flag) || !args[index + 1] || args[index + 1]!.startsWith('--')) throw new Error(usage);
    values.set(flag, args[++index]!);
  }
  if (!values.has('--pin') || !values.has('--catalog') || (check && values.has('--output')) || (!check && !values.has('--output'))) throw new Error(usage);
  const pin = parseProducerJson(await readFile(values.get('--pin')!, 'utf8'));
  const catalog = parseCatalog(parseProducerJson(await readFile(values.get('--catalog')!, 'utf8')));
  const pkg = await importComposition(pin, catalog, {inputFile: values.get('--input'), sourceRoot: values.get('--source-root'), outputFile: values.get('--output')});
  if (values.has('--timing')) {
    const timing = await verifyCompositionTiming(parseProducerJson(await readFile(values.get('--timing')!, 'utf8')), pin, pkg);
    if (!catalog.entries.some(entry => compositionMatchesEntry(projectCompositionPackage(pkg, timing), entry))) throw new Error('Projected composition lies outside the catalog duration');
  }
  process.stdout.write(`verified composition: ${pkg.id}, ${pkg.passages.length} passages, ${pkg.instruments.length} program states\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_PACKAGE = 'libsidplayfp-wasm';
const BASE_VERSION = '1.1.0';
const SOURCE_ARCHIVE_SHA256 = 'd0a3fa551bde2b55733b3c2bfd8ebd6f886ec9d81407c069d2ded15600eef0fb';
const RUNTIME_FILES = ['libsidplayfp.js', 'libsidplayfp.wasm', 'libsidplayfp.d.ts'];
const PUBLIC_FILES = new Map([
  ['LICENSE', 'engine-LICENSE.txt'],
  ['THIRD-PARTY-NOTICES.md', 'engine-NOTICES.txt'],
  ['MODIFICATIONS.md', 'engine-MODIFICATIONS.txt'],
  ['EXPLORER-LICENSE.txt', 'engine-EXPLORER-LICENSE.txt'],
  ['complete-source.tar.gz', 'engine-complete-source.tar.gz'],
]);
const ARTIFACT_FILES = [...RUNTIME_FILES, ...PUBLIC_FILES.keys()];

interface PreparationOptions {
  artifactDirectory?: string;
  engineDirectory?: string;
  publicDirectory?: string;
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function record(value: unknown, field: string): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), `${field} must be an object`);
  return value as Record<string, unknown>;
}

async function regularFile(filename: string): Promise<Buffer> {
  requireValue((await lstat(filename)).isFile(), `${filename} must be a regular file`);
  return readFile(filename);
}

async function verifiedArtifacts(directory: string): Promise<Map<string, Buffer>> {
  const packageRoot = resolve(root, 'node_modules', BASE_PACKAGE);
  const project = JSON.parse((await regularFile(resolve(root, 'package.json'))).toString());
  const dependency = JSON.parse((await regularFile(resolve(packageRoot, 'package.json'))).toString());
  requireValue(project.dependencies?.[BASE_PACKAGE] === BASE_VERSION &&
    dependency.name === BASE_PACKAGE && dependency.version === BASE_VERSION, 'the installed base package must match the exact project pin');
  requireValue(digest(await regularFile(resolve(packageRoot, 'dist/complete-source.tar.gz'))) === SOURCE_ARCHIVE_SHA256,
    'the installed base corresponding-source archive differs from its pin');
  const provenanceBytes = await regularFile(resolve(directory, 'provenance.json'));
  const provenance = record(JSON.parse(provenanceBytes.toString()), 'provenance');
  requireValue(provenance.basePackage === BASE_PACKAGE && provenance.baseVersion === BASE_VERSION &&
    provenance.engine === 'SIDLite' && provenance.sourceArchiveSha256 === SOURCE_ARCHIVE_SHA256, 'the artifact base package/source pin is stale');
  requireValue(provenance.bindingPatchSha256 === digest(await regularFile(resolve(root, 'scripts/experiments/stereo/render-raw.inc'))),
    'the artifact binding patch differs from the current source');
  requireValue(provenance.buildRunnerSha256 === digest(await regularFile(resolve(root, 'scripts/experiments/stereo/run.py'))),
    'the artifact build runner differs from the current source');
  requireValue(Array.isArray(provenance.files) && provenance.files.length === ARTIFACT_FILES.length, 'the artifact inventory is incomplete');
  const artifacts = new Map<string, Buffer>();
  for (const value of provenance.files) {
    const file = record(value, 'artifact');
    requireValue(typeof file.file === 'string' && ARTIFACT_FILES.includes(file.file) && !artifacts.has(file.file), 'the artifact inventory contains an unknown or duplicate filename');
    requireValue(Number.isSafeInteger(file.bytes) && (file.bytes as number) > 0 &&
      typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256), `invalid fingerprint for ${file.file}`);
    const bytes = await regularFile(resolve(directory, file.file));
    requireValue(bytes.length === file.bytes && digest(bytes) === file.sha256, `artifact fingerprint mismatch: ${file.file}`);
    artifacts.set(file.file, bytes);
  }
  const resultBytes = await regularFile(resolve(directory, 'result.json'));
  const result = record(JSON.parse(resultBytes.toString()), 'verification');
  requireValue(result.status === 'passed' && result.shippedMonoCompared === true, 'the raw-chip gate has not passed with the shipped mono comparison');
  requireValue(result.provenanceSha256 === digest(provenanceBytes), 'the passing gate does not identify this exact artifact provenance');
  requireValue(result.verifierSha256 === digest(await regularFile(resolve(root, 'scripts/experiments/stereo/verify.mjs'))),
    'the passing gate used a stale verifier');
  requireValue(Array.isArray(result.checks) && result.checks.length === 4, 'the gate must cover both models and both chip outputs');
  const covered = new Set<string>();
  for (const value of result.checks) {
    const check = record(value, 'verification check');
    requireValue((check.model === 'MOS6581' || check.model === 'MOS8580') && (check.activeChip === 0 || check.activeChip === 1) &&
      Number.isSafeInteger(check.frames) && (check.frames as number) > 0 && Number.isSafeInteger(check.traceWrites) && (check.traceWrites as number) > 0 &&
      check.seekFrame === 12347 && check.continuationFrames === 4093 && typeof check.pcmSha256 === 'string' && /^[a-f0-9]{64}$/.test(check.pcmSha256),
    'the gate contains an incomplete routing/trace/seek check');
    covered.add(`${check.model}:${check.activeChip}`);
  }
  requireValue(covered.size === 4, 'the gate must cover distinct model/chip combinations');
  artifacts.set('provenance.json', provenanceBytes);
  artifacts.set('result.json', resultBytes);
  return artifacts;
}

export async function prepareRuntime(options: PreparationOptions = {}): Promise<void> {
  try {
    const artifacts = await verifiedArtifacts(options.artifactDirectory ?? resolve(root, 'build/stereo-gate/output'));
    const engineDirectory = options.engineDirectory ?? resolve(root, 'build/engine');
    const publicDirectory = options.publicDirectory ?? resolve(root, 'public/generated');
    await mkdir(engineDirectory, {recursive: true});
    await mkdir(publicDirectory, {recursive: true});
    for (const file of RUNTIME_FILES) await writeFile(resolve(engineDirectory, file), artifacts.get(file)!);
    for (const [source, destination] of PUBLIC_FILES) await writeFile(resolve(publicDirectory, destination), artifacts.get(source)!);
    await writeFile(resolve(publicDirectory, 'engine-provenance.json'), artifacts.get('provenance.json')!);
    await writeFile(resolve(publicDirectory, 'engine-verification.json'), artifacts.get('result.json')!);
  } catch (error) {
    throw new Error(`Raw-chip engine assets are missing or stale: ${error instanceof Error ? error.message : String(error)}. Run pnpm prepare:engine (Docker required), then pnpm prepare:assets.`, {cause: error});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareRuntime().then(() => {
    process.stdout.write('Prepared the verified raw-chip runtime, licenses, notices and complete corresponding source.\n');
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

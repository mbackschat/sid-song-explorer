import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { get as httpGet, type IncomingMessage } from 'node:http';
import { get as httpsGet } from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export interface ArtifactFile {
  path: string;
  size: number;
  sha256: string;
}

export interface Manifest {
  schemaVersion: 1;
  commit: string;
  files: ArtifactFile[];
  digest: string;
}

const manifestPath = 'build/release/artifact.json';
const requestTimeoutMs = 10_000;
const servedTimeoutMs = 30_000;
const execute = promisify(execFile);

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Release artifact: ${message}`);
}

function validCommit(commit: unknown): commit is string {
  return typeof commit === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit);
}

function comparePaths(left: ArtifactFile, right: ArtifactFile): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function inventoryDigest(commit: string, files: ArtifactFile[]): string {
  return createHash('sha256').update(JSON.stringify({ schemaVersion: 1, commit, files })).digest('hex');
}

function validPath(filename: unknown): filename is string {
  if (typeof filename !== 'string' || !/^(?:dist\/|public\/generated\/)/.test(filename) || /[\\\u0000]/.test(filename)) return false;
  return filename.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

function verifyFixtures(files: ArtifactFile[]): void {
  const inventory = new Map(files.map(file => [file.path, file]));
  for (const file of files) {
    const counterpart = file.path.startsWith('public/generated/')
      ? `dist/generated/${file.path.slice('public/generated/'.length)}`
      : file.path.startsWith('dist/generated/')
        ? `public/generated/${file.path.slice('dist/generated/'.length)}`
        : undefined;
    if (!counterpart) continue;
    const shipped = inventory.get(counterpart);
    requireValue(shipped && file.size === shipped.size && file.sha256 === shipped.sha256,
      `fixture bytes do not match their shipped copy: ${file.path}`);
  }
}

function record(value: unknown, keys: string[], label: string): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  const result = value as Record<string, unknown>;
  requireValue(Object.keys(result).length === keys.length && keys.every(key => Object.hasOwn(result, key)), `${label} has invalid fields`);
  return result;
}

function parseManifest(value: unknown): Manifest {
  const manifest = record(value, ['schemaVersion', 'commit', 'files', 'digest'], 'manifest');
  requireValue(manifest.schemaVersion === 1 && validCommit(manifest.commit), 'manifest version or commit is invalid');
  requireValue(Array.isArray(manifest.files) && manifest.files.length > 0, 'manifest inventory is empty or invalid');
  const files: ArtifactFile[] = manifest.files.map(value => {
    const file = record(value, ['path', 'size', 'sha256'], 'inventory entry');
    requireValue(validPath(file.path) && Number.isSafeInteger(file.size) && (file.size as number) >= 0 &&
      typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256), 'inventory entry is invalid');
    return { path: file.path, size: file.size as number, sha256: file.sha256 };
  });
  for (let index = 1; index < files.length; index++) {
    requireValue(comparePaths(files[index - 1]!, files[index]!) < 0, 'inventory paths must be unique and sorted');
  }
  requireValue(files.some(file => file.path.startsWith('dist/')), 'distribution inventory is empty');
  verifyFixtures(files);
  requireValue(typeof manifest.digest === 'string' && manifest.digest === inventoryDigest(manifest.commit, files), 'aggregate digest mismatch');
  return { schemaVersion: 1, commit: manifest.commit, files, digest: manifest.digest };
}

async function directory(root: string, relative: string, create = false): Promise<string> {
  let current = path.resolve(root);
  requireValue((await lstat(current)).isDirectory(), `root must be a directory without symlinks: ${current}`);
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    if (create) {
      try { await mkdir(current); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    const stat = await lstat(current);
    requireValue(stat.isDirectory(), `expected directory without symlinks: ${current}`);
  }
  return current;
}

async function fingerprint(root: string, filename: string): Promise<ArtifactFile> {
  requireValue((await lstat(path.join(root, filename))).isFile(), `expected regular file without symlinks: ${filename}`);
  const handle = await open(path.join(root, filename), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    requireValue(stat.isFile() && Number.isSafeInteger(stat.size), `expected regular file: ${filename}`);
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length;
      hash.update(chunk);
    }
    requireValue(size === stat.size, `file changed while hashing: ${filename}`);
    return { path: filename, size, sha256: hash.digest('hex') };
  } finally {
    await handle.close();
  }
}

async function inventory(root: string): Promise<ArtifactFile[]> {
  const files: ArtifactFile[] = [];
  async function visit(relative: string): Promise<void> {
    for (const name of await readdir(path.join(root, relative))) {
      const filename = `${relative}/${name}`;
      requireValue(validPath(filename), `unsupported inventory path: ${filename}`);
      const stat = await lstat(path.join(root, filename));
      if (stat.isDirectory()) await visit(filename);
      else files.push(await fingerprint(root, filename));
    }
  }
  for (const scope of ['dist', 'public/generated']) {
    await directory(root, scope);
    await visit(scope);
  }
  requireValue(files.some(file => file.path.startsWith('dist/')), 'distribution inventory is empty');
  files.sort(comparePaths);
  verifyFixtures(files);
  return files;
}

export async function sealArtifact(root: string, commit: string): Promise<Manifest> {
  requireValue(validCommit(commit), 'expected commit must be a complete Git object ID');
  const files = await inventory(root);
  const manifest: Manifest = { schemaVersion: 1, commit, files, digest: inventoryDigest(commit, files) };
  await directory(root, 'build/release', true);
  const filename = path.join(root, manifestPath);
  try { requireValue((await lstat(filename)).isFile(), 'manifest must be a regular file without symlinks'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temporary = `${filename}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
  return manifest;
}

export async function verifyArtifact(root: string, commit: string): Promise<Manifest> {
  requireValue(validCommit(commit), 'expected commit must be a complete Git object ID');
  await directory(root, 'build/release');
  const filename = path.join(root, manifestPath);
  requireValue((await lstat(filename)).isFile(), 'manifest must be a regular file without symlinks');
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  let value: unknown;
  try { value = JSON.parse(await handle.readFile('utf8')); }
  finally { await handle.close(); }
  const manifest = parseManifest(value);
  requireValue(manifest.commit === commit, `expected commit ${commit}, found ${manifest.commit}`);
  const files = await inventory(root);
  requireValue(inventoryDigest(commit, files) === manifest.digest, 'local inventory differs from the sealed paths, sizes or SHA-256 hashes');
  return manifest;
}

async function verifyResponse(url: URL, file: ArtifactFile, signal: AbortSignal): Promise<void> {
  // Vite 7.3.1's bundled sirv toHeaders labels literal .gz assets as gzip; fetch would decode the archive before hashing.
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsGet : httpGet)(url, {
      signal, headers: { 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache' },
    }, resolve);
    request.once('error', reject);
  });
  try {
    requireValue(response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300,
      `${file.path}: HTTP ${response.statusCode}`);
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of response) {
      size += chunk.byteLength;
      requireValue(size <= file.size, `${file.path}: served byte length exceeds ${file.size}`);
      hash.update(chunk);
    }
    requireValue(size === file.size, `${file.path}: served byte length mismatch`);
    requireValue(hash.digest('hex') === file.sha256, `${file.path}: served SHA-256 mismatch`);
  } finally {
    response.destroy();
  }
}

export async function verifyServedArtifact(baseURL: string, manifest: Manifest): Promise<void> {
  const checked = parseManifest(manifest);
  const base = new URL(baseURL);
  requireValue(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password && !base.search && !base.hash,
    'served base URL must be HTTP(S) without credentials, query or fragment');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const controller = new AbortController();
  const overallTimer = setTimeout(() => controller.abort(new Error('Release artifact: served verification timeout')), servedTimeoutMs);
  try {
    for (const file of checked.files.filter(file => file.path.startsWith('dist/'))) {
      const request = new AbortController();
      const onAbort = () => request.abort(controller.signal.reason);
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
      const timer = setTimeout(() => request.abort(new Error(`Release artifact: ${file.path}: served request timeout`)), requestTimeoutMs);
      try {
        const relative = file.path.slice('dist/'.length).split('/').map(segment => encodeURIComponent(segment)).join('/');
        await verifyResponse(new URL(relative, base), file, request.signal);
      } catch (error) {
        throw new Error(`Release artifact: ${file.path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', onAbort);
        request.abort();
      }
    }
  } finally {
    clearTimeout(overallTimer);
    controller.abort();
  }
}

async function main(args: string[]): Promise<void> {
  requireValue(args.length === 1 && ['seal', 'verify'].includes(args[0]!), 'Usage: node scripts/release-artifact.ts seal|verify');
  const root = process.cwd();
  const { stdout } = await execute('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 5_000 });
  const manifest = args[0] === 'seal' ? await sealArtifact(root, stdout.trim()) : await verifyArtifact(root, stdout.trim());
  process.stdout.write(`${args[0] === 'seal' ? 'sealed' : 'verified'} release artifact ${manifest.digest} for ${manifest.commit}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

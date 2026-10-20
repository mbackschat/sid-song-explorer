import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { sealArtifact, verifyArtifact, verifyServedArtifact, type Manifest } from '../scripts/release-artifact.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const commit = '1234567890abcdef1234567890abcdef12345678';
const otherCommit = 'abcdef1234567890abcdef1234567890abcdef12';
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const execute = promisify(execFile);
const contents = {
  'dist/index.html': '<!doctype html><script src="/assets/app.js"></script>',
  'dist/assets/app.js': 'console.log("candidate A");',
  'dist/assets/empty.txt': '',
  'dist/generated/nested/sample %.sid': 'synthetic fixture bytes',
  'public/generated/nested/sample %.sid': 'synthetic fixture bytes',
};

async function fixture(context: TestContext): Promise<string> {
  const work = path.join(projectRoot, 'build/release-work');
  await mkdir(work, { recursive: true });
  const root = await mkdtemp(path.join(work, 'artifact-test-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const [filename, bytes] of Object.entries(contents).reverse()) {
    await mkdir(path.dirname(path.join(root, filename)), { recursive: true });
    await writeFile(path.join(root, filename), bytes);
  }
  return root;
}

async function serve(context: TestContext, root: string, intercept?: (pathname: string, response: ServerResponse) => boolean): Promise<string> {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname);
    if (intercept?.(pathname, response)) return;
    readFile(path.join(root, 'dist', pathname)).then(bytes => {
      response.writeHead(200, { 'Content-Length': bytes.length });
      response.end(bytes);
    }, () => { response.writeHead(404); response.end('missing'); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/`;
}

test('seals a complete portable byte inventory with an independently computed aggregate digest', async context => {
  const root = await fixture(context);
  const manifest = await sealArtifact(root, commit);
  const expected = Object.entries(contents).map(([filename, bytes]) => ({
    path: filename, size: Buffer.byteLength(bytes), sha256: digest(bytes),
  })).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  assert.deepEqual(manifest.files, expected);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.commit, commit);
  assert.equal(manifest.digest, digest(JSON.stringify({ schemaVersion: 1, commit, files: expected })));
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'build/release/artifact.json'), 'utf8')), manifest);
  assert.deepEqual(await verifyArtifact(root, commit), manifest);
  const secondRoot = await fixture(context);
  assert.deepEqual(await sealArtifact(secondRoot, commit), manifest);
});

test('rejects stale commits and any missing, extra, resized or same-size changed candidate bytes', async context => {
  const mutations = [
    async (root: string) => { await rm(path.join(root, 'dist/assets/app.js')); },
    async (root: string) => { await writeFile(path.join(root, 'dist/assets/extra.js'), 'extra'); },
    async (root: string) => { await writeFile(path.join(root, 'dist/index.html'), 'short'); },
    async (root: string) => { await writeFile(path.join(root, 'dist/assets/app.js'), contents['dist/assets/app.js'].replace('A', 'B')); },
    async (root: string) => { await rm(path.join(root, 'public/generated/nested/sample %.sid')); },
    async (root: string) => { await writeFile(path.join(root, 'public/generated/extra.sid'), 'extra'); },
  ];
  for (const mutate of mutations) {
    const root = await fixture(context);
    await sealArtifact(root, commit);
    await mutate(root);
    await assert.rejects(verifyArtifact(root, commit), /artifact/i);
  }
  const root = await fixture(context);
  await sealArtifact(root, commit);
  await assert.rejects(verifyArtifact(root, otherCommit), /commit/i);
});

test('refuses to seal independently valid fixture inventories that disagree with the shipped fixture bytes', async context => {
  for (const filename of ['public/generated/nested/sample %.sid', 'dist/generated/nested/sample %.sid']) {
    const root = await fixture(context);
    await writeFile(path.join(root, filename), 'different fixture bytes');
    await assert.rejects(sealArtifact(root, commit), /fixture/i);
  }
  for (const filename of ['public/generated/unshipped.sid', 'dist/generated/unowned.sid']) {
    const root = await fixture(context);
    await writeFile(path.join(root, filename), 'unmatched');
    await assert.rejects(sealArtifact(root, commit), /fixture/i);
  }
});

test('rejects symbolic links in files, directories, fixture ancestors and the manifest', async context => {
  for (const filename of ['dist/assets/app.js', 'dist/assets', 'public/generated', 'build/release/artifact.json']) {
    const root = await fixture(context);
    await sealArtifact(root, commit);
    await rm(path.join(root, filename), { recursive: true });
    await symlink(path.join(root, 'dist/index.html'), path.join(root, filename));
    await assert.rejects(verifyArtifact(root, commit), /symlink|regular|directory/i);
    await assert.rejects(sealArtifact(root, commit), /symlink|regular|directory/i);
  }
});

test('rejects malformed inventories and aggregate tampering before trusting recorded paths', async context => {
  const mutations: ((value: Manifest) => void)[] = [
    value => { value.digest = '0'.repeat(64); },
    value => { value.files.push({ ...value.files[0] }); },
    value => { value.files.reverse(); },
    value => { value.files[0].path = 'dist/../../escape'; },
    value => { value.files[0].path = '/dist/index.html'; },
    value => { value.files[0].size = -1; },
    value => { value.files[0].sha256 = 'invalid'; },
    value => { (value as { schemaVersion: number }).schemaVersion = 2; },
    value => { (value as unknown as Record<string, unknown>).extra = true; },
  ];
  for (const mutate of mutations) {
    const root = await fixture(context);
    const manifest = await sealArtifact(root, commit);
    mutate(manifest);
    await writeFile(path.join(root, 'build/release/artifact.json'), JSON.stringify(manifest));
    await assert.rejects(verifyArtifact(root, commit), /artifact/i);
  }
});

test('verifies every served distribution file, including encoded fixture paths and zero-byte files', async context => {
  const root = await fixture(context);
  const manifest = await sealArtifact(root, commit);
  await verifyServedArtifact(await serve(context, root), manifest);
});

test('verifies archive bytes when the static server labels a gzip asset with Content-Encoding', async context => {
  const root = await fixture(context);
  const archive = gzipSync('synthetic corresponding source archive\n'.repeat(100));
  for (const scope of ['dist/generated', 'public/generated']) {
    await writeFile(path.join(root, scope, 'complete-source.tar.gz'), archive);
  }
  const manifest = await sealArtifact(root, commit);
  const baseURL = await serve(context, root, (pathname, response) => {
    if (pathname !== '/generated/complete-source.tar.gz') return false;
    response.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Length': archive.length });
    response.end(archive);
    return true;
  });
  await verifyServedArtifact(baseURL, manifest);
  const changedArchive = Buffer.from(archive);
  changedArchive[9] ^= 1;
  const changedURL = await serve(context, root, (pathname, response) => {
    if (pathname !== '/generated/complete-source.tar.gz') return false;
    response.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Length': changedArchive.length });
    response.end(changedArchive);
    return true;
  });
  await assert.rejects(verifyServedArtifact(changedURL, manifest), /complete-source\.tar\.gz.*SHA-256/i);
});

test('rejects an unrelated served build even when its index and fixture bytes match', async context => {
  const root = await fixture(context);
  const manifest = await sealArtifact(root, commit);
  await writeFile(path.join(root, 'dist/assets/app.js'), contents['dist/assets/app.js'].replace('A', 'B'));
  await assert.rejects(verifyServedArtifact(await serve(context, root), manifest), /app\.js.*SHA-256/i);
});

test('rejects missing, redirected, oversized and truncated served files', async context => {
  const root = await fixture(context);
  const manifest = await sealArtifact(root, commit);
  const failures = [
    (response: ServerResponse) => { response.writeHead(404); response.end('missing'); },
    (response: ServerResponse) => { response.writeHead(302, { Location: '/index.html' }); response.end(); },
    (response: ServerResponse) => { response.writeHead(200); response.end(`${contents['dist/assets/app.js']}extra`); },
    (response: ServerResponse) => { response.writeHead(200); response.end('short'); },
  ];
  for (const failure of failures) {
    const baseURL = await serve(context, root, (pathname, response) => {
      if (pathname !== '/assets/app.js') return false;
      failure(response);
      return true;
    });
    await assert.rejects(verifyServedArtifact(baseURL, manifest), /artifact|app\.js/i);
  }
});

test('aborts a served response that stalls after headers', { timeout: 15_000 }, async context => {
  const root = await fixture(context);
  const manifest = await sealArtifact(root, commit);
  let onDisconnected!: () => void;
  const disconnected = new Promise<void>(resolve => { onDisconnected = resolve; });
  const baseURL = await serve(context, root, (pathname, response) => {
    if (pathname !== '/assets/app.js') return false;
    response.writeHead(200);
    response.flushHeaders();
    response.once('close', onDisconnected);
    return true;
  });
  await assert.rejects(verifyServedArtifact(baseURL, manifest), /timeout|abort/i);
  await disconnected;
});

test('CLI binds sealing and verification to the repository HEAD without changing build bytes', async context => {
  const root = await fixture(context);
  await execute('git', ['init', '--quiet', root], { timeout: 5_000 });
  await execute('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'test: create fixture'], { timeout: 5_000 });
  const script = path.join(projectRoot, 'scripts/release-artifact.ts');
  await execute(process.execPath, ['--experimental-strip-types', script, 'seal'], { cwd: root, timeout: 5_000 });
  const { stdout } = await execute(process.execPath, ['--experimental-strip-types', script, 'verify'], { cwd: root, timeout: 5_000 });
  assert.match(stdout, /verified/i);
  const { stdout: revision } = await execute('git', ['-C', root, 'rev-parse', 'HEAD'], { timeout: 5_000 });
  assert.equal((await verifyArtifact(root, revision.trim())).commit, revision.trim());
  await assert.rejects(execute(process.execPath, ['--experimental-strip-types', script, 'unknown'], { cwd: root, timeout: 5_000 }), /Usage/i);
});

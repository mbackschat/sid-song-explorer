import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = resolve(root, 'node_modules/libsidplayfp-wasm');
const output = resolve(root, 'public/generated');
await mkdir(output, {recursive: true});
const files = [
  ['LICENSE', 'engine-LICENSE.txt'],
  ['THIRD-PARTY-NOTICES.md', 'engine-NOTICES.txt'],
  ['MODIFICATIONS.md', 'engine-MODIFICATIONS.txt'],
  ['dist/complete-source.tar.gz', 'engine-complete-source.tar.gz'],
];
const hashes = [];
for (const [source, destination] of files) {
  const bytes = await readFile(resolve(packageRoot, source));
  await copyFile(resolve(packageRoot, source), resolve(output, destination));
  hashes.push({file: destination, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
}
const dependency = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
await writeFile(resolve(output, 'engine-provenance.json'), JSON.stringify({package: dependency.name, version: dependency.version, files: hashes}, null, 2) + '\n');
console.log('Prepared the pinned engine license, notices and complete corresponding source.');

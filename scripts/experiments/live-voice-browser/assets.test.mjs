import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyPinnedFiles} from './prepare.mjs';

test('browser spike uses the exact previously verified audio core', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const lock = JSON.parse(readFileSync(new URL('./core-lock.json', import.meta.url)));
  verifyPinnedFiles(root, lock.files);
});

test('a changed or missing core file blocks preparation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'voice-core-lock-'));
  const files = {'core.wasm': createHash('sha256').update('verified').digest('hex')};
  try {
    writeFileSync(join(directory, 'core.wasm'), 'modified');
    assert.throws(() => verifyPinnedFiles(directory, files), /Pinned file differs: core.wasm/);
    rmSync(join(directory, 'core.wasm'));
    assert.throws(() => verifyPinnedFiles(directory, files), /ENOENT/);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

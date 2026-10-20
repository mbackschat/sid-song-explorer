import {createHash} from 'node:crypto';
import {copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {syntheticSid} from '../live-voice-replay/fixtures.mjs';

export const root = fileURLToPath(new URL('../../../', import.meta.url));
export const publicDirectory = resolve(root, 'build/live-voice-browser/public');
export const lock = JSON.parse(readFileSync(new URL('./core-lock.json', import.meta.url)));

export function verifyPinnedFiles(directory, files) {
  for (const [name, expected] of Object.entries(files)) {
    const actual = createHash('sha256').update(readFileSync(resolve(directory, name))).digest('hex');
    if (actual !== expected) throw new Error(`Pinned file differs: ${name}`);
  }
}

export function prepare() {
  verifyPinnedFiles(root, lock.files);
  const engine = resolve(publicDirectory, 'engine');
  const samples = resolve(publicDirectory, 'samples');
  mkdirSync(engine, {recursive: true});
  mkdirSync(samples, {recursive: true});
  for (const name of ['libsidplayfp.js', 'libsidplayfp.wasm', 'complete-source.tar.gz', 'LICENSE',
    'THIRD-PARTY-NOTICES.md', 'MODIFICATIONS.md', 'EXPLORER-LICENSE.txt']) {
    copyFileSync(resolve(root, 'build/live-voice-replay/output', name), resolve(engine, name));
  }
  verifyPinnedFiles(engine, Object.fromEntries(['libsidplayfp.js', 'libsidplayfp.wasm'].map(name =>
    [name, lock.files[`build/live-voice-replay/output/${name}`]])));
  const catalog = JSON.parse(readFileSync(resolve(root, 'config/catalog.json')));
  const entries = [['rambo-mono', 'rambo-loader-main'], ['rambo-stereo', 'rambo-stereo-main'], ['bach-stereo', 'bach-toccata-stereo']].map(([id, catalogId]) => {
    const entry = catalog.entries.find(entry => entry.id === catalogId);
    const file = entry.files.sid;
    verifyPinnedFiles(resolve(root, 'public/generated'), {[file.filename]: file.sha256});
    copyFileSync(resolve(root, 'public/generated', file.filename), resolve(samples, file.filename));
    return {id, title: entry.title, duration: entry.durationSeconds, url: `/samples/${file.filename}`};
  });
  for (const name of readdirSync(resolve(root, 'public/generated')).filter(name =>
    /^(rambo-loader|rambo-stereo|bach-toccata).*\.(txt|md)$/.test(name))) {
    copyFileSync(resolve(root, 'public/generated', name), resolve(samples, name));
  }
  for (const kind of ['saw', 'filter', 'ring-sync', 'd418', 'noise']) {
    for (const model of ['MOS6581', 'MOS8580']) {
      for (const clock of ['PAL', 'NTSC']) {
        writeFileSync(resolve(samples, `${kind}-${model}-${clock}.sid`), syntheticSid({kind, model, clock, chips: 2}));
      }
    }
  }
  writeFileSync(resolve(publicDirectory, 'samples.json'), JSON.stringify(entries, null, 2) + '\n');
  writeFileSync(resolve(publicDirectory, 'core-lock.json'), JSON.stringify(lock, null, 2) + '\n');
  console.log('Prepared isolated browser assets; proven audio core is byte-identical.');
}

if (import.meta.main) prepare();

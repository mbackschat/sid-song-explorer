import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {lock, publicDirectory, root, verifyPinnedFiles} from './prepare.mjs';

verifyPinnedFiles(root, lock.files);
export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)), publicDir: publicDirectory,
  server: {host: '127.0.0.1', port: 4175, strictPort: true},
  preview: {host: '127.0.0.1', port: 4175, strictPort: true},
  build: {outDir: resolve(root, 'build/live-voice-browser/site'), emptyOutDir: true},
  worker: {format: 'es'},
});

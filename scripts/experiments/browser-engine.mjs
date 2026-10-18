import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, extname, isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {webkit} from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === '--output', 'Usage: node scripts/experiments/browser-engine.mjs [--output build/path.json]');
const output = args[1] ? resolve(root, args[1]) : null;
if (output) assert.ok(output.startsWith(resolve(root, 'build') + sep), '--output must be inside ignored build/');
const require = createRequire(import.meta.url);
const packageRoot = realpathSync(dirname(require.resolve('libsidplayfp-wasm/package.json')));
const enginePackage = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(resolve(root, 'config/catalog.json'), 'utf8'));
const sample = catalog.entries.find(entry => entry.id === 'rambo-loader-main');
assert.ok(sample, 'Cleared Rambo sample is missing from the catalog');
const sid = readFileSync(resolve(root, 'public/generated', sample.files.sid.filename));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(sha256(sid), sample.files.sid.sha256, 'Prepared SID differs from the pinned cleared sample');
const report = {
  createdAt:new Date().toISOString(), node:process.version, platform:process.platform, arch:process.arch,
  playwright:require('@playwright/test/package.json').version, browser:null,
  engine:{name:enginePackage.name, version:enginePackage.version, upstream:JSON.parse(readFileSync(resolve(packageRoot, 'dist/UPSTREAM.json'), 'utf8')),
    loaderSha256:sha256(readFileSync(resolve(packageRoot, 'dist/sidlite/libsidplayfp.js'))), wasmSha256:sha256(readFileSync(resolve(packageRoot, 'dist/sidlite/libsidplayfp.wasm')))},
  sample:{id:sample.id, sha256:sha256(sid), source:catalog.source, profile:sample.target},
  scope:'Raw unbundled SIDLite on a blank WebKit page; no application, Web Audio or audible output. Fresh WASM instances bypass the loader cache. This does not verify worker playback or musical quality.',
  budgetMs:60000, trials:[], events:[], passed:false,
};
function record(type, detail = {}) {
  const event = {type, at:new Date().toISOString(), ...detail};
  report.events.push(event);
  console.log(JSON.stringify(event));
  if (output) {
    mkdirSync(dirname(output), {recursive:true});
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
}
const errorDetails = error => ({name:error?.name ?? typeof error, message:error?.message ?? String(error), stack:error?.stack ?? null});
let server;
let browser;
function killBrowser() {
  const child = server?.process();
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  // Playwright launches a detached Unix process group; kill descendants too when its protocol stops responding.
  try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); }
  catch { child.kill('SIGKILL'); }
}
async function bounded(label, budgetMs, operation) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          record('deadline', {label, budgetMs});
          killBrowser();
          reject(new Error(`${label} exceeded ${budgetMs} ms; browser process group killed`));
        }, budgetMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
// Reserve two seconds for process reaping within the total one-minute experiment budget.
const watchdog = setTimeout(() => {
  report.passed = false;
  record('global-deadline', {executionBudgetMs:58000});
  killBrowser();
  process.exitCode = 1;
}, 58000);

try {
  record('start');
  server = await webkit.launchServer({headless:true, timeout:10000});
  browser = await bounded('browser connection', 10000, () => webkit.connect(server.wsEndpoint()));
  report.browser = browser.version();
  record('environment', {node:report.node, playwright:report.playwright, browser:report.browser, engine:report.engine, sample:report.sample, scope:report.scope});
  const page = await bounded('blank page creation', 5000, () => browser.newPage());
  page.on('console', message => {
    const text = message.text();
    if (text.startsWith('ENGINE_PROBE ')) record('page', JSON.parse(text.slice(13)));
    else record('console', {level:message.type(), text});
  });
  page.on('pageerror', error => record('pageerror', {error:errorDetails(error)}));
  page.on('crash', () => record('page-crash'));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:43219') return route.abort('blockedbyclient');
    if (url.pathname === '/') return route.fulfill({contentType:'text/html', body:'<!doctype html><title>Silent raw engine probe</title>'});
    if (!url.pathname.startsWith('/engine/')) return route.abort('blockedbyclient');
    const candidate = resolve(packageRoot, decodeURIComponent(url.pathname.slice('/engine/'.length)));
    if (!existsSync(candidate)) return route.fulfill({status:404, body:'Not found'});
    const path = realpathSync(candidate);
    const within = relative(packageRoot, path);
    if (within.startsWith('..') || isAbsolute(within)) return route.abort('blockedbyclient');
    return route.fulfill({path, contentType:extname(path) === '.wasm' ? 'application/wasm' : 'text/javascript'});
  });
  await bounded('blank page navigation', 5000, () => page.goto('http://127.0.0.1:43219/'));
  await bounded('silent page setup', 5000, () => page.evaluate(() => {
    const forbidden = () => { throw new Error('Audio output is forbidden in the raw engine probe'); };
    window.AudioContext = forbidden;
    window.webkitAudioContext = forbidden;
    window.OfflineAudioContext = forbidden;
    HTMLMediaElement.prototype.play = forbidden;
    let ticks = 0;
    setInterval(() => console.log('ENGINE_PROBE ' + JSON.stringify({stage:'heartbeat', ticks:++ticks, pageMs:performance.now()})), 1000);
  }));
  for (let index = 0; index < 14; index++) {
    const targetSeconds = index < 12 ? 0.25 : 180;
    record('trial-start', {index, targetSeconds});
    const result = await bounded(`raw engine trial ${index}`, targetSeconds > 1 ? 15000 : 5000, () => page.evaluate(async ({index, targetSeconds, bytes, profile}) => {
      const started = performance.now();
      const emit = (stage, detail = {}) => console.log('ENGINE_PROBE ' + JSON.stringify({stage, index, pageMs:performance.now(), ...detail}));
      let context;
      let stage = 'import';
      try {
        emit(stage);
        const {default:load} = await import('/engine/dist/index.js');
        stage = 'instantiate'; emit(stage);
        const module = await load({engine:'sidlite', locateFile:() => '/engine/dist/sidlite/libsidplayfp.wasm'});
        const instantiateMs = performance.now() - started;
        stage = 'context'; emit(stage, {instantiateMs});
        context = new module.SidPlayerContext();
        if (!context.configure(44100, false) || !context.setEmulationConfig({frequency:44100, stereo:false, c64Model:profile.clock,
          forceC64Model:true, sidModel:profile.model, forceSidModel:true, powerOnDelay:0, secondSidAddress:0, thirdSidAddress:0})) throw new Error(context.getLastError());
        context.setSidWriteTraceEnabled(true);
        const input = Uint8Array.from(bytes);
        new DataView(input.buffer).setUint16(16, profile.subtune);
        stage = 'load'; emit(stage);
        if (!context.loadSidBuffer(input)) throw new Error(context.getLastError());
        const info = context.getTuneInfo();
        const engine = context.getEngineInfo();
        if (info.currentSong !== profile.subtune || engine.builder !== 'WasmSIDLite' || engine.installedSids !== 1) throw new Error('Raw engine installed an unexpected tune/profile');
        stage = 'render'; emit(stage);
        let frames = 0, calls = 0, writes = 0, dropped = 0, peak = 0;
        let nextProgress = 30;
        while (frames < Math.ceil(targetSeconds * 44100)) {
          const pcm = context.render(20000)?.slice();
          if (!pcm?.length) throw new Error(`Raw engine produced no PCM: ${context.getLastError()}`);
          frames += pcm.length;
          calls++;
          for (const sample of pcm) peak = Math.max(peak, Math.abs(sample));
          dropped += context.getDroppedSidWriteTraceCount();
          writes += context.getAndClearSidWriteTracesPacked().length / 4;
          if (frames / 44100 >= nextProgress) { emit('progress', {seconds:frames / 44100}); nextProgress += 30; }
          // Bound continuous page work so a healthy engine leaves independently observed heartbeat opportunities.
          if (calls % 50 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        }
        if (!peak || dropped) throw new Error(`Unexpected raw PCM/trace result: peak=${peak}, dropped=${dropped}`);
        return {index, targetSeconds, frames, calls, writes, dropped, peak, instantiateMs, elapsedMs:performance.now() - started};
      } catch (error) {
        emit('error', {atStage:stage, error:{name:error?.name, message:error?.message ?? String(error), stack:error?.stack ?? null}});
        throw error;
      } finally { context?.delete(); }
    }, {index, targetSeconds, bytes:Array.from(sid), profile:sample.target}));
    report.trials.push(result);
    record('trial-complete', result);
  }
  report.passed = report.trials.length === 14;
} catch (error) {
  report.error = errorDetails(error);
  record('failure', {error:report.error});
  process.exitCode = 1;
} finally {
  try {
    if (browser) await bounded('browser shutdown', 1000, () => browser.close());
    if (server) await bounded('browser process reaping', 1000, () => server.close());
  } catch (error) { report.passed = false; record('cleanup-error', {error:errorDetails(error)}); killBrowser(); process.exitCode = 1; }
  clearTimeout(watchdog);
  record('complete', {passed:report.passed && !process.exitCode, output});
}

import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import type {Page} from '@playwright/test';
import {test, expect} from '../../../tests/browser/fixtures.ts';

interface DeliveredBlock {startFrame: number; endFrame: number; mask: number; chips: number}
interface ScheduledBlock {at: number; now: number; rate: number; channels: number[][]}
interface Action {mask: number; at: number; contextTime: number}
interface Audit {
  delivered: DeliveredBlock[];
  scheduled: ScheduledBlock[];
  actions: Action[];
  nextActionMask: number;
  contexts: number;
  stops: number;
  suspends: number;
  closes: number;
  workerCount: number;
  contextTime: number;
  contextState: string;
}

declare global {interface Window {__voiceBrowserAudit: Audit}}

async function installOutputAudit(page: Page) {
  await page.addInitScript(() => {
    const audit: Audit = {
      delivered: [], scheduled: [], actions: [], nextActionMask: 63,
      contexts: 0, stops: 0, suspends: 0, closes: 0, workerCount: 0, contextTime: 0, contextState: 'none',
    };
    window.__voiceBrowserAudit = audit;
    const contexts = new Set<BaseAudioContext>();
    let context: BaseAudioContext | undefined;
    Object.defineProperty(audit, 'contextTime', {enumerable: true, get: () => context?.currentTime ?? 0});
    Object.defineProperty(audit, 'contextState', {enumerable: true, get: () => context?.state ?? 'none'});
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.buffer) {
        contexts.add(this.context);
        context = this.context;
        audit.contexts = contexts.size;
        audit.scheduled.push({
          at: args[0] ?? 0, now: this.context.currentTime, rate: this.buffer.sampleRate,
          channels: Array.from({length: this.buffer.numberOfChannels}, (_, channel) => Array.from(this.buffer!.getChannelData(channel))),
        });
      }
      return Reflect.apply(start, this, args);
    };
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function (...args) {
      audit.stops++;
      return Reflect.apply(stop, this, args);
    };
    for (const method of ['suspend', 'close'] as const) {
      const native = AudioContext.prototype[method];
      AudioContext.prototype[method] = function () {
        if (method === 'suspend') audit.suspends++;
        else audit.closes++;
        return native.call(this);
      };
    }
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        audit.workerCount++;
        this.addEventListener('message', event => {
          const result = event.data.result;
          if (result?.pcm && Number.isInteger(result.startFrame)) {
            audit.delivered.push({
              startFrame: result.startFrame, endFrame: result.endFrame,
              mask: result.mask, chips: result.chips,
            });
          }
        });
      }
    };
    addEventListener('click', event => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('[data-action], #full-mix')) return;
      if (!context) throw new Error('A voice action preceded the first scheduled output');
      audit.actions.push({mask: audit.nextActionMask, at: performance.now(), contextTime: context.currentTime});
    }, {capture: true});
  });
}

async function waitForMask(page: Page, mask: number, after: number) {
  await expect.poll(() => page.evaluate(({mask, after}) => {
    const audit = window.__voiceBrowserAudit;
    return audit.delivered.slice(after, audit.scheduled.length).filter((block, offset) =>
      block.mask === mask && audit.scheduled[after + offset]!.at <= audit.contextTime).length;
  }, {mask, after}), {timeout: 5000}).toBeGreaterThanOrEqual(2);
}

async function chooseMask(page: Page, selector: string, mask: number) {
  const before = await page.evaluate(mask => {
    window.__voiceBrowserAudit.nextActionMask = mask;
    return window.__voiceBrowserAudit.scheduled.length;
  }, mask);
  await page.locator(selector).click();
  await waitForMask(page, mask, before);
}

async function start(page: Page, sample: string, model: string) {
  await installOutputAudit(page);
  await page.goto('/');
  await page.locator('#sample').selectOption(sample);
  await page.locator('#model').selectOption(model);
  await page.locator('#clock').selectOption('PAL');
  await page.locator('#load').click();
  await expect(page.locator('#status')).toHaveText('Ready');
  await page.locator('#play').click();
  await expect(page.locator('#status')).toHaveText('Playing');
  await waitForMask(page, 63, 0);
}

function assertContinuous(audit: Audit) {
  expect(audit.contexts).toBe(1);
  expect(audit.workerCount).toBe(1);
  expect(audit.stops).toBe(0);
  expect(audit.suspends).toBe(0);
  expect(audit.closes).toBe(0);
  expect(audit.scheduled.length).toBeGreaterThan(8);
  expect(audit.delivered.length).toBeGreaterThanOrEqual(audit.scheduled.length);
  expect(audit.delivered[0]!.startFrame).toBe(0);
  for (let index = 0; index < audit.scheduled.length; index++) {
    const block = audit.delivered[index]!;
    const output = audit.scheduled[index]!;
    const frames = block.endFrame - block.startFrame;
    expect(frames).toBeGreaterThan(0);
    expect(output.rate).toBe(44100);
    expect(output.channels).toHaveLength(2);
    expect(output.channels.every(channel => channel.length === frames)).toBe(true);
    expect(output.at).toBeGreaterThanOrEqual(output.now);
    if (!index) continue;
    const previous = audit.delivered[index - 1]!;
    const previousOutput = audit.scheduled[index - 1]!;
    expect(block.startFrame).toBe(previous.endFrame);
    expect(output.at).toBeCloseTo(previousOutput.at + previousOutput.channels[0]!.length / 44100, 10);
  }
}

async function attachEvidence(audit: Audit, label: string) {
  const latency = audit.actions.map((action, index) => {
    const next = audit.actions[index + 1]?.contextTime ?? Infinity;
    const deliveredIndex = audit.delivered.findIndex((block, blockIndex) =>
      block.mask === action.mask && audit.scheduled[blockIndex] &&
      audit.scheduled[blockIndex]!.at >= action.contextTime && audit.scheduled[blockIndex]!.now >= action.contextTime &&
      audit.scheduled[blockIndex]!.now < next);
    if (deliveredIndex < 0) return {...action, superseded: true};
    return {...action, scheduledLatencyMs: (audit.scheduled[deliveredIndex]!.at - action.contextTime) * 1000};
  });
  for (let index = 0; index < latency.length; index++) {
    if (index < 4 || index === latency.length - 1) expect(latency[index]).toHaveProperty('scheduledLatencyMs');
  }
  const evidence = JSON.stringify({
    ...audit, scheduled: audit.scheduled.map(({channels, ...block}) => ({...block, frames: channels[0]!.length})), latency,
    latencyScope: 'Action to scheduled AudioContext time; excludes physical output and human perception.',
  }, null, 2);
  await test.info().attach(label, {body: evidence, contentType: 'application/json'});
  for (const result of latency) {
    if ('scheduledLatencyMs' in result) {
      expect(result.scheduledLatencyMs).toBeGreaterThanOrEqual(0);
      expect(result.scheduledLatencyMs).toBeLessThan(400);
    }
  }
  mkdirSync('build/live-voice-browser/evidence', {recursive: true});
  writeFileSync(`build/live-voice-browser/evidence/${test.info().project.name}-${label}.json`, evidence + '\n');
  console.log(`${label}: ${latency.filter(item => 'scheduledLatencyMs' in item).map(item => Math.round(item.scheduledLatencyMs!)).join(', ')} ms scheduled latency`);
}

async function assertSawOutput(audit: Audit, model: string) {
  const fixtureUrl = pathToFileURL(resolve('scripts/experiments/live-voice-replay/fixtures.mjs')).href;
  const {syntheticSid} = await import(fixtureUrl) as {
    syntheticSid: (settings: {model: string; clock: string; kind: string; chips: number; voiceMask: number}) => Uint8Array;
  };
  const factory = (await import(pathToFileURL(resolve('build/stereo-gate/output/libsidplayfp.js')).href)).default;
  const module = await factory();
  const masks = [...new Set(audit.delivered.slice(0, audit.scheduled.length).map(block => block.mask))];
  const players = masks.map(mask => {
    const player = new module.SidPlayerContext();
    expect(player.configure(44100, true)).toBe(true);
    expect(player.setEmulationConfig({
      frequency: 44100, stereo: true, c64Model: 'PAL', forceC64Model: true,
      sidModel: model, forceSidModel: true, powerOnDelay: 0, secondSidAddress: 0, thirdSidAddress: 0,
    })).toBe(true);
    expect(player.loadSidBuffer(syntheticSid({model, clock: 'PAL', kind: 'saw', chips: 2, voiceMask: mask}))).toBe(true);
    return {mask, player};
  });
  try {
    for (let index = 0; index < audit.scheduled.length; index++) {
      const block = audit.delivered[index]!;
      const output = audit.scheduled[index]!;
      for (const {mask, player} of players) {
        let expected: Int16Array;
        let empty = 0;
        do {
          expected = player.renderRaw(20000).slice();
          expect(++empty).toBeLessThan(64);
        } while (!expected.length);
        if (mask !== block.mask) continue;
        expect(expected.length).toBe(output.channels[0]!.length * 2);
        // Gate suppression is independent only for this uncoupled, unfiltered fixture (live-voice-replay/README.md).
        for (let channel = 0; channel < 2; channel++) {
          const actual = Int16Array.from(output.channels[channel]!, sample => sample * 32768);
          const channelExpected = Int16Array.from({length: actual.length}, (_, frame) => expected[frame * 2 + channel]!);
          expect(actual, `block ${index}, chip ${channel + 1}, mask ${mask}`).toEqual(channelExpected);
        }
      }
    }
  } finally {
    for (const {player} of players) player.delete();
  }
}

test('scheduled stereo PCM preserves exact selected voices and continuous output through rapid controls', async ({page}) => {
  await start(page, 'saw', 'MOS6581');
  await chooseMask(page, '[data-voice="1"][data-action="mute"]', 62);
  await chooseMask(page, '[data-voice="5"][data-action="solo"]', 16);
  await chooseMask(page, '[data-voice="5"][data-action="solo"]', 62);
  await chooseMask(page, '#full-mix', 63);
  const before = await page.evaluate(() => {
    const audit = window.__voiceBrowserAudit;
    const before = audit.scheduled.length;
    for (const [selector, mask] of [
      ['[data-voice="2"][data-action="mute"]', 61],
      ['[data-voice="4"][data-action="solo"]', 8],
      ['#full-mix', 63],
      ['[data-voice="5"][data-action="solo"]', 16],
    ] as const) {
      audit.nextActionMask = mask;
      document.querySelector<HTMLButtonElement>(selector)!.click();
    }
    return before;
  });
  await waitForMask(page, 16, before);
  const audit = await page.evaluate(() => window.__voiceBrowserAudit);
  assertContinuous(audit);
  const latest = audit.delivered.findIndex((block, index) => index >= before && block.mask === 16);
  expect(latest).toBeGreaterThanOrEqual(before);
  expect(audit.delivered.slice(latest, audit.scheduled.length).every(block => block.mask === 16)).toBe(true);
  await assertSawOutput(audit, 'MOS6581');
  await attachEvidence(audit, 'saw-output-and-control-latency');
});

test('pending audio start locks transport until the real context resumes', async ({page}) => {
  await page.addInitScript(() => {
    const resume = AudioContext.prototype.resume;
    const gate = {entered: false, release: () => {}};
    Object.assign(window, {__resumeGate: gate});
    AudioContext.prototype.resume = function () {
      gate.entered = true;
      return new Promise<void>((resolve, reject) => { gate.release = () => resume.call(this).then(resolve, reject); });
    };
  });
  await page.goto('/');
  await page.locator('#load').click();
  await expect(page.locator('#status')).toHaveText('Ready');
  await page.locator('#play').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as {__resumeGate: {entered: boolean}}).__resumeGate.entered)).toBe(true);
  await expect(page.locator('#load')).toBeDisabled();
  await expect(page.locator('#play')).toBeDisabled();
  await page.evaluate(() => (window as unknown as {__resumeGate: {release(): void}}).__resumeGate.release());
  await expect(page.locator('#status')).toHaveText('Playing');
  await expect(page.locator('#play')).toBeEnabled();
});

test('the served core stays pinned while real stereo and mono songs support pause and resume', async ({page}) => {
  const lock = JSON.parse(readFileSync('scripts/experiments/live-voice-browser/core-lock.json', 'utf8'));
  for (const name of ['libsidplayfp.js', 'libsidplayfp.wasm']) {
    const response = await page.request.get(`/engine/${name}`);
    expect(response.ok()).toBe(true);
    expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(lock.files[`build/live-voice-replay/output/${name}`]);
  }
  await start(page, 'rambo-stereo', 'MOS8580');
  await chooseMask(page, '[data-voice="5"][data-action="solo"]', 16);
  await page.screenshot({path: `build/live-voice-browser/${test.info().project.name}-playing.png`, fullPage: true});
  await page.locator('#play').click();
  await expect(page.locator('#status')).toHaveText('Paused');
  await expect.poll(() => page.evaluate(() => window.__voiceBrowserAudit.contextState)).toBe('suspended');
  const before = await page.evaluate(() => window.__voiceBrowserAudit.scheduled.length);
  await page.locator('#play').click();
  await expect(page.locator('#status')).toHaveText('Playing');
  await waitForMask(page, 16, before);
  await page.locator('#play').click();
  await expect(page.locator('#status')).toHaveText('Paused');
  await page.locator('#sample').selectOption('rambo-mono');
  await page.locator('#load').click();
  await expect(page.locator('#status')).toHaveText('Ready');
  await expect(page.locator('[data-action="solo"]')).toHaveCount(3);
  const monoStart = await page.evaluate(() => window.__voiceBrowserAudit.scheduled.length);
  await page.locator('#play').click();
  await waitForMask(page, 7, monoStart);
  await page.setViewportSize({width: 390, height: 844});
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: `build/live-voice-browser/${test.info().project.name}-narrow.png`, fullPage: true});
});

test('shared-filter audition keeps the same uninterrupted browser output timeline', async ({page}) => {
  await start(page, 'filter', 'MOS8580');
  await chooseMask(page, '[data-voice="1"][data-action="mute"]', 62);
  await chooseMask(page, '[data-voice="5"][data-action="solo"]', 16);
  await chooseMask(page, '#full-mix', 63);
  const audit = await page.evaluate(() => window.__voiceBrowserAudit);
  assertContinuous(audit);
  expect(audit.scheduled.some(block => block.channels.some(channel => channel.some(sample => sample !== 0)))).toBe(true);
  await attachEvidence(audit, 'filter-output-and-control-latency');
});

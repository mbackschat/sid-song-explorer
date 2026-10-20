import {resolve} from 'node:path';
import type {Page} from '@playwright/test';
import {test, expect} from './fixtures.ts';
import {holdWorkerRequest} from './worker-control.ts';
import {dualSid} from '../fixtures/dual-sid.ts';

async function loadStereo(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('#sample-select').selectOption('bach-toccata-stereo');
  await expect(page.locator('#chip-profile-badge')).toBeHidden();
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
}

test('dual-SID inspection and seeking retain chip ownership across responsive layout and mono replacement', async ({page}) => {
  await loadStereo(page);
  await expect(page.locator('#chip-profile-badge')).toHaveText('2 SIDs · $D400 / $D420 · stereo');
  await expect(page.locator('#routing-badge')).toHaveText('Player routing · SID 1 left / SID 2 right');
  await expect(page.locator('#routing-badge')).toBeVisible();
  await expect(page.locator('#analysis-monitor')).toContainText('L · Left');
  await expect(page.locator('#analysis-monitor')).toContainText('R · Right');
  await expect(page.locator('#analysis-monitor')).toBeVisible();
  await expect(page.locator('#peak-title')).toHaveText('Peak');
  await expect(page.locator('#rms-title')).toHaveText('RMS');
  await expect(page.locator('#waveform-plot')).toHaveAttribute('aria-label', 'Actual left output waveform');
  await expect(page.locator('#waveform-plot-right')).toHaveAttribute('aria-label', 'Actual right output waveform');
  await expect(page.locator('#spectrum-plot')).toHaveAttribute('aria-label', 'Actual left and right output frequency spectrum');
  await expect(page.locator('#chip-heading-0')).toContainText('SID 1');
  await expect(page.locator('#chip-heading-1')).toContainText('SID 2');
  await expect(page.locator('.voice-lane:visible')).toHaveCount(8);
  await expect(page.locator('.voice-tabs button:visible')).toHaveCount(6);
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(1);
  await page.locator('#inspect-3').click();
  await expect(page.locator('#filter-title')).toHaveText('SID 2 filter · its three voices');
  await expect(page.locator('#reg-frequency')).not.toHaveText('—');
  await expect(page.locator('#write-list')).toHaveAttribute('data-sid-number', '1');
  await expect(page.locator('#write-list li').first()).toContainText('SID 2 $D4');
  expect((await page.locator('#write-list li').allTextContents()).every(text => text.includes('SID 2'))).toBe(true);

  const filter = page.locator('#filter-lane-1');
  const releaseSeek = await holdWorkerRequest(page, 'seek');
  const box = (await filter.boundingBox())!;
  await filter.click({position: {x: box.width * .75, y: 20}});
  await expect(page.locator('#play-status')).toHaveText('Seeking…');
  await expect(page.locator('#filter-details')).toHaveAttribute('data-sid-number', '1');
  await expect(filter).toHaveAttribute('aria-valuetext', /seek point/);
  const marker = await filter.getAttribute('aria-valuenow');
  await expect(page.locator('#voice-lane-0')).toHaveAttribute('aria-valuenow', marker!);
  await releaseSeek();
  await expect(page.locator('#play-status')).toHaveText('Live SID');
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(Number(marker));
  await page.locator('#play-button').click();
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#sample-select').selectOption('rambo-loader-main');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect(page.locator('#chip-lanes-1')).toBeHidden();
  await expect(page.locator('.voice-tabs button:visible')).toHaveCount(3);
  await expect(page.locator('#inspect-0')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#filter-details')).toHaveAttribute('data-sid-number', '0');
  await expect(page.locator('#routing-badge')).toBeHidden();
  await expect(page.locator('#analysis-monitor')).toBeHidden();
  await expect(page.locator('#peak-title')).toHaveText('Peak · measured PCM');
});

for (const controlKind of ['mute', 'solo'] as const) {
  test(`dual-SID ${controlKind} controls apply every voice mask and restore the full mix`, async ({page}) => {
    await loadStereo(page);
    await page.locator('#play-button').click();
    await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(1);
    const voices = [0, 1, 2, 3, 4, 5];
    const selections: [string, boolean[]][] = controlKind === 'mute'
      ? [...voices.map(voice => [`mute-${voice}`, voices.map(index => index <= voice)] as [string, boolean[]]), ['restore-button', voices.map(() => false)]]
      : [...voices.map(voice => [`solo-${voice}`, voices.map(index => index !== voice)] as [string, boolean[]]), ['solo-5', voices.map(() => false)]];
    for (const [control, expectedMask] of selections) {
      const release = await holdWorkerRequest(page, 'mute');
      await page.locator(`#${control}`).click();
      await expect(page.locator('#mix-controls')).toHaveAttribute('aria-busy', 'true');
      for (let voice = 0; voice < 6; voice++) await expect(page.locator(`#mute-${voice}`)).toBeDisabled();
      await release();
      await expect(page.locator('#play-status')).toHaveText('Live SID');
      for (let voice = 0; voice < 6; voice++) await expect(page.locator(`#mute-${voice}`)).toHaveAttribute('aria-pressed', String(expectedMask[voice]));
    }
  });
}

test('local dual-SID PSID opening keeps chip inspection device-local', async ({page, baseURL}) => {
  const remoteRequests: string[] = [];
  const origin = new URL(baseURL!).origin;
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== origin && !['blob:', 'data:'].includes(url.protocol)) remoteRequests.push(url.href);
  });
  await page.goto('/');
  await page.locator('#local-file').setInputFiles(resolve('public/generated/bach-toccata-stereo.sid'));
  await expect(page.locator('#source-kind')).toContainText('Local file');
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect(page.locator('#chip-lanes-1')).toBeVisible();
  await expect(page.locator('#analysis-badge')).toHaveText('Generic inspection');
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(1);
  await page.locator('#filter-lane-1').press('ArrowRight');
  await expect(page.locator('#inspector-note')).toContainText('SID 2 shared filter');
  await expect(page.locator('#filter-details')).toHaveAttribute('data-sid-number', '1');
  await expect(page.locator('#write-list')).toHaveAttribute('data-sid-number', '1');
  expect(remoteRequests).toEqual([]);
});

test('automatic local opening rejects conflicting concrete chip models without replacing playback', async ({page}) => {
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(1);
  const before = Number(await page.locator('#seek-slider').inputValue());
  const bytes = dualSid('MOS6581');
  const header = new DataView(bytes.buffer);
  header.setUint16(118, (header.getUint16(118) & ~(3 << 6)) | (2 << 6));
  await page.locator('#local-file').setInputFiles({name: 'mixed-model.sid', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes)});
  await expect(page.locator('#status-message')).toContainText('Mixed-model playback is outside the current shared-model profile');
  await expect(page.locator('#chip-lanes-1')).toBeHidden();
  await expect(page.locator('#source-kind')).toHaveText('From the sample library');
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(before);
});

test('automatic local opening uses a concrete second-chip model and permits an intentional uniform override', async ({page}) => {
  await page.goto('/');
  for (const firstModel of [0, 3]) {
    const bytes = dualSid('MOS8580');
    const header = new DataView(bytes.buffer);
    header.setUint16(118, (header.getUint16(118) & ~(3 << 4)) | (firstModel << 4));
    await page.locator('#local-file').setInputFiles({name: `unspecified-first-${firstModel}.sid`, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes)});
    await expect(page.locator('#play-button')).toBeEnabled();
    await expect(page.locator('#model-select')).toHaveValue('MOS8580');
    await expect(page.locator('#profile-badge')).toContainText('MOS8580');
    await expect(page.locator('#chip-lanes-1')).toBeVisible();
    await page.locator('#play-button').click();
    await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(0);
  }
  await page.locator('#playback-setup > summary').click();
  await expect(page.locator('#chip-model-label')).toHaveText('Chip model · both chips');
  await page.locator('#model-select').selectOption('MOS6581');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect(page.locator('#profile-badge')).toContainText('MOS6581');
  await expect(page.locator('#chip-lanes-1')).toBeVisible();
});

for (const model of ['MOS6581', 'MOS8580'] as const) {
  test(`${model} stereo pause, restart, reload and loop re-entry preserve frame-aligned observations`, async ({page}) => {
    await page.addInitScript(() => {
      const audit = {
        renders: [] as {start: number; end: number; samples: number}[],
        seeks: [] as {frame: number; registers: number[]}[],
      };
      Object.defineProperty(window, '__stereoTransportAudit', {value: audit});
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        private methods = new Map<number, string>();
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.addEventListener('message', event => {
            const method = this.methods.get(event.data.id);
            this.methods.delete(event.data.id);
            const result = event.data.result;
            if (method === 'render' && result?.pcm) {
              audit.renders.push({start: result.startFrame, end: result.endFrame, samples: result.pcm.length});
              if (audit.renders.length > 128) audit.renders.shift();
            }
            if (method === 'seek' && result?.registers) {
              audit.seeks.push({frame: result.frame, registers: result.registers.slice()});
              if (audit.seeks.length > 32) audit.seeks.shift();
            }
          });
        }
        postMessage(message: {id: number; method: string}, options?: Transferable[] | StructuredSerializeOptions) {
          this.methods.set(message.id, message.method);
          if (Array.isArray(options)) super.postMessage(message, options);
          else super.postMessage(message, options);
        }
      };
    });
    const audit = () => page.evaluate(() => (window as unknown as {
      __stereoTransportAudit: {
        renders: {start: number; end: number; samples: number}[];
        seeks: {frame: number; registers: number[]}[];
      };
    }).__stereoTransportAudit);
    await page.goto('/');
    await page.locator('#local-file').setInputFiles({name: `${model}-transport.sid`, mimeType: 'application/octet-stream', buffer: Buffer.from(dualSid(model))});
    await expect(page.locator('#play-button')).toBeEnabled();
    await page.locator('#play-button').click();
    await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(1);
    await page.locator('#play-button').click();
    await expect(page.locator('#play-status')).toHaveText('Paused');

    const releaseRestart = await holdWorkerRequest(page, 'seek');
    await page.locator('#restart-button').click();
    await expect(page.locator('#play-status')).toHaveText('Seeking…');
    await releaseRestart();
    await expect(page.locator('#play-status')).toHaveText('Paused');
    await expect(page.locator('#seek-slider')).toHaveValue('0');
    await page.locator('#load-button').click();
    await expect(page.locator('#play-button')).toBeEnabled();
    await expect(page.locator('#play-status')).toHaveText('Ready');
    await expect(page.locator('#chip-lanes-1')).toBeVisible();
    for (let voice = 0; voice < 6; voice++) await expect(page.locator(`#mute-${voice}`)).toHaveAttribute('aria-pressed', 'false');

    await page.locator('#seek-slider').fill('0.4');
    await expect(page.locator('#play-status')).toHaveText('Paused');
    const seek = (await audit()).seeks.at(-1)!;
    expect(seek.frame).toBe(17640);
    await page.locator('#follow-button').click();
    for (const voice of [0, 3]) {
      await page.locator(`#inspect-${voice}`).click();
      const base = Math.floor(voice / 3) * 32 + voice % 3 * 7;
      const frequency = seek.registers[base] | seek.registers[base + 1] << 8;
      await expect(page.locator('#reg-frequency')).toHaveText(`$${frequency.toString(16).toUpperCase().padStart(4, '0')} · ${frequency}`);
    }
    await page.locator('#return-button').click();

    await page.locator('#loop-details > summary').click();
    await page.locator('#loop-start').fill('0.4');
    await page.locator('#loop-end').fill('0.9');
    const releaseLoopSetup = await holdWorkerRequest(page, 'seek');
    await page.locator('#loop-button').click();
    await expect(page.locator('#play-status')).toHaveText('Seeking…');
    await releaseLoopSetup();
    await expect(page.locator('#play-status')).toHaveText('Paused');
    await expect(page.locator('#loop-button')).toHaveAttribute('aria-pressed', 'true');

    const releaseLoop = await holdWorkerRequest(page, 'seek');
    await page.locator('#play-button').click();
    await expect(page.locator('#play-status')).toHaveText('Seeking…');
    await expect(page.locator('#seek-slider')).toHaveValue('0.4');
    const beforeReentry = (await audit()).renders.length;
    expect((await audit()).renders.some(block => block.end === 39690)).toBe(true);
    await releaseLoop();
    await expect.poll(async () => (await audit()).renders.slice(beforeReentry).some(block => block.start === 17640)).toBe(true);
    expect((await audit()).renders.every(block => block.samples === (block.end - block.start) * 2)).toBe(true);

    await page.locator('#play-button').click();
    await expect(page.locator('#play-status')).toHaveText('Paused');
    const releaseClear = await holdWorkerRequest(page, 'seek');
    await page.locator('#clear-loop').click();
    await expect(page.locator('#play-status')).toHaveText('Seeking…');
    await releaseClear();
    await expect(page.locator('#play-status')).toHaveText('Paused');
    await expect(page.locator('#loop-button')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#play-button').click();
    await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(1);
  });
}

import {test, expect} from './fixtures.ts';
import {resolve} from 'node:path';

const sample = resolve('public/generated/rambo-loader-main.sid');
test('live audio, held inspection, mute/solo, loop replay and complete ending', async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect(page.locator('#analysis-badge')).toContainText('Source-linked');
  await page.locator('#play-button').click();
  await expect(page.locator('#heard-time')).not.toHaveText('0:00', {timeout: 10000});
  await expect(page.locator('#peak-label')).not.toHaveText('−∞ dBFS');
  await expect(page.locator('#reg-frequency')).not.toHaveText('—');
  await expect(page.locator('#write-list')).toContainText('$D4');
  await page.screenshot({path:`build/poc/${test.info().project.name}-live.png`,fullPage:true});
  await page.locator('#follow-button').click();
  const held = await page.locator('#inspection-time').textContent();
  await page.waitForTimeout(1100);
  await expect(page.locator('#inspection-time')).toHaveText(held!);
  await page.locator('#return-button').click();
  await page.locator('#solo-0').click();
  await expect(page.locator('#mute-1')).toHaveAttribute('aria-pressed','true');
  await page.locator('#restore-button').click();
  await expect(page.locator('#mute-1')).toHaveAttribute('aria-pressed','false');
  await page.locator('#loop-start').fill('1');
  await page.locator('#loop-end').fill('2');
  await page.locator('#loop-button').click();
  await expect(page.locator('#loop-button')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#heard-time')).toHaveText('0:01', {timeout: 10000});
  await page.locator('#clear-loop').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#seek-slider').evaluate((element: HTMLInputElement) => {
    for (const position of [1.5, 2.5]) {
      element.value = String(position);
      element.dispatchEvent(new Event('change', {bubbles: true}));
    }
  });
  await expect(page.locator('#play-status')).toHaveText('Live SID');
  await expect(page.locator('#heard-time')).toHaveText('0:03');
  await page.locator('#seek-slider').fill('192.5');
  await expect(page.locator('#play-status')).toContainText('Ended', {timeout: 20000});
  expect(errors).toEqual([]);
  await page.screenshot({path: `build/poc/${test.info().project.name}-ending.png`, fullPage: true});
});

test('local file stays local and profile changes invalidate authored annotations', async ({page}) => {
  const remoteRequests: string[] = [];
  page.on('request', request => {if (!request.url().startsWith('http://127.0.0.1:4173') && !request.url().startsWith('blob:') && !request.url().startsWith('data:')) remoteRequests.push(request.url());});
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#model-select').selectOption('MOS8580');
  await page.locator('#load-button').click();
  await expect(page.locator('#analysis-badge')).toContainText('Generic');
  await expect(page.locator('#load-button')).toBeEnabled();
  await page.locator('#local-file').setInputFiles(sample);
  await expect(page.locator('#source-kind')).toContainText('Local file');
  await expect(page.locator('#analysis-badge')).toContainText('Generic');
  await page.locator('#play-button').click();
  await expect(page.locator('#heard-time')).not.toHaveText('0:00');
  await page.locator('#local-file').setInputFiles({name:'invalid.sid',mimeType:'application/octet-stream',buffer:Buffer.from('not a SID')});
  await expect(page.locator('#status-message')).toContainText('mono PSID');
  expect(remoteRequests).toEqual([]);
  await page.locator('#use-sample-button').click();
  await expect(page.locator('#source-kind')).toContainText('sample library');
  await expect(page.locator('#analysis-badge')).toContainText('Source-linked');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:`build/poc/${test.info().project.name}-mobile.png`,fullPage:true});
});

test('a short evidence annotation plays useful context while preserving its exact range', async ({page}) => {
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('[data-annotation="restored-main-entry"]').click();
  await expect(page.locator('#play-status')).toHaveText('Live SID');
  await expect(page.locator('#loop-end')).toHaveValue('4');
  await expect(page.locator('#heard-time')).toHaveText('0:02', {timeout:10000});
  await expect(page.locator('#inspector-note')).toContainText('Held');
  await page.screenshot({path:`build/poc/${test.info().project.name}-exploring.png`,fullPage:true});
});

test('voice activity follows playback at a fixed scale and freezes its held window', async ({page}) => {
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#seek-slider').fill('30');
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  const lane = page.locator('#voice-lane-0');
  const range = () => lane.evaluate(element => ({start:Number(element.getAttribute('aria-valuemin')),end:Number(element.getAttribute('aria-valuemax'))}));
  await expect.poll(async () => (await range()).start).toBeGreaterThan(20);
  const first = await range();
  expect(first.end - first.start).toBeCloseTo(10, 2);
  await expect.poll(async () => (await range()).start).toBeGreaterThan(first.start + 1);
  const moved = await range();
  expect(moved.end - moved.start).toBeCloseTo(10, 2);
  await page.locator('#follow-button').click();
  const heldRange = await range();
  const heard = await page.locator('#heard-time').textContent();
  await expect(page.locator('#heard-time')).not.toHaveText(heard!);
  expect(await range()).toEqual(heldRange);
  await page.locator('#return-button').click();
  await expect.poll(async () => (await range()).start).toBeGreaterThan(heldRange.start);
});

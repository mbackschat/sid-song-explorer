import {test, expect} from './fixtures.ts';
import {holdWorkerRequest} from './worker-control.ts';
import {dualSid, monoSid} from '../fixtures/dual-sid.ts';

test('highlights load on selection, replace playing tunes and recover from download failures', async ({page}) => {
  let downloads = 0;
  let failDownload = false;
  await page.route('https://www.hvsc.c64.org/download/C64Music/MUSICIANS/**', async route => {
    downloads++;
    const stereo = route.request().url().includes('2SID');
    await route.fulfill({
      status: failDownload ? 503 : 200,
      headers: {'Access-Control-Allow-Origin': '*'},
      body: failDownload ? 'Unavailable' : Buffer.from(stereo ? dualSid('MOS8580') : monoSid('MOS6581', 0)),
    });
  });
  await page.route('**/DOCUMENTS/Songlengths.md5', route => route.fulfill({body: '[Database]\n', headers: {'Access-Control-Allow-Origin': '*'}}));
  await page.goto('/');
  const highlights = page.getByLabel('SID highlights', {exact: true});
  await expect(highlights).toBeVisible();
  expect(await page.locator('select').evaluateAll(elements => elements.map(element => getComputedStyle(element).fontSize)))
    .toEqual(['12px', '12px', '12px', '12px', '12px']);
  await expect(highlights.locator('option')).toHaveCount(11);
  expect(downloads).toBe(0);
  const release = await holdWorkerRequest(page, 'load');
  await highlights.selectOption('h-Ch6K1h');
  await expect(highlights).toBeDisabled();
  await expect(page.locator('#play-status')).toHaveText('Loading…');
  await expect(page.locator('#browse-library')).toBeDisabled();
  await release();
  await expect(page.locator('#track-title')).toHaveText('Axel F.');
  await expect(page.locator('#play-status')).toHaveText('Ready');
  await expect(page.locator('#source-kind')).toHaveText('HVSC · SID highlight');
  await expect(page.locator('#model-select')).toHaveValue('MOS6581');
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(.25);
  await highlights.selectOption('ApA9_eLG');
  await expect(page.locator('#track-title')).toHaveText('Phonky');
  await expect(page.locator('#play-status')).toHaveText('Ready');
  await expect(page.locator('#seek-slider')).toHaveValue('0');
  await expect(page.locator('#model-select')).toHaveValue('MOS8580');
  await expect(page.locator('#chip-profile-badge')).toContainText('2 SIDs');
  await expect(page.locator('#routing-badge')).toBeVisible();
  await page.locator('#library-info > summary').click();
  await expect(page.locator('#library-info')).toContainText('Provided by HVSC');
  await expect(page.locator('#library-path')).toContainText('Phonky_2SID.sid');
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(.25);
  failDownload = true;
  await highlights.selectOption('h-Ch6K1h');
  await expect(page.locator('#status-message')).toContainText('503');
  await expect(page.locator('#track-title')).toHaveText('Phonky');
  await expect(highlights).toBeEnabled();
  await expect(highlights).toHaveValue('');
  failDownload = false;
  await highlights.selectOption('h-Ch6K1h');
  await expect(page.locator('#track-title')).toHaveText('Axel F.');
  await expect(page.locator('#play-status')).toHaveText('Ready');
  await expect(page.locator('#routing-badge')).toBeHidden();
  expect(downloads).toBe(4);
  await page.setViewportSize({width: 390, height: 844});
  expect(await highlights.evaluate(element => element.getBoundingClientRect().right <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: 'build/sid-highlights/narrow.png'});
});

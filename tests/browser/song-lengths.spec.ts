import {createHash} from 'node:crypto';
import {test, expect} from './fixtures.ts';
import {chooseFixtureWithPointer, fixtureSidBytes, installLibraryProvider, libraryPointerDiagnostics} from './library-picker-fixture.ts';
import type {Page} from '@playwright/test';

test.afterEach(async ({page}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('library-pointer-events', {
      body: JSON.stringify(await libraryPointerDiagnostics(page), null, 2),
      contentType: 'application/json',
    });
  }
});

async function openSelection(page: Page) {
  await page.locator('#browse-library').click();
  await chooseFixtureWithPointer(page, 'valid');
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect(page.locator('#source-kind')).toHaveText('SIDquake · HVSC');
}

async function playSilently(page: Page) {
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(.1);
  await page.locator('#play-button').click();
}

test('library lengths match original bytes and selected subtune while local files stay private', async ({page}) => {
  const hash = createHash('md5').update(fixtureSidBytes(2)).digest('hex');
  const provider = await installLibraryProvider(page, {subtunes:2, songlengths:`[Database]\n${hash}=1:23.456 0:45.678\n`});
  await page.goto('/');
  await page.locator('#local-file').setInputFiles('public/generated/rambo-loader-main.sid');
  await expect(page.locator('#play-button')).toBeEnabled();
  await playSilently(page);
  await expect(page.locator('#timeline-fit')).toHaveText('Fit timeline');
  expect(provider.lengthRequests()).toBe(0);
  await openSelection(page);
  await expect(page.locator('#duration-label')).toHaveText('/ 1:23');
  await expect(page.locator('#timeline-fit')).toHaveText('Fit song');
  await page.locator('#timeline-fit').click();
  await expect(page.locator('#voice-lane-0')).toHaveAttribute('aria-valuemax', '83.46');
  await expect(page.locator('#seek-slider')).toHaveAttribute('max', '83.456');
  await page.locator('#playback-setup > summary').click();
  await page.locator('#subtune-select').selectOption('2');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect(page.locator('#duration-label')).toHaveText('/ 0:45');
  await expect(page.locator('#voice-lane-0')).toHaveAttribute('aria-valuemax', '45.68');
  await expect(page.locator('#seek-slider')).toHaveAttribute('max', '45.678');
  expect(provider.lengthRequests()).toBe(1);
  await page.locator('#clock-select').selectOption('NTSC');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect(page.locator('#timeline-fit')).toHaveText('Fit timeline');
  await expect(page.locator('#duration-label')).toHaveText('/ —');
  await expect(page.locator('#duration-label')).toHaveAttribute('aria-label', 'Duration unknown');
  expect(provider.lengthRequests()).toBe(1);
  await page.locator('#local-file').setInputFiles({name:'same-library.sid', mimeType:'application/octet-stream', buffer:fixtureSidBytes(2)});
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect(page.locator('#duration-label')).toHaveText('/ —');
  await expect(page.locator('#duration-label')).toHaveAttribute('aria-label', 'Duration unknown');
  expect(provider.lengthRequests()).toBe(1);
});

test('unavailable song lengths leave library playback and Fit timeline usable', async ({page}) => {
  const provider = await installLibraryProvider(page, {songlengthStatus:503});
  await page.goto('/');
  await openSelection(page);
  await expect(page.locator('#timeline-fit')).toHaveText('Fit timeline');
  await expect(page.locator('#duration-label')).toHaveText('/ —');
  await expect(page.locator('#duration-label')).toHaveAttribute('aria-label', 'Duration unknown');
  await page.locator('#timeline-fit').click();
  await playSilently(page);
  await expect(page.locator('#play-status')).toHaveText('Paused');
  expect(provider.lengthRequests()).toBe(1);
});

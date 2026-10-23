import {test, expect} from './fixtures.ts';
import {holdWorkerRequest} from './worker-control.ts';

test('voice registers start collapsed and remain current when opened without changing playback', async ({page}) => {
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(.1);
  await page.locator('#play-button').click();
  await expect(page.locator('#play-status')).toHaveText('Paused');
  const details = page.locator('#voice-registers');
  await expect(details.locator('summary')).toHaveText('Voice registers');
  await expect(page.locator('#reg-frequency')).toBeHidden();
  const heard = await page.locator('#seek-slider').inputValue();
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({width, height: 1100});
    await expect(page.locator('#mute-0')).toBeVisible();
    await expect(page.locator('#restore-button')).toBeVisible();
    await details.locator('summary').focus();
    await details.locator('summary').press('Enter');
    await expect(page.locator('#reg-frequency')).toBeVisible();
    await expect(page.locator('#reg-frequency')).not.toHaveText('—');
    await page.locator('#inspect-1').click();
    await expect(page.locator('#inspect-1')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#reg-frequency')).toBeVisible();
    await expect(page.locator('#seek-slider')).toHaveValue(heard);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.inspector').screenshot({path: `build/inspector-details/${test.info().project.name}-${width}.png`});
    await details.locator('summary').click();
    await expect(page.locator('#reg-frequency')).toBeHidden();
  }
});

test('reload sits with playback settings while selecting a sample restores the toolbar load action', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('.unified-toolbar #load-button')).toHaveText('Load sample');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(.1);
  await page.locator('#play-button').click();
  await expect(page.locator('#play-status')).toHaveText('Paused');
  await expect(page.locator('.unified-toolbar #load-button')).toHaveCount(0);
  await page.locator('#playback-setup > summary').click();
  await expect(page.locator('#playback-setup #load-button')).toHaveText('Reload settings');
  await page.locator('#model-select').selectOption('MOS8580');
  const release = await holdWorkerRequest(page, 'load');
  await page.locator('#load-button').click();
  await expect(page.locator('#load-button')).toBeDisabled();
  await release();
  await expect(page.locator('#play-status')).toHaveText('Ready');
  await expect(page.locator('#profile-badge')).toContainText('MOS8580');
  await expect(page.locator('#seek-slider')).toHaveValue('0');
  await page.locator('#playback-setup > summary').click();
  await page.locator('#sample-select').selectOption('bach-toccata-stereo');
  await expect(page.locator('.unified-toolbar #load-button')).toBeVisible();
  await expect(page.locator('#load-button')).toHaveText('Load sample');
});

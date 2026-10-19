import {test, expect} from './fixtures.ts';
import {holdWorkerRequest} from './worker-control.ts';

test('voice changes explain the interruption beside the controls and clear feedback on completion or failure', async ({page}) => {
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThanOrEqual(1);
  const feedback = page.locator('#voice-mix-status');
  for (const control of ['mute-0', 'solo-1', 'restore-button']) {
    const releaseMute = await holdWorkerRequest(page, 'mute');
    await page.locator(`#${control}`).click();
    await expect(feedback).toHaveClass(/preparing/);
    await expect(feedback).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('#status-message')).toHaveAttribute('aria-live', 'off');
    await expect(feedback).toContainText('Sound pauses');
    await expect(feedback).toContainText('replays');
    await expect(page.locator('#play-status')).toHaveText('Preparing voices…');
    await expect(page.locator('#mix-controls')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#restore-button')).toBeDisabled();
    expect(await feedback.evaluate(element => getComputedStyle(element, '::before').animationName)).toBe('seek-spin');
    if (control === 'solo-1') {
      await page.setViewportSize({width:390, height:844});
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({path:`build/poc/${test.info().project.name}-voice-feedback.png`, fullPage:true});
    }
    await releaseMute();
    await expect(page.locator('#play-status')).toHaveText('Live SID');
    await expect(feedback).not.toHaveClass(/preparing/);
    await expect(page.locator('#status-message')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('#mix-controls')).toHaveAttribute('aria-busy', 'false');
    const heard = await page.locator('#heard-time').textContent();
    await expect(page.locator('#heard-time')).not.toHaveText(heard!);
  }
  await page.locator('#play-button').click();
  await page.emulateMedia({reducedMotion:'reduce'});
  const releasePaused = await holdWorkerRequest(page, 'mute');
  await page.locator('#mute-2').click();
  await expect(feedback).toHaveClass(/preparing/);
  expect(await feedback.evaluate(element => getComputedStyle(element, '::before').animationName)).toBe('none');
  await releasePaused();
  await expect(page.locator('#play-status')).toHaveText('Paused');
  await expect(feedback).not.toHaveClass(/preparing/);
  const releaseFailure = await holdWorkerRequest(page, 'mute');
  await page.locator('#restore-button').click();
  await expect(feedback).toHaveClass(/preparing/);
  await releaseFailure('Injected voice-mix failure');
  await expect(feedback).toContainText('Injected voice-mix failure');
  await expect(feedback).not.toHaveClass(/preparing/);
  await expect(page.locator('#mix-controls')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect(feedback).not.toContainText('failure');
});

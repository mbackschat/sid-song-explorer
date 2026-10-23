import {test, expect} from './fixtures.ts';

test.use({hasTouch: true});

test('compact inspector tip supports hover focus and tap without shifting controls or playback', async ({page}) => {
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(.1);
  await page.locator('#play-button').click();
  await expect(page.locator('#play-status')).toHaveText('Paused');
  const label = page.locator('#inspector-note');
  const trigger = page.getByRole('button', {name: 'About sound inspection'});
  const tip = page.locator('#inspector-tip');
  await expect(label).toHaveText('Following playback');
  await expect(tip).toBeHidden();
  const heard = await page.locator('#seek-slider').inputValue();
  const mixerTop = await page.locator('#mix-controls').evaluate(element => element.getBoundingClientRect().top + scrollY);
  await trigger.hover();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('not instrument identity or measured envelope amplitude');
  expect(await page.locator('#mix-controls').evaluate(element => element.getBoundingClientRect().top + scrollY)).toBe(mixerTop);
  await page.locator('#timeline-title').hover();
  await expect(tip).toBeHidden();
  await trigger.focus();
  await expect(tip).toBeVisible();
  await trigger.press('Escape');
  await expect(tip).toBeHidden();
  await trigger.press('Enter');
  await expect(tip).toBeVisible();
  await page.locator('#timeline-title').click();
  await expect(tip).toBeHidden();
  await page.locator('#follow-button').click();
  await expect(label).toHaveText(/Inspecting \d+:\d{2}\.\d{2}/);
  await expect(page.locator('#seek-slider')).toHaveValue(heard);
  await page.setViewportSize({width: 390, height: 844});
  await trigger.tap();
  await expect(tip).toBeVisible();
  expect(await tip.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= innerWidth;
  })).toBe(true);
  await page.locator('.inspector').screenshot({path: `build/recent-songs/${test.info().project.name}-tip.png`});
});

import {test, expect} from './fixtures.ts';

test('uninterrupted full Rambo playback reaches its ending', async ({page}) => {
  test.skip(!process.env.EXPLORER_FULL_SONG, 'Opt in to the 193-second real-time playback check.');
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect(page.locator('#heard-time')).toHaveText('0:02', {timeout:10000});
  await expect(page.locator('#peak-label')).not.toHaveText('−∞ dBFS');
  await expect(page.locator('#heard-time')).toHaveText('0:12', {timeout:15000});
  await page.screenshot({path:`build/poc/${test.info().project.name}-live.png`,fullPage:true});
  await expect(page.locator('#play-status')).toHaveText('Ended', {timeout:215000});
  await expect(page.locator('#heard-time')).toHaveText('3:13');
  await expect(page.locator('#history-summary')).toContainText('0 dropped writes');
  expect(errors).toEqual([]);
  await page.screenshot({path:`build/poc/${test.info().project.name}-full-song.png`,fullPage:true});
  console.log(await page.locator('#audio-diagnostics').textContent());
});

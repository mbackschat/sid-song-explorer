import {test, expect} from './fixtures.ts';

test('song metadata describes a loaded SID rather than the selected sample', async ({page}) => {
  await page.goto('./');
  await expect(page.locator('#sample-select')).toHaveValue('rambo-loader-main');
  await expect(page.locator('#track-title')).toHaveText('Choose a SID to explore');
  await expect(page.locator('#track-description')).toHaveText('Listen to a phrase, hold a moment, and see what the SID voices are doing.');
  for (const id of ['source-kind', 'profile-badge', 'chip-profile-badge', 'routing-badge', 'output-profile-badge']) {
    await expect(page.locator(`#${id}`)).toBeHidden();
  }
  await expect(page.locator('#play-status')).toHaveText('Ready to load');
  await expect(page.locator('#play-button')).toBeDisabled();

  await page.locator('#sample-select').selectOption('bach-toccata');
  await expect(page.locator('#track-title')).toHaveText('Choose a SID to explore');
  await expect(page.locator('#track-description')).toHaveText('Listen to a phrase, hold a moment, and see what the SID voices are doing.');
  await expect(page.locator('#profile-badge')).toBeHidden();
  await expect(page.locator('#play-button')).toBeDisabled();

  await page.locator('#load-button').click();
  await expect(page.locator('#track-title')).toContainText('Bach Toccata');
  await expect(page.locator('#source-kind')).toHaveText('From the sample library');
  await expect(page.locator('#source-kind')).toBeVisible();
  await expect(page.locator('#profile-badge')).toHaveText('PAL · MOS8580 · subtune 1');
  await expect(page.locator('#profile-badge')).toBeVisible();
  await expect(page.locator('#chip-profile-badge')).toHaveText('1 SID · $D400 · mono');
  await expect(page.locator('#chip-profile-badge')).toBeVisible();
  await expect(page.locator('#output-profile-badge')).toHaveText('PCM · mono');
  await expect(page.locator('#output-profile-badge')).toBeVisible();
  await page.locator('#play-button').click();
  await expect(page.locator('#heard-time')).not.toHaveText('0:00');

  await page.locator('#sample-select').selectOption('rambo-loader-main');
  await expect(page.locator('#track-title')).toContainText('Bach Toccata');
  await expect(page.locator('#profile-badge')).toHaveText('PAL · MOS8580 · subtune 1');
});

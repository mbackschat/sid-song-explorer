import {test, expect} from './fixtures.ts';

for (const [id, title, model] of [
  ['rambo-loader-main', 'Rambo loader', 'MOS6581'],
  ['bach-toccata', 'Bach Toccata', 'MOS8580'],
  ['mozart-minuet', 'Mozart', 'MOS8580'],
  ['instrument-mix', 'Original instrument mix', 'MOS8580'],
]) {
  test(`published catalog plays ${id} with its declared model`, async ({page}) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('./');
    await expect(page.locator('#sample-select option')).toHaveCount(6);
    await page.locator('#sample-select').selectOption(id);
    await expect(page.locator('#model-select')).toHaveValue(model);
    await page.locator('#load-button').click();
    await expect(page.locator('#track-title')).toContainText(title);
    await expect(page.locator('#play-button')).toBeEnabled();
    await page.locator('#play-button').click();
    await expect(page.locator('#heard-time')).not.toHaveText('0:00', {timeout:10000});
    await expect(page.locator('#peak-label')).not.toHaveText('−∞ dBFS');
    await expect(page.locator('#source-links a')).toContainText(['Sample & attribution']);
    await expect(page.getByRole('link', {name:'Stereo SID ↓', exact:true})).toHaveAttribute('href', /sid-song-crafter\/[^/]+\/samples\/.+stereo.+\.sid|sid-song-crafter\/[^/]+\/samples\/.+-stereo\.sid/);
    await expect(page.getByRole('link', {name:'Stereo WAV ↗', exact:true})).toHaveAttribute('href', /\.wav$/);
    if (id !== 'rambo-loader-main') {
      await expect(page.locator('#analysis-badge')).toHaveText('Generic inspection');
      await expect(page.locator('#evidence-cards')).toContainText('without annotations');
      await expect(page.getByRole('link', {name:'Sample player notices ↓', exact:true})).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}

test('catalog separates local-build materials from playable downloads', async ({page}) => {
  await page.goto('./');
  await page.locator('#local-build-materials summary').click();
  await expect(page.locator('#local-build-materials a')).toHaveText(['Moon River', 'Pink Panther', 'Axel F', 'Ghostbusters']);
  await expect(page.locator('#local-build-materials')).toContainText('No audio download');
  await expect(page.locator('#sample-select')).not.toContainText('Moon River');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect(page.locator('#heard-time')).not.toHaveText('0:00');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

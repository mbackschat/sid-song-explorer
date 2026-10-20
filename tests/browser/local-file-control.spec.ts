import {readFileSync} from 'node:fs';
import {test, expect} from './fixtures.ts';

test('local SID control has a regular button and a visible working drop target', async ({page}, testInfo) => {
  await page.goto('/');
  const open = page.getByRole('button', {name: 'Open SID file', exact: true});
  const drop = page.locator('#local-drop-target');
  await expect(open).toBeVisible();
  await expect(drop).toContainText('or drop a SID file here');
  const font = (selector: string) => page.locator(selector).evaluate(element => getComputedStyle(element).fontSize);
  expect(await font('#open-local-file')).toBe(await font('#browse-library'));
  await page.locator('.local-section').screenshot({path: testInfo.outputPath('open-file-desktop.png')});

  const chooser = page.waitForEvent('filechooser');
  await open.click();
  await (await chooser).setFiles('public/generated/rambo-loader-main.sid');
  await expect(page.locator('#source-kind')).toHaveText('Local file · rambo-loader-main.sid');
  await expect(page.locator('#play-button')).toBeEnabled();

  const bytes = [...readFileSync('public/generated/bach-toccata.sid')];
  const transfer = await page.evaluateHandle(bytes => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'dropped-bach.sid'));
    return transfer;
  }, bytes);
  await drop.dispatchEvent('dragover', {dataTransfer: transfer});
  await expect(drop).toHaveClass(/drop-active/);
  await drop.dispatchEvent('drop', {dataTransfer: transfer});
  await expect(drop).not.toHaveClass(/drop-active/);
  await expect(page.locator('#source-kind')).toHaveText('Local file · dropped-bach.sid');
  await expect(page.locator('#track-title')).toContainText('Toccata');
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(.2);
  await page.locator('#play-button').click();

  await page.setViewportSize({width: 390, height: 844});
  await expect(open).toBeVisible();
  const targetBounds = await drop.boundingBox();
  const browseBounds = await page.locator('#browse-library').boundingBox();
  expect(targetBounds!.y + targetBounds!.height + 8).toBeLessThanOrEqual(browseBounds!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.local-section').screenshot({path: testInfo.outputPath('open-file-narrow.png')});
});

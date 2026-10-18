import {test, expect} from './fixtures.ts';

test('trace loss is visible and remains attached to held inspection across a seek', async ({page}) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        let injected = false;
        this.addEventListener('message', event => {
          if (!injected && event.data.result?.pcm) {
            event.data.result.dropped = 7;
            injected = true;
          }
        });
      }
    };
  });
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect(page.locator('#trace-warning')).toBeHidden();
  await page.locator('#play-button').click();
  await expect(page.locator('#trace-warning')).toBeVisible();
  await expect(page.locator('#trace-warning')).toContainText('7 dropped writes');
  await page.locator('#follow-button').click();
  await page.locator('#seek-slider').fill('10');
  await expect(page.locator('#play-status')).toHaveText('Live SID');
  await expect(page.locator('#trace-warning')).toContainText('7 dropped writes');
  await page.locator('#return-button').click();
  await expect(page.locator('#trace-warning')).toBeHidden();
  await page.locator('#play-button').click();
});

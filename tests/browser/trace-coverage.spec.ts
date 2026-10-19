import {test, expect} from './fixtures.ts';

test('trace loss remains attached to held inspection while a newer chart is browsed', async ({page}) => {
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
  const selected = await page.locator('#inspection-time').textContent();
  const writes = await page.locator('#write-list').textContent();
  await page.locator('#seek-slider').fill('10');
  await expect(page.locator('#play-status')).toHaveText('Live SID');
  await expect(page.locator('#trace-warning')).toContainText('7 dropped writes');
  const scrollbar = page.getByRole('scrollbar', {name:'Browse timeline'});
  await scrollbar.focus();
  await scrollbar.press('PageDown');
  await expect(page.locator('#history-summary')).toHaveAttribute('title', /PREPARED OBSERVATIONS.*0 dropped writes/);
  await expect(page.locator('#trace-warning')).toBeVisible();
  await expect(page.locator('#trace-warning')).toHaveText('Held inspection trace incomplete: 7 dropped writes.');
  await expect(page.locator('#inspection-time')).toHaveText(selected!);
  await expect(page.locator('#write-list')).toHaveText(writes!);
  await page.locator('#return-button').click();
  await expect(page.locator('#trace-warning')).toBeHidden();
  await page.locator('#play-button').click();
});

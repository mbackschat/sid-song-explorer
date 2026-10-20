import {test, expect} from './fixtures.ts';
import {holdWorkerRequest} from './worker-control.ts';

test('first Fit song view late in stereo Rambo retains the rendered beginning after audio eviction', async ({page}) => {
  await page.goto('/');
  await page.locator('#sample-select').selectOption('rambo-stereo-main');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(.1);
  await page.locator('#play-button').click();
  await expect(page.locator('#timeline-scroll')).toHaveAttribute('aria-pressed', 'true');
  const release = await holdWorkerRequest(page, 'seek');
  await page.locator('#seek-slider').fill('146.26');
  await expect(page.locator('#play-status')).toHaveText('Seeking…');
  await release();
  await expect(page.locator('#play-status')).toHaveText('Paused', {timeout:20000});
  await expect(page.locator('#render-lead')).not.toContainText('Prepared 0:00');
  await page.locator('#timeline-fit').click();
  const lane = page.locator('#voice-lane-0');
  await expect(lane).toHaveAttribute('data-observed-start', '0');
  await expect.poll(() => lane.getAttribute('data-observed-until').then(Number)).toBeGreaterThanOrEqual(146.26);
  const earlyPitchPixels = await lane.evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, Math.floor(canvas.width / 4), canvas.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 1]! > 130 && pixels[index + 2]! > 130 && pixels[index]! < pixels[index + 1]! * .7) count++;
    }
    return count;
  });
  expect(earlyPitchPixels).toBeGreaterThan(100);
  await page.screenshot({path:`build/fit-song/${test.info().project.name}-late-rambo.png`, fullPage:true});
});

test('Fit song keeps the full range through seeks and playback and inspects prepared future activity', async ({page}) => {
  await page.goto('/');
  await page.locator('#sample-select').selectOption('bach-toccata-stereo');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(.1);
  await page.locator('#play-button').click();
  await page.locator('#timeline-fit').click();
  await expect(page.locator('#timeline-fit')).toHaveText('Fit song');
  const lane = page.locator('#voice-lane-0');
  const range = () => lane.evaluate(element => ({start:Number(element.getAttribute('aria-valuemin')), end:Number(element.getAttribute('aria-valuemax'))}));
  const duration = Number(await page.locator('#seek-slider').getAttribute('max'));
  expect(await range()).toEqual({start:0, end:Number(duration.toFixed(2))});
  await expect.poll(() => lane.getAttribute('data-observed-until').then(Number)).toBeGreaterThan(20);
  await expect.poll(() => lane.getAttribute('data-future-frames').then(Number)).toBeGreaterThan(10);
  const capturedStart = Number(await lane.getAttribute('data-observed-start'));
  const capturedEnd = Number(await lane.getAttribute('data-observed-until'));
  const box = (await lane.boundingBox())!;
  const target = 15;
  await lane.click({position:{x:box.width * target / duration,y:20}, modifiers:['Shift']});
  await expect(page.locator('#reg-frequency')).not.toHaveText('—');
  await expect(page.locator('#inspector-note')).toContainText('Prepared ahead of playback when held');
  const selected = await page.locator('#inspection-time').textContent();
  const settings = await page.locator('#reg-frequency').textContent();
  await page.locator('#timeline-scroll').click();
  await expect(page.locator('#inspection-time')).toHaveText(selected!);
  await expect(page.locator('#reg-frequency')).toHaveText(settings!);
  await page.locator('#timeline-fit').click();
  const before = await range();
  const release = await holdWorkerRequest(page, 'seek');
  await lane.click({position:{x:box.width * 10 / duration,y:20}});
  await expect(page.locator('#play-status')).toHaveText('Seeking…');
  await release();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeCloseTo(10, 0);
  expect(await range()).toEqual(before);
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(11);
  expect(await range()).toEqual(before);
  expect(Number(await lane.getAttribute('data-observed-start'))).toBeLessThanOrEqual(capturedStart);
  expect(Number(await lane.getAttribute('data-observed-until'))).toBeGreaterThanOrEqual(capturedEnd);
  await page.locator('#play-button').click();
  await page.screenshot({path:`build/fit-song/${test.info().project.name}.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await range()).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Fit timeline labels the fixed range when a local file has no duration', async ({page}) => {
  await page.goto('/');
  await page.locator('#local-file').setInputFiles('public/generated/rambo-loader-main.sid');
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(.1);
  await page.locator('#play-button').click();
  await page.locator('#timeline-fit').click();
  await expect(page.locator('#timeline-fit')).toHaveText('Fit timeline');
  await expect(page.locator('#timeline-view-note')).toHaveText('Length unknown · click Fit timeline to update');
  const lane = page.locator('#voice-lane-0');
  await expect(lane).toHaveAttribute('aria-valuemin','0.00');
  await expect(lane).toHaveAttribute('aria-valuemax','30.00');
  await expect.poll(() => lane.getAttribute('data-future-frames').then(Number)).toBeGreaterThan(10);
  await expect(page.locator('#timeline-scroll-track')).toHaveAttribute('aria-disabled','true');
});

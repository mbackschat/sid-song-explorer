import {test, expect} from './fixtures.ts';
import {holdWorkerRequest} from './worker-control.ts';
import type {Page} from '@playwright/test';

async function openPaused(page: Page) {
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(.1);
  await page.locator('#play-button').click();
}

async function chart(page: Page) {
  return page.locator('#voice-lane-0').evaluate(element => ({
    start: Number(element.getAttribute('aria-valuemin')),
    end: Number(element.getAttribute('aria-valuemax')),
    cursor: Number(element.getAttribute('aria-valuenow')),
    observedStart: Number((element as HTMLElement).dataset.observedStart),
    observedUntil: Number((element as HTMLElement).dataset.observedUntil),
    futureFrames: Number((element as HTMLElement).dataset.futureFrames),
  }));
}

test('timeline zoom preserves density on resize and holds selected observations', async ({page}) => {
  await openPaused(page);
  await expect(page.getByRole('button', {name:'Zoom out', exact:true})).toBeVisible();
  await page.locator('#seek-slider').fill('30');
  await expect.poll(async () => (await chart(page)).cursor).toBe(30);
  const lane = page.locator('#voice-lane-0');
  const width = () => lane.evaluate(element => element.clientWidth);
  const initial = await chart(page);
  expect(initial.end - initial.start).toBeCloseTo(await width() / 64, 1);
  await page.getByRole('button', {name:'Zoom out', exact:true}).click();
  await expect.poll(async () => { const value = await chart(page); return value.end - value.start; }).toBeCloseTo(await width() / 32, 1);
  await expect(page.getByRole('button', {name:'Zoom out', exact:true})).toBeEnabled();
  await page.getByRole('button', {name:'Zoom out', exact:true}).click();
  await expect.poll(async () => { const value = await chart(page); return value.end - value.start; }).toBeCloseTo(await width() / 16, 1);
  await expect(page.getByRole('button', {name:'Zoom out', exact:true})).toBeDisabled();
  await page.getByRole('button', {name:'Zoom in', exact:true}).click();
  await expect.poll(async () => { const value = await chart(page); return value.observedUntil - value.end; }).toBeGreaterThan(.5);
  await page.setViewportSize({width:2200, height:1100});
  await expect.poll(async () => { const value = await chart(page); return (value.end - value.start) / await width(); }).toBeCloseTo(1 / 32, 4);
  expect((await chart(page)).cursor).toBe(30);
  await page.setViewportSize({width:1440, height:1100});
  await page.screenshot({path:`build/timeline-zoom/${test.info().project.name}-wide.png`, fullPage:true});
  await page.getByRole('button', {name:'Zoom in', exact:true}).click();
  await expect.poll(async () => { const value = await chart(page); return value.end - value.start; }).toBeCloseTo(await width() / 64, 1);
  const box = (await lane.boundingBox())!;
  await lane.click({position:{x:box.width * .65, y:20}, modifiers:['Shift']});
  await expect(page.locator('#reg-frequency')).not.toHaveText('—');
  const selected = await chart(page);
  const settings = await page.locator('#write-list').textContent();
  for (const density of [128, 256, 512, 1024]) {
    await page.getByRole('button', {name:'Zoom in', exact:true}).click();
    await expect.poll(async () => { const value = await chart(page); return value.end - value.start; }).toBeCloseTo(await width() / density, 1);
  }
  await expect(page.getByRole('button', {name:'Zoom in', exact:true})).toBeDisabled();
  await expect(page.locator('#timeline-start')).toHaveText(/^\d+:\d{2}\.\d{2}$/);
  await expect(page.locator('#timeline-end')).toHaveText(/^\d+:\d{2}\.\d{2}$/);
  const detail = await chart(page);
  expect(detail.end - detail.start).toBeCloseTo(await width() / 1024, 1);
  expect((detail.start + detail.end) / 2).toBeCloseTo(selected.cursor, 1);
  await expect(page.locator('#write-list')).toHaveText(settings!);
  await page.locator('#timeline-fit').click();
  await expect(page.getByRole('group', {name:'Timeline zoom'})).toBeHidden();
  await page.locator('#timeline-scroll').click();
  await expect(page.getByRole('button', {name:'Zoom in', exact:true})).toBeDisabled();
  await page.locator('#return-button').click();
  await page.setViewportSize({width:390, height:844});
  await expect.poll(async () => { const value = await chart(page); return (value.end - value.start) / await width(); }).toBeCloseTo(1 / 1024, 4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:`build/timeline-zoom/${test.info().project.name}-extended-narrow.png`, fullPage:true});
});

test('prepared upcoming activity stays filled between refreshes during playback and after seeking', async ({page}) => {
  await openPaused(page);
  await expect.poll(() => page.locator('#render-lead').getAttribute('data-prepared-until').then(Number), {timeout:25000}).toBeGreaterThan(70);
  for (const target of [30, 60]) {
    if (target === 60) await page.getByRole('button', {name:'Zoom out', exact:true}).click();
    await page.locator('#seek-slider').fill(String(target));
    await expect.poll(async () => (await chart(page)).cursor).toBeCloseTo(target, 2);
    await expect.poll(async () => { const value = await chart(page); return value.observedUntil - value.end; }).toBeGreaterThan(.5);
    await page.locator('#play-button').click();
    const coverage = await page.evaluate(async () => {
      const lane = document.querySelector<HTMLElement>('#voice-lane-0')!;
      const start = Number(lane.getAttribute('aria-valuenow'));
      const deadline = performance.now() + 8000;
      let minimum = Infinity;
      let samples = 0;
      let latest = start;
      while (latest < start + 3 && performance.now() < deadline) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        latest = Number(lane.getAttribute('aria-valuenow'));
        if (latest > start) {
          minimum = Math.min(minimum, Number(lane.dataset.observedUntil) - Number(lane.getAttribute('aria-valuemax')));
          samples++;
        }
      }
      return {minimum, samples, advanced:latest - start};
    });
    console.log(`${test.info().project.name}: preview coverage at ${target}s`, coverage);
    expect(coverage.advanced).toBeGreaterThanOrEqual(3);
    expect(coverage.samples).toBeGreaterThan(10);
    expect(coverage.minimum, 'the visible right edge must not outrun already prepared observations between refreshes').toBeGreaterThanOrEqual(-.001);
    await expect(page.locator('#audio-diagnostics')).toContainText('0 buffer underruns');
    await page.locator('#play-button').click();
  }
});

test('centered timeline shows actual upcoming activity and holds future inspection independently', async ({page}) => {
  await openPaused(page);
  await page.locator('#seek-slider').fill('30');
  await expect.poll(async () => (await chart(page)).observedUntil).toBeGreaterThanOrEqual(34.9);
  const view = await chart(page);
  expect(view.end - view.start).toBeCloseTo(await page.locator('#voice-lane-0').evaluate(element => element.clientWidth / 64), 1);
  expect((view.cursor - view.start) / (view.end - view.start)).toBeCloseTo(.5, 3);
  expect(view.futureFrames).toBeGreaterThan(10);
  const futureStroke = await page.locator('#voice-lane-0').evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let y = Math.floor(canvas.height * .2); y < canvas.height * .85; y++) {
      for (let x = Math.floor(canvas.width * .6); x < canvas.width * .9; x++) {
        const offset = (y * canvas.width + x) * 4;
        if (Math.abs(pixels[offset] - 110) < 35 && Math.abs(pixels[offset + 1] - 224) < 35 && Math.abs(pixels[offset + 2] - 222) < 35) return true;
      }
    }
    return false;
  });
  expect(futureStroke, 'a real voice-frequency stroke is drawn to the right of heard time').toBe(true);
  await page.screenshot({path:`build/timeline-preview/${test.info().project.name}-centered.png`, fullPage:true});

  const lane = page.locator('#voice-lane-0');
  const box = (await lane.boundingBox())!;
  await lane.click({position:{x:box.width * .75, y:20}, modifiers:['Shift']});
  await expect(page.locator('#inspector-note')).toContainText('Prepared ahead of playback when held');
  await expect(page.locator('#reg-frequency')).not.toHaveText('—');
  const captured = await page.locator('#write-list').textContent();
  const selection = await page.locator('#inspection-time').textContent();
  await page.locator('#timeline-fit').click();
  const fittedHeld = await chart(page);
  expect(fittedHeld.observedStart).toBeGreaterThanOrEqual(30);
  expect(fittedHeld.observedUntil).toBeCloseTo(30, 2);
  expect(fittedHeld.futureFrames).toBe(0);
  await expect(page.locator('#write-list')).toHaveText(captured!);
  await page.locator('#timeline-scroll').click();
  await page.locator('#play-button').click();
  const [minutes, seconds] = selection!.split(':').map(Number);
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(minutes * 60 + seconds + .1);
  await expect(page.locator('#inspection-time')).toHaveText(selection!);
  await expect(page.locator('#write-list')).toHaveText(captured!);
  await expect(page.locator('#inspector-note')).toContainText('Prepared ahead of playback when held');
  await page.locator('#play-button').click();
  await page.locator('#seek-slider').fill('60');
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect(page.locator('#write-list')).toHaveText(captured!);
  await page.locator('#return-button').click();
  await expect.poll(async () => (await chart(page)).observedUntil).toBeGreaterThanOrEqual(64.9);
  await page.locator('#timeline-fit').click();
  expect((await chart(page)).futureFrames).toBe(0);
  await expect(page.locator('#timeline-availability')).toHaveText('Only heard observations are shown.');
  await page.locator('#timeline-scroll').click();
  await page.setViewportSize({width:390, height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const narrow = await chart(page);
  expect((narrow.cursor - narrow.start) / (narrow.end - narrow.start)).toBeCloseTo(.5, 3);
  await page.screenshot({path:`build/timeline-preview/${test.info().project.name}-narrow.png`, fullPage:true});
});

test('centered timeline shades unavailable startup ending and loop regions and invalidates pending mixes', async ({page}) => {
  await openPaused(page);
  await page.locator('#seek-slider').fill('0');
  await expect.poll(async () => (await chart(page)).observedUntil).toBeGreaterThanOrEqual(4.9);
  const startup = await chart(page);
  const halfSpan = await page.locator('#voice-lane-0').evaluate(element => element.clientWidth / 64 / 2);
  expect(startup).toMatchObject({cursor:0, observedStart:0});
  expect(startup.start).toBeCloseTo(-halfSpan, 1);
  expect(startup.end).toBeCloseTo(halfSpan, 1);
  const lane = page.locator('#voice-lane-0');
  const box = (await lane.boundingBox())!;
  await lane.click({position:{x:box.width * .25, y:20}, modifiers:['Shift']});
  await expect(page.locator('#reg-frequency')).toHaveText('—');
  await expect(page.locator('#write-list')).toContainText('No retained writes');
  await page.locator('#return-button').click();

  const duration = Number(await page.locator('#seek-slider').getAttribute('max'));
  await expect.poll(() => page.locator('#render-lead').getAttribute('data-prepared-until').then(Number), {timeout:25000}).toBeGreaterThan(duration - .001);
  await page.locator('#seek-slider').fill((Math.floor(duration * 100) / 100).toFixed(2));
  await expect.poll(async () => (await chart(page)).cursor).toBeCloseTo(duration - .01, 1);
  await expect.poll(async () => (await chart(page)).observedUntil).toBeGreaterThan(duration - .1);
  const ending = await chart(page);
  expect(ending.observedUntil).toBeLessThanOrEqual(duration);
  expect(ending.end).toBeGreaterThan(duration + 4);

  await page.locator('#loop-details > summary').click();
  await page.locator('#loop-start').fill('30');
  await page.locator('#loop-end').fill('32');
  await page.locator('#loop-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#seek-slider').fill('31');
  await expect.poll(async () => (await chart(page)).observedUntil).toBeCloseTo(32, 2);
  await expect(page.locator('#timeline-availability')).toContainText('Loop returns to 0:30.00 at 0:32.00');
  expect((await chart(page)).end).toBeCloseTo(31 + halfSpan, 1);
  await lane.focus();
  await lane.press('Shift+ArrowRight');
  await expect(page.locator('#reg-frequency')).toHaveText('—');
  await page.locator('#return-button').click();

  const release = await holdWorkerRequest(page, 'mute');
  await page.locator('#solo-0').click();
  await expect(page.locator('#mix-controls')).toHaveAttribute('aria-busy', 'true');
  expect((await chart(page)).futureFrames).toBe(0);
  await release();
  await expect(page.locator('#mix-controls')).toHaveAttribute('aria-busy', 'false');
  await expect.poll(async () => (await chart(page)).observedUntil).toBeCloseTo(32, 2);
  await expect(page.locator('#solo-0')).toHaveAttribute('aria-pressed', 'true');
});

import {test, expect} from './fixtures.ts';
import {holdWorkerRequest} from './worker-control.ts';

async function openPaused(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(.1);
  await page.locator('#play-button').click();
}

test('unified panel scrolls proportionally without seeking and its ruler seeks explicitly', async ({page}) => {
  await openPaused(page);
  const panel = page.locator('#timeline-panel');
  await expect(panel.locator('#play-button')).toBeVisible();
  await expect(panel.locator('#voice-lane-0')).toBeVisible();
  const bar = page.getByRole('scrollbar', {name:'Browse timeline'});
  await expect(bar).toBeVisible();
  const geometry = () => bar.evaluate(element => ({
    total:Number(element.getAttribute('data-total')),
    span:Number(element.getAttribute('data-span')),
    start:Number(element.getAttribute('aria-valuenow')),
    fraction:parseFloat((element.querySelector('#timeline-scroll-thumb') as HTMLElement).style.width) / 100,
  }));
  const initial = await geometry();
  expect(initial.fraction).toBeCloseTo(initial.span / initial.total, 6);
  await page.locator('#timeline-zoom-in').click();
  await expect.poll(async () => (await geometry()).fraction).toBeCloseTo(initial.fraction / 2, 6);
  const heard = Number(await page.locator('#seek-slider').inputValue());
  await bar.focus();
  await page.keyboard.press('End');
  const end = await geometry();
  expect(end.start).toBeCloseTo(end.total - end.span, 2);
  expect(Number(await page.locator('#seek-slider').inputValue())).toBeCloseTo(heard, 2);
  await page.keyboard.press('Home');
  expect((await geometry()).start).toBe(0);
  const track = (await bar.boundingBox())!;
  const thumb = (await page.locator('#timeline-scroll-thumb').boundingBox())!;
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  await page.mouse.move(thumb.x + thumb.width / 2 + track.width * .15, thumb.y + thumb.height / 2, {steps:4});
  await page.mouse.up();
  await expect.poll(async () => (await geometry()).start).toBeGreaterThan(20);
  expect(Number(await page.locator('#seek-slider').inputValue())).toBeCloseTo(heard, 2);
  const lane = page.locator('#voice-lane-0');
  const target = await lane.evaluate(element => (Number(element.getAttribute('aria-valuemin')) + Number(element.getAttribute('aria-valuemax'))) / 2);
  const ruler = (await page.locator('#seek-slider').boundingBox())!;
  await page.mouse.click(ruler.x + ruler.width / 2, ruler.y + ruler.height / 2);
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeCloseTo(target, 1);
  await page.locator('#play-button').click();
  await bar.focus();
  await page.keyboard.press('PageDown');
  const browsed = (await geometry()).start;
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(target + .5);
  expect((await geometry()).start).toBeCloseTo(browsed, 2);
  await page.locator('#return-button').click();
  await expect.poll(async () => lane.evaluate(element => {
    const start = Number(element.getAttribute('aria-valuemin'));
    const end = Number(element.getAttribute('aria-valuemax'));
    const heard = Number((document.querySelector('#seek-slider') as HTMLInputElement).value);
    return Math.abs((start + end) / 2 - heard);
  })).toBeLessThan(.1);
  await expect(page.locator('#audio-diagnostics')).toContainText('0 buffer underruns');
  await page.screenshot({path:`build/unified-panel/${test.info().project.name}-desktop.png`, fullPage:true});
});

test('unified panel preserves held inspection while browsing and fits a narrow screen', async ({page}) => {
  await openPaused(page);
  await page.locator('#seek-slider').fill('30');
  const lane = page.locator('#voice-lane-0');
  await expect.poll(() => lane.getAttribute('data-observed-until').then(Number)).toBeGreaterThan(32);
  const box = (await lane.boundingBox())!;
  await lane.click({position:{x:box.width * .6,y:20},modifiers:['Shift']});
  const selected = await page.locator('#inspection-time').textContent();
  const writes = await page.locator('#write-list').textContent();
  await page.getByRole('scrollbar', {name:'Browse timeline'}).focus();
  await page.keyboard.press('PageDown');
  await expect(page.locator('#inspection-time')).toHaveText(selected!);
  await expect(page.locator('#write-list')).toHaveText(writes!);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#play-button')).toBeVisible();
  await expect(page.locator('#timeline-scroll-track')).toBeVisible();
  await expect(page.locator('#playback-setup')).not.toHaveAttribute('open', '');
  await page.locator('#playback-setup > summary').click();
  await expect(page.locator('#clock-select')).toBeVisible();
  await page.locator('#playback-setup > summary').click();
  await page.locator('#loop-details > summary').click();
  await expect(page.locator('#loop-start')).toBeVisible();
  await page.locator('#loop-details > summary').click();
  await page.screenshot({path:`build/unified-panel/${test.info().project.name}-narrow.png`, fullPage:true});
});

test('dragging continuously keeps prepared timeline content visible before releasing the thumb', async ({page}) => {
  await openPaused(page);
  await expect.poll(() => page.locator('#render-lead').getAttribute('data-prepared-until').then(Number), {timeout:25000}).toBeGreaterThan(90);
  await page.locator('#seek-slider').fill('30');
  const lane = page.locator('#voice-lane-0');
  await expect.poll(() => lane.getAttribute('data-observed-until').then(Number)).toBeGreaterThan(35);
  const thumb = (await page.locator('#timeline-scroll-thumb').boundingBox())!;
  const track = (await page.locator('#timeline-scroll-track').boundingBox())!;
  const heard = await page.locator('#seek-slider').inputValue();
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  let minimumCoverage = Infinity;
  let updates = 0;
  let previousStart = -Infinity;
  for (let step = 1; step <= 60; step++) {
    await page.mouse.move(thumb.x + thumb.width / 2 + track.width * .08 * step / 60, thumb.y + thumb.height / 2);
    const frame = await lane.evaluate(async element => {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const start = Number(element.getAttribute('aria-valuemin'));
      const end = Number(element.getAttribute('aria-valuemax'));
      return {start, coverage:Math.min(Number((element as HTMLElement).dataset.observedUntil) - end, start - Number((element as HTMLElement).dataset.observedStart))};
    });
    minimumCoverage = Math.min(minimumCoverage, frame.coverage);
    if (frame.start > previousStart) updates++;
    previousStart = frame.start;
  }
  // WebKit delivers integer CSS-pixel pointer coordinates; subpixel steps can share a position.
  expect(updates).toBeGreaterThanOrEqual(Math.min(60, Math.floor(track.width * .08)) - 1);
  expect(minimumCoverage, 'cached content must cover every visible frame throughout a held drag').toBeGreaterThanOrEqual(-.02);
  expect(await page.locator('#seek-slider').inputValue()).toBe(heard);
  await page.screenshot({path:`build/unified-panel/${test.info().project.name}-dragging.png`,fullPage:true});
  await page.mouse.up();
});

test('an ending thumb moves immediately and ruler dragging seeks only on release', async ({page}) => {
  await openPaused(page);
  const duration = Number(await page.locator('#seek-slider').getAttribute('max'));
  await expect.poll(() => page.locator('#render-lead').getAttribute('data-prepared-until').then(Number), {timeout:25000}).toBeGreaterThan(duration - .001);
  await page.locator('#seek-slider').fill((Math.floor(duration * 100) / 100).toFixed(2));
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(duration - .1);
  const bar = page.locator('#timeline-scroll-track');
  const track = (await bar.boundingBox())!;
  const thumb = (await page.locator('#timeline-scroll-thumb').boundingBox())!;
  const maximum = Number(await bar.getAttribute('aria-valuemax'));
  const delta = (track.width - thumb.width) * .01;
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  await page.mouse.move(thumb.x + thumb.width / 2 - delta, thumb.y + thumb.height / 2);
  await page.mouse.up();
  expect(Number(await bar.getAttribute('aria-valuenow'))).toBeCloseTo(maximum * .99, 0);
  await bar.focus();
  await page.keyboard.press('Home');
  const heard = await page.locator('#seek-slider').inputValue();
  const releaseSeek = await holdWorkerRequest(page, 'seek');
  const ruler = (await page.locator('#seek-slider').boundingBox())!;
  await page.mouse.move(ruler.x + ruler.width * .25, ruler.y + ruler.height / 2);
  await page.mouse.down();
  await page.mouse.move(ruler.x + ruler.width * .75, ruler.y + ruler.height / 2);
  await expect(page.locator('#play-status')).toHaveText('Paused');
  await expect(page.locator('#audio-diagnostics')).toContainText('0 buffer underruns');
  const target = Number(await page.locator('#seek-slider').inputValue());
  expect(target).toBeLessThan(Number(heard));
  await page.mouse.up();
  await expect(page.locator('#play-status')).toHaveText('Seeking…');
  await releaseSeek();
  await expect(page.locator('#play-status')).toHaveText('Paused');
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeCloseTo(target, 1);
  await page.locator('#seek-slider').focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(target);
});


test('routine playback hides duplicate instruction rows while held and pending details remain visible', async ({page}) => {
  await openPaused(page);
  await expect(page.locator('#status-message')).toBeHidden();
  await expect(page.locator('#history-summary')).toBeHidden();
  await page.locator('#play-button').click();
  await expect(page.locator('#status-message')).toBeHidden();
  await page.locator('#follow-button').click();
  await expect(page.locator('#history-summary')).toBeVisible();
  await expect(page.locator('#history-summary')).toContainText('Inspecting');
  await page.locator('#return-button').click();
  await expect(page.locator('#history-summary')).toBeHidden();
  const releaseSeek = await holdWorkerRequest(page, 'seek');
  await page.locator('#seek-slider').fill('20');
  await expect(page.locator('#status-message')).toBeVisible();
  await expect(page.locator('#status-message')).toContainText('Seeking to');
  await releaseSeek();
  await expect(page.locator('#play-status')).toHaveText('Live SID');
  await expect(page.locator('#status-message')).toBeHidden();
});


test('timeline clicks seek playback while Shift-click and Hold inspect without seeking', async ({page}) => {
  await openPaused(page);
  await page.locator('#seek-slider').fill('30');
  for (const id of ['voice-lane-0', 'filter-lane']) {
    const lane = page.locator('#' + id);
    await expect.poll(() => lane.getAttribute('data-observed-until').then(Number)).toBeGreaterThan(32);
    const box = (await lane.boundingBox())!;
    const before = Number(await page.locator('#seek-slider').inputValue());
    await lane.click({position:{x:box.width * .25,y:20},modifiers:['Shift']});
    await expect(page.locator('#inspector-title')).toHaveText('Held sound inspector');
    expect(Number(await page.locator('#seek-slider').inputValue())).toBe(before);
    const target = await lane.evaluate(element => {
      const start = Number(element.getAttribute('aria-valuemin'));
      return start + (Number(element.getAttribute('aria-valuemax')) - start) * .75;
    });
    await lane.click({position:{x:box.width * .75,y:20}});
    await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeCloseTo(target,1);
    await expect(page.locator('#inspector-title')).toHaveText('Sound inspector');
    await expect(page.locator('#play-status')).toHaveText('Paused');
  }
  const before = await page.locator('#seek-slider').inputValue();
  await page.locator('#follow-button').click();
  await expect(page.locator('#inspector-title')).toHaveText('Held sound inspector');
  expect(await page.locator('#seek-slider').inputValue()).toBe(before);
  await expect(page.locator('#trace-navigation-note')).toHaveCount(0);
});

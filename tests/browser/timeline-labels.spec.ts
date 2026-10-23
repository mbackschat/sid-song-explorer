import {test, expect} from './fixtures.ts';
import type {Page} from '@playwright/test';

async function pauseAfterPlayback(page: Page) {
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(.1);
  await page.locator('#play-button').click();
  await expect(page.locator('#play-status')).toHaveText('Paused');
}

async function expectLabelPlacement(page: Page) {
  await expect(page.locator('#timeline-direction')).toHaveCount(0);
  await expect(page.locator('#timeline-cursor')).toHaveText(/^\d+:\d{2}\.\d{2}$/);
  const geometry = await page.evaluate(() => {
    const bounds = (selector: string) => {
      const {x, y, width, height} = document.querySelector(selector)!.getBoundingClientRect();
      return {left:x, right:x + width, top:y, bottom:y + height};
    };
    return {
      chart:bounds('#chip-lanes-0 .filter-lane'), ruler:bounds('.timeline-ruler'),
      viewportStart:bounds('#timeline-start'), viewportEnd:bounds('#timeline-end'),
      track:bounds('#timeline-scroll-track'),
      songStart:bounds('#timeline-range-start'), songEnd:bounds('#timeline-range-end'),
    };
  });
  expect(geometry.ruler.top).toBeCloseTo(geometry.chart.bottom, 0);
  expect(geometry.viewportStart.top).toBeGreaterThanOrEqual(geometry.ruler.top);
  expect(geometry.viewportEnd.bottom).toBeLessThanOrEqual(geometry.ruler.bottom);
  expect(geometry.track.top).toBeGreaterThan(geometry.ruler.bottom);
  expect(geometry.songStart.top).toBeGreaterThanOrEqual(geometry.track.bottom);
  expect(geometry.songEnd.top).toBeGreaterThanOrEqual(geometry.track.bottom);
  expect(geometry.songStart.left).toBeCloseTo(geometry.track.left, 0);
  expect(geometry.songEnd.right).toBeCloseTo(geometry.track.right, 0);
}

test('viewport times belong to the chart while scrollbar endpoints keep the full song range', async ({page}) => {
  await page.goto('/');
  await page.locator('#load-button').click();
  await pauseAfterPlayback(page);
  const rangeStart = page.locator('#timeline-range-start');
  const rangeEnd = page.locator('#timeline-range-end');
  await expect(rangeStart).toHaveText('0:00');
  await expect(rangeEnd).toHaveText('3:13');
  await expect(rangeEnd).toHaveAttribute('title', 'Song end');
  await expectLabelPlacement(page);
  const heard = await page.locator('#seek-slider').inputValue();
  const bar = page.getByRole('scrollbar', {name:'Browse timeline'});
  await bar.focus();
  await bar.press('End');
  await expect(page.locator('#timeline-start')).not.toHaveText('0:00');
  const endingStart = await page.locator('#timeline-start').textContent();
  await page.locator('#timeline-zoom-in').click();
  await expect(page.locator('#timeline-start')).not.toHaveText(endingStart!);
  for (const width of [2200, 390]) {
    await page.setViewportSize({width, height:1100});
    await expectLabelPlacement(page);
    await expect(rangeStart).toHaveText('0:00');
    await expect(rangeEnd).toHaveText('3:13');
    expect(await page.locator('#seek-slider').inputValue()).toBe(heard);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({path:`build/timeline-labels/${test.info().project.name}-narrow.png`, fullPage:true});
  await bar.focus();
  await bar.press('Home');
  const ruler = (await page.locator('#seek-slider').boundingBox())!;
  const expectedPosition = await page.locator('#voice-lane-0').evaluate(element =>
    (Number(element.getAttribute('aria-valuemin')) + Number(element.getAttribute('aria-valuemax'))) / 2);
  await page.mouse.click(ruler.x + ruler.width / 2, ruler.y + ruler.height / 2);
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeCloseTo(expectedPosition, 1);
});

test('an unknown song duration labels the scrollbar endpoint as a timeline limit', async ({page}) => {
  await page.goto('/');
  await page.locator('#local-file').setInputFiles('public/generated/rambo-loader-main.sid');
  await pauseAfterPlayback(page);
  const rangeEnd = page.locator('#timeline-range-end');
  await expect(page.locator('#timeline-range-start')).toHaveText('0:00');
  await expect(rangeEnd).toHaveText('0:30 · length unknown');
  await expect(rangeEnd).toHaveAttribute('title', 'Current timeline limit; song length unknown');
  await expectLabelPlacement(page);
  await page.locator('#timeline-zoom-in').click();
  await page.locator('#timeline-scroll-track').focus();
  await page.locator('#timeline-scroll-track').press('End');
  await expect(rangeEnd).toHaveText('0:30 · length unknown');
  await page.setViewportSize({width:390, height:844});
  await expectLabelPlacement(page);
  await page.locator('#timeline-fit').click();
  await expect(rangeEnd).toHaveText('0:30 · length unknown');
  await expect(page.locator('#timeline-view-note')).toHaveText('Length unknown · click Fit timeline to update');
});


test('Fit timeline keeps an unknown-length range fixed until explicitly fitted again', async ({page}) => {
  await page.goto('/');
  await page.locator('#local-file').setInputFiles('public/generated/rambo-loader-main.sid');
  await pauseAfterPlayback(page);
  const fit = page.locator('#timeline-fit');
  await expect(fit).toHaveText('Fit timeline');
  await fit.click();
  const lane = page.locator('#voice-lane-0');
  const initialEnd = Number(await lane.getAttribute('aria-valuemax'));
  await page.locator('#seek-slider').fill('25');
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect.poll(() => page.locator('#timeline-scroll-track').getAttribute('data-total').then(Number)).toBeGreaterThan(initialEnd);
  expect(Number(await lane.getAttribute('aria-valuemax'))).toBe(initialEnd);
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(25.2);
  await page.locator('#play-button').click();
  expect(Number(await lane.getAttribute('aria-valuemax'))).toBe(initialEnd);
  await fit.click();
  await expect.poll(() => lane.getAttribute('aria-valuemax').then(Number)).toBeGreaterThan(initialEnd);
  await page.locator('#use-sample-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect(fit).toHaveText('Fit song');
  await fit.click();
  expect(Number(await lane.getAttribute('aria-valuemax'))).toBeCloseTo(193.35884353741497, 2);
});

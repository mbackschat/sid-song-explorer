import {test, expect} from './fixtures.ts';
import type {Page} from '@playwright/test';

async function pauseAfterPlayback(page: Page) {
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(.1);
  await page.locator('#play-button').click();
}

async function expectLabelPlacement(page: Page) {
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

test('an unknown song duration labels the scrollbar endpoint as the explored boundary', async ({page}) => {
  await page.goto('/');
  await page.locator('#local-file').setInputFiles('public/generated/rambo-loader-main.sid');
  await pauseAfterPlayback(page);
  const rangeEnd = page.locator('#timeline-range-end');
  await expect(page.locator('#timeline-range-start')).toHaveText('0:00');
  await expect(rangeEnd).toHaveText('Explored 0:30');
  await expect(rangeEnd).toHaveAttribute('title', 'Explored range; song duration unknown');
  await expectLabelPlacement(page);
  await page.locator('#timeline-zoom-in').click();
  await page.locator('#timeline-scroll-track').focus();
  await page.locator('#timeline-scroll-track').press('End');
  await expect(rangeEnd).toHaveText('Explored 0:30');
  await page.setViewportSize({width:390, height:844});
  await expectLabelPlacement(page);
  await page.locator('#timeline-fit').click();
  await expect(rangeEnd).toHaveText('Explored 0:30');
  await expect(page.locator('#timeline-view-note')).toHaveText('Explored range · duration unknown');
});

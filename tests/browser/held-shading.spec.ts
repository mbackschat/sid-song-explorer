import {test, expect} from './fixtures.ts';

type ShadingFill = {boundary: number; width: number; heard: number};

test('held inspection keeps its chart and settings while upcoming shading follows heard playback', async ({page}) => {
  await page.addInitScript(() => {
    const fills: ShadingFill[] = [];
    Object.defineProperty(window, '__heldShadingFills', {value: fills});
    const color = document.createElement('canvas').getContext('2d')!;
    color.fillStyle = '#20344740';
    const fillRect = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, width, height) {
      if (this.canvas.id === 'voice-lane-0' && this.fillStyle === color.fillStyle) {
        fills.push({boundary: x / this.canvas.clientWidth, width, heard: Number(document.querySelector<HTMLInputElement>('#seek-slider')!.value)});
        if (fills.length > 512) fills.shift();
      }
      return fillRect.call(this, x, y, width, height);
    };
  });
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#seek-slider').fill('5');
  const lane = page.locator('#voice-lane-0');
  await expect(lane).toHaveAttribute('aria-valuenow', '5.00');
  for (let step = 0; step < 2; step++) await page.getByRole('button', {name:'Zoom in', exact:true}).click();
  await expect.poll(() => lane.evaluate(element => Number((element as HTMLElement).dataset.observedUntil) - Number(element.getAttribute('aria-valuemax')))).toBeGreaterThan(0);
  const box = (await lane.boundingBox())!;
  await lane.click({position:{x:box.width * .25, y:20}, modifiers:['Shift']});
  await expect(page.locator('#inspector-title')).toHaveText('Held sound inspector');
  await expect(page.locator('#reg-frequency')).not.toHaveText('—');
  const held = await page.evaluate(() => {
    const lane = document.querySelector('#voice-lane-0')!;
    const settings = ['inspection-time', 'reg-frequency', 'reg-hz', 'reg-waveform', 'reg-gate', 'reg-pulse', 'reg-adsr', 'reg-coupling', 'filter-details', 'write-list'];
    return {start: lane.getAttribute('aria-valuemin'), end: lane.getAttribute('aria-valuemax'), settings: settings.map(id => document.getElementById(id)!.textContent)};
  });
  const initial = await page.evaluate(() => {
    const fills = (window as unknown as {__heldShadingFills: ShadingFill[]}).__heldShadingFills;
    const last = fills.at(-1)!;
    fills.length = 0;
    return last;
  });
  expect(initial.boundary).toBeCloseTo(.5, 1);
  expect(initial.width).toBeGreaterThan(0);
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(Number(held.end) + .2);
  const fills = await page.evaluate(() => (window as unknown as {__heldShadingFills: ShadingFill[]}).__heldShadingFills);
  expect(fills.some(fill => fill.boundary > .8 && fill.boundary < 1 && fill.width > 0), 'upcoming shading must shrink as heard playback approaches the held chart’s right edge').toBe(true);
  const beyondWindow = fills.filter(fill => fill.heard > Number(held.end) + .05);
  expect(beyondWindow.length).toBeGreaterThan(0);
  expect(beyondWindow.every(fill => fill.boundary === 1 && fill.width === 0), 'no upcoming background remains after heard playback passes the held chart').toBe(true);
  await expect(lane).toHaveAttribute('aria-valuemin', held.start!);
  await expect(lane).toHaveAttribute('aria-valuemax', held.end!);
  expect(await page.locator('#inspection-time, #reg-frequency, #reg-hz, #reg-waveform, #reg-gate, #reg-pulse, #reg-adsr, #reg-coupling, #filter-details, #write-list').allTextContents()).toEqual(held.settings);
});

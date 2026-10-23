import {test, expect} from './fixtures.ts';

type Point = {time: number; y: number};
type PlotAudit = {latest: Point[]; baseline: Map<number, number> | null; compared: Set<number>; changed: number};
declare global {interface Window {__plotAudit: PlotAudit}}

test('upcoming frequency curves retain their shape as playback crosses them', async ({page}) => {
  await page.addInitScript(() => {
    const audit: PlotAudit = {latest: [], baseline: null, compared: new Set(), changed: 0};
    window.__plotAudit = audit;
    const paths = new WeakMap<CanvasRenderingContext2D, {x: number; y: number}[]>();
    const prototype = CanvasRenderingContext2D.prototype;
    const begin = prototype.beginPath;
    const move = prototype.moveTo;
    const line = prototype.lineTo;
    const stroke = prototype.stroke;
    prototype.beginPath = function () { paths.set(this, []); return begin.call(this); };
    prototype.moveTo = function (x, y) { paths.get(this)?.push({x, y}); return move.call(this, x, y); };
    prototype.lineTo = function (x, y) { paths.get(this)?.push({x, y}); return line.call(this, x, y); };
    prototype.stroke = function (...args: [] | [Path2D]) {
      if (this.canvas.id === 'voice-lane-2' && this.strokeStyle === '#f493b5') {
        const track = document.querySelector<HTMLElement>('#timeline-scroll-track')!;
        const start = Number(track.getAttribute('aria-valuenow'));
        const span = Number(track.dataset.span);
        audit.latest = (paths.get(this) ?? []).map(({x, y}) => ({time: start + x / this.canvas.clientWidth * span, y}));
        const heard = Number(document.querySelector<HTMLInputElement>('#seek-slider')!.value);
        if (audit.baseline) for (const point of audit.latest) {
          if (point.time > heard - .1) continue;
          const key = Math.round(point.time * 1_000_000);
          const expected = audit.baseline.get(key);
          if (expected === undefined) continue;
          audit.compared.add(key);
          if (Math.abs(point.y - expected) > .001) audit.changed++;
        }
      }
      return Reflect.apply(stroke, this, args);
    };
  });
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(.1);
  await page.locator('#play-button').click();
  await page.locator('#seek-slider').fill('30');
  await expect(page.locator('#play-status')).toHaveText('Paused');
  await expect.poll(() => page.evaluate(() => window.__plotAudit.latest.some(point => point.time > 35))).toBe(true);
  const baselineSize = await page.evaluate(() => {
    const audit = window.__plotAudit;
    audit.baseline = new Map(audit.latest.filter(point => point.time >= 30.5 && point.time <= 34.5)
      .map(point => [Math.round(point.time * 1_000_000), point.y]));
    return audit.baseline.size;
  });
  expect(baselineSize).toBeGreaterThan(100);
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number), {timeout: 8000}).toBeGreaterThan(34.7);
  await page.locator('#play-button').click();
  const result = await page.evaluate(() => ({compared: window.__plotAudit.compared.size, changed: window.__plotAudit.changed}));
  expect(result.compared).toBeGreaterThan(100);
  expect(result.changed).toBe(0);
});

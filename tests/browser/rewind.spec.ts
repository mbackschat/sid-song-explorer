import {test, expect} from './fixtures.ts';
import {holdWorkerRequest} from './worker-control.ts';

test('newly loaded tunes start at the left edge before resuming centered following', async ({page}) => {
  await page.setViewportSize({width:390, height:1100});
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  const lane = page.locator('#voice-lane-0');
  await expect.poll(() => lane.getAttribute('aria-valuemin').then(Number)).toBe(0);
  await expect(page.locator('#seek-slider')).toHaveValue('0');
  await page.locator('#play-button').click();
  await expect.poll(() => lane.evaluate(element => {
    const start = Number(element.getAttribute('aria-valuemin'));
    const end = Number(element.getAttribute('aria-valuemax'));
    const heard = Number((document.querySelector('#seek-slider') as HTMLInputElement).value);
    return heard > (end - start) / 2 && Math.abs((start + end) / 2 - heard) < .03;
  })).toBe(true);
  await page.locator('#local-file').setInputFiles('public/generated/bach-toccata.sid');
  await expect(page.locator('#source-kind')).toContainText('Local file');
  await expect(page.locator('#play-status')).toHaveText('Ready');
  await expect(page.locator('#seek-slider')).toHaveValue('0');
  await expect.poll(() => lane.getAttribute('aria-valuemin').then(Number)).toBe(0);
});

test('rewind starts the scrolling viewport at zero and releases held inspection', async ({page}) => {
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(.1);
  await page.locator('#play-button').click();
  await page.locator('#seek-slider').fill('30');
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#follow-button').click();
  await expect(page.locator('#inspector-title')).toHaveText('Held sound inspector');
  const lane = page.locator('#voice-lane-0');
  const span = await lane.evaluate(element => Number(element.getAttribute('aria-valuemax')) - Number(element.getAttribute('aria-valuemin')));
  const release = await holdWorkerRequest(page, 'seek');
  await page.locator('#restart-button').click();
  await expect(page.locator('#play-status')).toHaveText('Seeking…');
  await expect.poll(() => lane.getAttribute('aria-valuemin').then(Number)).toBe(0);
  await release();
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect(page.locator('#seek-slider')).toHaveValue('0');
  await expect(page.locator('#inspector-title')).toHaveText('Sound inspector');
  await expect.poll(() => lane.getAttribute('aria-valuemin').then(Number)).toBe(0);
  expect(Number(await lane.getAttribute('aria-valuemax'))).toBeCloseTo(span, 6);
  await expect.poll(() => lane.getAttribute('data-observed-until').then(Number)).toBeGreaterThan(1);
  await page.screenshot({path:`build/rewind/${test.info().project.name}-start.png`, fullPage:true});
  await page.locator('#return-button').click();
  await expect.poll(() => lane.getAttribute('aria-valuemin').then(Number)).toBeCloseTo(-span / 2, 6);
  await page.locator('#timeline-fit').click();
  const fittedEnd = await lane.getAttribute('aria-valuemax');
  await page.locator('#restart-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect(page.locator('#timeline-fit')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => lane.getAttribute('aria-valuemin').then(Number)).toBe(0);
  await expect(lane).toHaveAttribute('aria-valuemax', fittedEnd!);
});

test('running rewind advances from the left edge into normal centered following', async ({page}) => {
  await page.setViewportSize({width:390, height:1100});
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#timeline-zoom-in').click();
  await page.locator('#seek-slider').fill('30');
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(30.1);
  const release = await holdWorkerRequest(page, 'seek');
  await page.locator('#restart-button').click();
  await expect(page.locator('#play-status')).toHaveText('Seeking…');
  const lane = page.locator('#voice-lane-0');
  await expect.poll(() => lane.getAttribute('aria-valuemin').then(Number)).toBe(0);
  await release();
  await expect(page.locator('#play-status')).toHaveText('Live SID');
  const frames = await lane.evaluate(async element => {
    const frames: {start:number; end:number; heard:number}[] = [];
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      const start = Number(element.getAttribute('aria-valuemin'));
      const end = Number(element.getAttribute('aria-valuemax'));
      const heard = Number((document.querySelector('#seek-slider') as HTMLInputElement).value);
      frames.push({start, end, heard});
      if (heard > (end - start) / 2 + .3) break;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    return frames;
  });
  const span = frames[0]!.end - frames[0]!.start;
  expect(frames.some(frame => frame.heard > .1 && frame.heard < span / 2 && frame.start === 0)).toBe(true);
  expect(frames.at(-1)!.heard).toBeGreaterThan(span / 2 + .2);
  for (const frame of frames) {
    expect(frame.end - frame.start).toBeCloseTo(span, 6);
    expect(Math.abs(frame.start - Math.max(0, frame.heard - span / 2))).toBeLessThan(.03);
  }
  await expect(page.locator('#return-button')).toHaveAttribute('aria-pressed', 'true');
});

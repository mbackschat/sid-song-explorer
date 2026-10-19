import {test, expect} from './fixtures.ts';
import {holdWorkerRequest} from './worker-control.ts';
import {resolve} from 'node:path';

const sample = resolve('public/generated/rambo-loader-main.sid');
test('live audio, held inspection, mute/solo, loop replay and complete ending', async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect(page.locator('#analysis-badge')).toContainText('Source-linked');
  await page.locator('#play-button').click();
  await expect(page.locator('#heard-time')).not.toHaveText('0:00', {timeout: 10000});
  await expect(page.locator('#peak-label')).not.toHaveText('−∞ dBFS');
  await expect(page.locator('#reg-frequency')).not.toHaveText('—');
  await expect(page.locator('#write-list')).toContainText('$D4');
  await page.screenshot({path:`build/poc/${test.info().project.name}-live.png`,fullPage:true});
  await page.locator('#follow-button').click();
  const held = await page.locator('#inspection-time').textContent();
  const heardWhileHeld = await page.locator('#heard-time').textContent();
  await expect(page.locator('#heard-time')).not.toHaveText(heardWhileHeld!);
  await expect(page.locator('#inspection-time')).toHaveText(held!);
  await page.locator('#return-button').click();
  await page.locator('#solo-0').click();
  await expect(page.locator('#mute-1')).toHaveAttribute('aria-pressed','true');
  await page.locator('#restore-button').click();
  await expect(page.locator('#mute-1')).toHaveAttribute('aria-pressed','false');
  await page.locator('#loop-start').fill('1');
  await page.locator('#loop-end').fill('2');
  await page.locator('#loop-button').click();
  await expect(page.locator('#loop-button')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#heard-time')).toHaveText('0:01', {timeout: 10000});
  await page.locator('#clear-loop').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#seek-slider').evaluate((element: HTMLInputElement) => {
    for (const position of [1.5, 2.5]) {
      element.value = String(position);
      element.dispatchEvent(new Event('change', {bubbles: true}));
    }
  });
  await expect(page.locator('#play-status')).toHaveText('Live SID');
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThanOrEqual(3);
  await page.locator('#seek-slider').fill('192.5');
  await expect(page.locator('#play-status')).toContainText('Ended', {timeout: 20000});
  expect(errors).toEqual([]);
  await page.screenshot({path: `build/poc/${test.info().project.name}-ending.png`, fullPage: true});
});

test('local file stays local and profile changes invalidate authored annotations', async ({page}) => {
  const remoteRequests: string[] = [];
  page.on('request', request => {if (!request.url().startsWith('http://127.0.0.1:4173') && !request.url().startsWith('blob:') && !request.url().startsWith('data:')) remoteRequests.push(request.url());});
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#model-select').selectOption('MOS8580');
  await page.locator('#load-button').click();
  await expect(page.locator('#analysis-badge')).toContainText('Generic');
  await expect(page.locator('#load-button')).toBeEnabled();
  await page.locator('#local-file').setInputFiles(sample);
  await expect(page.locator('#source-kind')).toContainText('Local file');
  await expect(page.locator('#analysis-badge')).toContainText('Generic');
  await page.locator('#play-button').click();
  await expect(page.locator('#heard-time')).not.toHaveText('0:00');
  await page.locator('#local-file').setInputFiles({name:'invalid.sid',mimeType:'application/octet-stream',buffer:Buffer.from('not a SID')});
  await expect(page.locator('#status-message')).toContainText('mono PSID');
  expect(remoteRequests).toEqual([]);
  await page.locator('#use-sample-button').click();
  await expect(page.locator('#source-kind')).toContainText('sample library');
  await expect(page.locator('#analysis-badge')).toContainText('Source-linked');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:`build/poc/${test.info().project.name}-mobile.png`,fullPage:true});
});

test('a short evidence annotation plays useful context while preserving its exact range', async ({page}) => {
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('[data-annotation="restored-main-entry"]').click();
  await expect(page.locator('#play-status')).toHaveText('Live SID');
  await expect(page.locator('#loop-end')).toHaveValue('4');
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number), {timeout:10000}).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#inspector-note')).toContainText('Held');
  await page.screenshot({path:`build/poc/${test.info().project.name}-exploring.png`,fullPage:true});
});

test('voice activity follows playback at a fixed density and freezes its held window', async ({page}) => {
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#seek-slider').fill('30');
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  const lane = page.locator('#voice-lane-0');
  const range = () => lane.evaluate(element => ({start:Number(element.getAttribute('aria-valuemin')),end:Number(element.getAttribute('aria-valuemax'))}));
  await expect.poll(async () => (await range()).start).toBeGreaterThan(20);
  const first = await range();
  expect(first.end - first.start).toBeCloseTo(await lane.evaluate(element => element.clientWidth / 64), 1);
  await expect.poll(async () => (await range()).start).toBeGreaterThan(first.start + 1);
  const moved = await range();
  expect(moved.end - moved.start).toBeCloseTo(await lane.evaluate(element => element.clientWidth / 64), 1);
  await page.locator('#follow-button').click();
  const heldRange = await range();
  const heard = await page.locator('#heard-time').textContent();
  await expect(page.locator('#heard-time')).not.toHaveText(heard!);
  expect(await range()).toEqual(heldRange);
  await page.locator('#return-button').click();
  await expect.poll(async () => (await range()).start).toBeGreaterThan(heldRange.start);
});

test('timeline switches between scrolling and fitted history without changing playback or held inspection', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#timeline-scroll')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#seek-slider').fill('30');
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  const lane = page.locator('#voice-lane-0');
  const range = () => lane.evaluate(element => ({start:Number(element.getAttribute('aria-valuemin')),end:Number(element.getAttribute('aria-valuemax'))}));
  await expect.poll(async () => (await range()).start).toBeGreaterThan(20);
  await page.locator('#timeline-fit').click();
  await expect(page.locator('#timeline-fit')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await range()).start).toBeGreaterThanOrEqual(30);
  expect((await range()).start).toBeLessThan(30.02);
  await expect(page.locator('#play-status')).toHaveText('Live SID');
  await page.locator('#follow-button').click();
  const cursor = await page.locator('#inspection-time').textContent();
  await page.locator('#timeline-scroll').click();
  const scrolled = await range();
  expect(scrolled.end - scrolled.start).toBeCloseTo(await lane.evaluate(element => element.clientWidth / 64), 1);
  expect(scrolled.start).toBeLessThan(30);
  await expect(page.locator('#inspection-time')).toHaveText(cursor!);
  await expect(page.locator('#return-button')).toBeVisible();
  await page.locator('#timeline-fit').click();
  await expect.poll(async () => (await range()).start).toBeGreaterThanOrEqual(30);
  expect((await range()).start).toBeLessThan(30.02);
  const held = await range();
  const heard = await page.locator('#heard-time').textContent();
  await expect(page.locator('#heard-time')).not.toHaveText(heard!);
  expect(await range()).toEqual(held);
  await page.locator('#return-button').click();
  await page.locator('#timeline-scroll').click();
  await expect.poll(async () => (await range()).start).toBeLessThan(30);
  await page.setViewportSize({width:390, height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test('compact chart controls explain held inspection without moving playback', async ({page}) => {
  await page.goto('/');
  const header = page.locator('[aria-labelledby="timeline-title"] > .panel-header');
  await expect(header.locator('#timeline-scroll')).toBeVisible();
  await expect(header.locator('#timeline-fit')).toBeVisible();
  expect((await header.boundingBox())!.height).toBeLessThan(85);
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThanOrEqual(1);
  const lane = page.locator('#voice-lane-1');
  const box = (await lane.boundingBox())!;
  await lane.click({position:{x:box.width * .5, y:20}});
  await expect(page.locator('#history-summary')).toContainText('Inspecting Voice 2 at');
  const selectedPosition = await lane.evaluate(element => {
    const start = Number(element.getAttribute('aria-valuemin'));
    const end = Number(element.getAttribute('aria-valuemax'));
    const [minutes, seconds] = document.querySelector('#inspection-time')!.textContent!.split(':').map(Number);
    return {expected:start + (end - start) * .5, actual:minutes! * 60 + seconds!};
  });
  expect(Math.abs(selectedPosition.actual - selectedPosition.expected)).toBeLessThan(.03);
  await expect(page.locator('#history-summary')).toContainText('music continues');
  await expect(page.locator('#inspect-1')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#reg-frequency')).not.toHaveText('—');
  await expect(page.locator('#inspector-title')).toHaveText('Held sound inspector');
  await expect(page.locator('#return-button')).toHaveText('Resume live');
  await expect(page.locator('#follow-button')).toBeHidden();
  const selected = await page.locator('#inspection-time').textContent();
  const playbackPosition = Number(await page.locator('#seek-slider').inputValue());
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(playbackPosition + .5);
  await expect(page.locator('#inspection-time')).toHaveText(selected!);
  await page.screenshot({path:`build/poc/${test.info().project.name}-held-feedback.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', {name:'View inspector'}).click();
  await expect(page.locator('#inspector-title')).toBeInViewport();
  await page.locator('#return-button').click();
  await expect(page.locator('#history-summary')).not.toContainText('Inspecting');
  await expect(page.locator('#follow-button')).toBeVisible();
  await expect(page.locator('#return-button')).toBeHidden();
});

test('seek feedback keeps the requested position visible until playback resumes', async ({page}) => {
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThanOrEqual(1);
  const releaseSeek = await holdWorkerRequest(page, 'seek');
  await page.locator('#seek-slider').fill('180');
  await expect(page.locator('#play-status')).toHaveText('Seeking…');
  await expect(page.locator('#play-button')).toHaveText('Seeking…');
  await expect(page.locator('#status-message')).toHaveClass(/seeking/);
  await expect(page.locator('#status-message')).toContainText('Seeking to 3:00.00');
  await expect(page.locator('#status-message')).toContainText('preparing sound');
  await expect(page.locator('#seek-slider')).toHaveValue('180');
  await expect(page.locator('#seek-note')).toContainText('Requested position');
  await page.screenshot({path:`build/poc/${test.info().project.name}-seeking-feedback.png`,fullPage:true});
  await releaseSeek();
  await expect(page.locator('#play-status')).toHaveText('Live SID', {timeout:20000});
  await expect(page.locator('#status-message')).not.toHaveClass(/seeking/);
  await expect(page.locator('#play-button')).toHaveText('Ⅱ Pause');
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(180.5);
  const releaseFailure = await holdWorkerRequest(page, 'seek');
  await page.locator('#seek-slider').fill('90');
  await expect(page.locator('#play-status')).toHaveText('Seeking…');
  await releaseFailure('Injected seek failure');
  await expect(page.locator('#status-message')).toContainText('Injected seek failure');
  await expect(page.locator('#status-message')).not.toHaveClass(/seeking/);
  await expect(page.locator('#play-button')).not.toHaveClass(/seeking/);
  await expect(page.locator('#seek-note')).not.toContainText('Requested position');
});


test('prepared audio supports quick repeated seeks while playback advances', async ({page}) => {
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect(page.locator('#render-lead')).toHaveAttribute('data-prepared-until', /[0-9]/);
  await expect.poll(() => page.locator('#render-lead').getAttribute('data-prepared-until').then(Number), {timeout:25000}).toBeGreaterThan(181);
  await page.locator('#play-button').click();
  await expect(page.locator('#play-status')).toHaveText('Live SID');
  for (const [seconds, label] of [[180, '3:00'], [30, '0:30'], [90, '1:30']] as const) {
    const elapsed = await page.evaluate(async ({seconds, label}) => {
      const slider = document.querySelector<HTMLInputElement>('#seek-slider')!;
      const start = performance.now();
      slider.value = String(seconds);
      slider.dispatchEvent(new Event('change', {bubbles:true}));
      while (performance.now() - start < 2000) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (document.querySelector('#heard-time')!.textContent === label && document.querySelector('#play-status')!.textContent === 'Live SID') return performance.now() - start;
      }
      return 2000;
    }, {seconds, label});
    console.log(`${test.info().project.name}: prepared seek to ${seconds}s resumed UI in ${elapsed.toFixed(1)} ms`);
    expect(elapsed).toBeLessThan(750);
  }
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(90.5);
  await page.locator('#play-button').click();
});

import {mkdir, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {test, expect} from './fixtures.ts';

const shot = {
  sample: 'rambo-stereo-main',
  viewport: {width:1600, height:1280},
  earliestSeconds: 12,
};

test.use({viewport:shot.viewport, deviceScaleFactor:1});

test('README capture shows Rambo playing with populated voice history', async ({page}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await page.locator('#sample-select').selectOption(shot.sample);
  await page.locator('#load-button').click();
  await expect(page.locator('#track-title')).toHaveText('Rambo loader — main music, stereo');
  await expect(page.locator('#profile-badge')).toContainText('PAL · MOS6581');
  await expect(page.locator('.track-profile')).toContainText('2 SIDs · $D400 / $D420 · stereo');
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect(page.locator('#play-status')).toHaveText('Live SID');
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number), {timeout:20000}).toBeGreaterThanOrEqual(shot.earliestSeconds);
  const position = Number(await page.locator('#seek-slider').inputValue());
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(position + .25);
  await expect(page.locator('#peak-label')).not.toHaveText('−∞ dBFS');
  await expect(page.locator('#reg-frequency')).not.toHaveText('—');
  await expect(page.locator('#write-list')).toContainText('$D4');
  await expect(page.locator('#timeline-scroll')).toHaveAttribute('aria-pressed', 'true');
  for (const voice of [0, 1, 2, 3, 4, 5]) {
    await expect(page.locator(`#lane-wave-${voice}`)).not.toHaveText(/^(No observation|None)$/);
    await expect.poll(() => page.locator(`#voice-lane-${voice}`).evaluate((canvas: HTMLCanvasElement) => {
      // drawLane in src/ui.ts places zero frequency, gate bars and waveform markers outside this pitch area.
      const pixels = canvas.getContext('2d')!.getImageData(0, 10, canvas.width, canvas.height - 28).data;
      let past = 0;
      let upcoming = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const x = index / 4 % canvas.width;
        if (pixels[index + 3]! > 0 && Math.max(pixels[index]!, pixels[index + 1]!, pixels[index + 2]!) - Math.min(pixels[index]!, pixels[index + 1]!, pixels[index + 2]!) > 40) {
          if (x < canvas.width * .45) past++;
          if (x > canvas.width * .55) upcoming++;
        }
      }
      return Math.min(past, upcoming);
    })).toBeGreaterThan(50);
  }
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await expect(page.locator('#play-button')).toHaveText('Ⅱ Pause');
  const timeline = (await page.locator('#timeline-panel').boundingBox())!;
  expect(timeline.y + timeline.height).toBeLessThan(shot.viewport.height);
  const gains = await page.evaluate(() => (window as unknown as {__explorerSilentSinks: GainNode[]}).__explorerSilentSinks.map(sink => sink.gain.value));
  expect(gains.length).toBeGreaterThan(0);
  expect(gains.every(value => value === 0)).toBe(true);
  const screenshot = await page.screenshot({path:testInfo.outputPath('rambo-playing.png'), fullPage:false});
  expect(errors).toEqual([]);
  await testInfo.attach('readme-rambo', {body:screenshot, contentType:'image/png'});
  const output = `build/screenshots/${testInfo.project.name}/rambo-playing.png`;
  await mkdir(dirname(output), {recursive:true});
  await writeFile(output, screenshot);
});

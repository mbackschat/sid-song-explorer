import {readFileSync} from 'node:fs';
import {parseCatalog} from '../../src/catalog.ts';
import {test, expect} from './fixtures.ts';

const catalog = parseCatalog(JSON.parse(readFileSync('config/catalog.json', 'utf8')));

for (const [sample, ending] of [['rambo-loader-main', '3:13'], ['rambo-stereo-main', '3:13'], ['bach-toccata-stereo', '1:28']]) {
  test(`uninterrupted full ${sample} playback reaches its ending`, async ({page}) => {
    test.skip(!process.env.EXPLORER_FULL_SONG, 'Opt in to full-duration real-time playback checks.');
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const stats = {frames: 0, channels: [] as {peak: number; saturated: number}[]};
      Object.defineProperty(window, '__fullSongOutput', {value: stats});
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        if (this.buffer) {
          stats.frames += this.buffer.length;
          for (let channel = 0; channel < this.buffer.numberOfChannels; channel++) {
            const output = stats.channels[channel] ??= {peak: 0, saturated: 0};
            for (const sample of this.buffer.getChannelData(channel)) {
              output.peak = Math.max(output.peak, Math.abs(sample));
              if (sample <= -1 || sample >= 32767 / 32768) output.saturated++;
            }
          }
        }
        return Reflect.apply(start, this, args);
      };
    });
    await page.goto('/');
    await page.locator('#sample-select').selectOption(sample);
    await page.locator('#load-button').click();
    await expect(page.locator('#play-button')).toBeEnabled();
    await page.locator('#play-button').click();
    await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number), {timeout:10000}).toBeGreaterThanOrEqual(2);
    await expect(page.locator('#peak-label')).not.toHaveText('−∞ dBFS');
    await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number), {timeout:15000}).toBeGreaterThanOrEqual(12);
    await page.screenshot({path:`build/poc/${test.info().project.name}-${sample}-live.png`,fullPage:true});
    await expect(page.locator('#play-status')).toHaveText('Ended', {timeout:215000});
    await expect(page.locator('#heard-time')).toHaveText(ending);
    await expect(page.locator('#history-summary')).toHaveAttribute('title', /0 dropped writes/);
    await expect(page.locator('#audio-diagnostics')).toContainText('0 buffer underruns');
    expect(errors).toEqual([]);
    await page.screenshot({path:`build/poc/${test.info().project.name}-${sample}-full-song.png`,fullPage:true});
    const output = await page.evaluate(() => (window as unknown as {
      __fullSongOutput: {frames: number; channels: {peak: number; saturated: number}[]};
    }).__fullSongOutput);
    const entry = catalog.entries.find(entry => entry.id === sample)!;
    expect(output.frames).toBe(Math.round(entry.durationSeconds * 44100));
    expect(output.channels).toHaveLength(entry.target.sidCount);
    for (const channel of output.channels) expect(channel.peak).toBeGreaterThan(.01);
    console.log(`${sample}: ${JSON.stringify(output)}; ${await page.locator('#audio-diagnostics').textContent()}`);
  });
}

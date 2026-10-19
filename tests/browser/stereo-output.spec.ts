import {test, expect} from './fixtures.ts';
import {SidSession} from '../../src/engine/session.ts';
import {dualSid, monoSid} from '../fixtures/dual-sid.ts';

for (const model of ['MOS6581', 'MOS8580'] as const) {
  for (const activeChip of [0, 1]) {
    test(`${model} raw chip ${activeChip + 1} reaches only its browser output channel at unity gain`, async ({page}) => {
      const bytes = dualSid(model, activeChip);
      const oracle = await SidSession.create();
      let expected: number[];
      let idle: number[];
      try {
        await oracle.load(monoSid(model, activeChip), {clock: 'PAL', model, subtune: 1});
        expected = Array.from(oracle.render(4096).pcm, sample => sample / 32768);
        await oracle.load(monoSid(model, activeChip, true), {clock: 'PAL', model, subtune: 1});
        idle = Array.from(oracle.render(4096).pcm, sample => sample / 32768);
      } finally { oracle.dispose(); }
      await page.addInitScript(() => {
        const captured: {channels: number[][]; duration: number; rate: number}[] = [];
        Object.defineProperty(window, '__stereoOutput', {value: captured});
        const start = AudioBufferSourceNode.prototype.start;
        AudioBufferSourceNode.prototype.start = function (...args) {
          if (this.buffer && captured.length === 0) {
            captured.push({channels: Array.from({length: this.buffer.numberOfChannels}, (_, channel) => Array.from(this.buffer!.getChannelData(channel))), duration: this.buffer.duration, rate: this.buffer.sampleRate});
          }
          return Reflect.apply(start, this, args);
        };
      });
      await page.goto('/');
      await page.locator('#local-file').setInputFiles({name: 'routing.sid', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes)});
      await expect(page.locator('#play-button')).toBeEnabled();
      await page.locator('#play-button').click();
      await expect.poll(() => page.evaluate(() => (window as unknown as {__stereoOutput: unknown[]}).__stereoOutput.length)).toBe(1);
      const [output] = await page.evaluate(() => (window as unknown as {__stereoOutput: {channels: number[][]; duration: number; rate: number}[]}).__stereoOutput);
      expect(output.channels).toHaveLength(2);
      expect(output.rate).toBe(44100);
      expect(output.duration).toBe(4096 / 44100);
      expect(output.channels[activeChip]).toEqual(expected);
      expect(output.channels[1 - activeChip]).toEqual(idle);
      expect(expected.some(sample => Math.abs(sample) > 0.01)).toBe(true);
    });
  }
}

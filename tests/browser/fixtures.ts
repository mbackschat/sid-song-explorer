import {test as base, expect} from '@playwright/test';

export const test = base.extend({
  page: async ({page}, use, testInfo) => {
    await page.addInitScript(() => {
      const connect = AudioNode.prototype.connect;
      const sinks = new WeakMap<BaseAudioContext, GainNode>();
      const audit: GainNode[] = [];
      Object.defineProperty(window, '__explorerSilentSinks', {value: audit});
      // Headless WebKit uses physical speakers on macOS (2026-10-18); mute only the test sink, after the analyser.
      Object.defineProperty(AudioNode.prototype, 'connect', {
        value(this: AudioNode, destination: AudioNode | AudioParam, ...ports: number[]) {
          if (destination === this.context.destination) {
            let sink = sinks.get(this.context);
            if (!sink) {
              sink = this.context.createGain();
              sink.gain.value = 0;
              Reflect.apply(connect, sink, [this.context.destination]);
              sinks.set(this.context, sink);
              audit.push(sink);
            }
            return Reflect.apply(connect, this, [sink, ...ports]);
          }
          return Reflect.apply(connect, this, [destination, ...ports]);
        },
      });
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        this.muted = true;
        return play.call(this);
      };
    });
    await use(page);
    if (testInfo.status === 'passed' && !page.isClosed()) {
      const gains = await page.evaluate(() => ((window as unknown as {__explorerSilentSinks: GainNode[]}).__explorerSilentSinks).map(sink => sink.gain.value));
      expect(gains.length).toBeGreaterThan(0);
      expect(gains.every(value => value === 0)).toBe(true);
    }
  },
});
export {expect};

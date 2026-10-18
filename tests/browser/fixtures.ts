import {test as base, expect} from '@playwright/test';

export const test = base.extend({
  page: async ({page}, use, testInfo) => {
    const timing: unknown[] = [];
    page.on('console', message => {
      if (message.type() === 'debug' && message.text().startsWith('explorer-test-timing ')) {
        timing.push({receivedAt: Date.now(), event: JSON.parse(message.text().slice(21))});
        if (timing.length > 256) timing.shift();
      }
    });
    await page.addInitScript(() => {
      const record = (event: unknown) => console.debug('explorer-test-timing ' + JSON.stringify(event));
      let lastTick = performance.now();
      setInterval(() => {
        const now = performance.now();
        record({kind: 'heartbeat', at: now, gap: now - lastTick});
        lastTick = now;
      }, 1000);
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        private tracked = new Map<number, {method: string; started: number}>();
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.addEventListener('message', event => {
            const pending = this.tracked.get(event.data.id);
            if (!pending) return;
            this.tracked.delete(event.data.id);
            record({kind: 'reply', id: event.data.id, method: pending.method, at: performance.now(), elapsed: performance.now() - pending.started, error: event.data.error});
          });
        }
        postMessage(message: {id: number; method: string; payload: unknown}, options?: Transferable[] | StructuredSerializeOptions) {
          if (['load', 'seek', 'mute'].includes(message.method)) {
            this.tracked.set(message.id, {method: message.method, started: performance.now()});
            record({kind: 'request', id: message.id, method: message.method, at: performance.now(), payload: message.method === 'load' ? undefined : message.payload});
          }
          if (Array.isArray(options)) super.postMessage(message, options);
          else super.postMessage(message, options);
        }
      };

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
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('browser-timing', {body: JSON.stringify(timing, null, 2), contentType: 'application/json'});
      console.log('Browser timing at failure:', JSON.stringify(timing));
    }
    if (testInfo.status === 'passed' && !page.isClosed()) {
      const gains = await page.evaluate(() => ((window as unknown as {__explorerSilentSinks: GainNode[]}).__explorerSilentSinks).map(sink => sink.gain.value));
      expect(gains.length).toBeGreaterThan(0);
      expect(gains.every(value => value === 0)).toBe(true);
    }
  },
});
export {expect};

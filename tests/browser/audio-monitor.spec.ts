import type {Page} from '@playwright/test';
import {test, expect} from './fixtures.ts';

type SignalMode = 'both' | 'left' | 'right';
interface MonitorAudit {
  mode: SignalMode;
  frames: number;
  channels: Record<number, {peak: number; rms: number; bands: [number, number]}>;
  waveforms: Record<string, {range: number; crossings: number; color: string}>;
  spectrumBars: Record<string, number[]>;
}

const colors = ['#6ee0de', '#f3c681'];
const monitorAudit = (page: Page) => page.evaluate(() => (window as unknown as {__audioMonitorAudit: MonitorAudit}).__audioMonitorAudit);

async function installSignals(page: Page) {
  await page.addInitScript(() => {
    const audit: MonitorAudit = {mode: 'both', frames: 0, channels: {}, waveforms: {}, spectrumBars: {}};
    Object.defineProperty(window, '__audioMonitorAudit', {value: audit});
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.buffer) {
        for (let channel = 0; channel < this.buffer.numberOfChannels; channel++) {
          const samples = this.buffer.getChannelData(channel);
          const amplitude = channel === 0 ? (audit.mode === 'right' ? 0 : .25) : (audit.mode === 'left' ? 0 : .5);
          const bin = channel === 0 ? 8 : 32;
          // Exact FFT bins and a continuous sample index make the independent sine oracle insensitive to buffer boundaries.
          for (let index = 0; index < samples.length; index++) samples[index] = amplitude * Math.sin(2 * Math.PI * bin * (audit.frames + index) / 1024);
        }
        audit.frames += this.buffer.length;
      }
      return Reflect.apply(start, this, args);
    };

    const channelByAnalyser = new WeakMap<AnalyserNode, number>();
    const connect = AudioNode.prototype.connect;
    Object.defineProperty(AudioNode.prototype, 'connect', {
      value(this: AudioNode, destination: AudioNode | AudioParam, ...ports: number[]) {
        if (this instanceof ChannelSplitterNode && destination instanceof AnalyserNode) channelByAnalyser.set(destination, ports[0] ?? 0);
        return Reflect.apply(connect, this, [destination, ...ports]);
      },
    });
    const waveform = AnalyserNode.prototype.getFloatTimeDomainData;
    AnalyserNode.prototype.getFloatTimeDomainData = function (samples) {
      waveform.call(this, samples);
      const channel = channelByAnalyser.get(this);
      if (channel === undefined) return;
      const measured = audit.channels[channel] ??= {peak: 0, rms: 0, bands: [0, 0]};
      let squares = 0;
      measured.peak = 0;
      for (const sample of samples) { measured.peak = Math.max(measured.peak, Math.abs(sample)); squares += sample * sample; }
      measured.rms = Math.sqrt(squares / samples.length);
    };
    const spectrum = AnalyserNode.prototype.getByteFrequencyData;
    AnalyserNode.prototype.getByteFrequencyData = function (bins) {
      spectrum.call(this, bins);
      const channel = channelByAnalyser.get(this);
      if (channel === undefined) return;
      const measured = audit.channels[channel] ??= {peak: 0, rms: 0, bands: [0, 0]};
      measured.bands = [Math.max(...bins.slice(7, 10)), Math.max(...bins.slice(31, 34))];
    };

    const paths = new WeakMap<CanvasRenderingContext2D, number[]>();
    const beginPath = CanvasRenderingContext2D.prototype.beginPath;
    CanvasRenderingContext2D.prototype.beginPath = function () { paths.set(this, []); return beginPath.call(this); };
    for (const method of ['moveTo', 'lineTo'] as const) {
      const native = CanvasRenderingContext2D.prototype[method];
      CanvasRenderingContext2D.prototype[method] = function (x, y) {
        if (this.canvas.id.startsWith('waveform-plot')) paths.get(this)?.push(y);
        return native.call(this, x, y);
      };
    }
    const stroke = CanvasRenderingContext2D.prototype.stroke;
    CanvasRenderingContext2D.prototype.stroke = function (path?: Path2D) {
      const points = paths.get(this);
      if (this.canvas.id.startsWith('waveform-plot') && points && points.length > 2) {
        const center = this.canvas.clientHeight / 2;
        let crossings = 0;
        for (let index = 1; index < points.length; index++) if ((points[index - 1]! < center) !== (points[index]! < center)) crossings++;
        audit.waveforms[this.canvas.id] = {range: Math.max(...points) - Math.min(...points), crossings, color: String(this.strokeStyle)};
      }
      return Reflect.apply(stroke, this, path ? [path] : []);
    };
    const clearRect = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.id === 'spectrum-plot') audit.spectrumBars = {};
      return Reflect.apply(clearRect, this, args);
    };
    const fillRect = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (...args) {
      if (this.canvas.id === 'spectrum-plot') (audit.spectrumBars[String(this.fillStyle)] ??= []).push(args[3]);
      return Reflect.apply(fillRect, this, args);
    };
  });
}

test('stereo meters, waveforms and shared spectrum retain independent channel signals', {tag: ['@poc', '@webkit-compat']}, async ({page}) => {
  await installSignals(page);
  await page.goto('/');
  await page.locator('#sample-select').selectOption('bach-toccata-stereo');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect(page.locator('#peak-label-right')).toBeVisible();

  for (const mode of ['both', 'left', 'right'] as const) {
    await page.evaluate(mode => { (window as unknown as {__audioMonitorAudit: MonitorAudit}).__audioMonitorAudit.mode = mode; }, mode);
    for (let channel = 0; channel < 2; channel++) {
      const active = mode === 'both' || mode === (channel === 0 ? 'left' : 'right');
      const amplitude = active ? (channel === 0 ? .25 : .5) : 0;
      const suffix = channel === 0 ? '' : '-right';
      const expectedDb = (value: number) => value === 0 ? '−∞ dBFS' : `${(20 * Math.log10(value)).toFixed(1)} dBFS`;
      await expect(page.locator(`#peak-label${suffix}`)).toHaveText(expectedDb(amplitude));
      await expect(page.locator(`#rms-label${suffix}`)).toHaveText(expectedDb(amplitude / Math.sqrt(2)));
      const meterWidth = amplitude === 0 ? 0 : (20 * Math.log10(amplitude) + 60) / 60 * 100;
      await expect.poll(() => page.locator(`#peak-meter${suffix}`).evaluate(element => Number.parseFloat((element as HTMLElement).style.width))).toBeCloseTo(meterWidth, 1);
      await expect.poll(async () => (await monitorAudit(page)).channels[channel]?.peak).toBeCloseTo(amplitude, 3);
      await expect.poll(async () => (await monitorAudit(page)).channels[channel]?.rms).toBeCloseTo(amplitude / Math.sqrt(2), 3);
      const waveformId = `waveform-plot${suffix}`;
      if (active) {
        await expect.poll(async () => (await monitorAudit(page)).waveforms[waveformId]?.range).toBeGreaterThan(3);
        await expect.poll(async () => (await monitorAudit(page)).channels[channel]?.bands[channel]).toBeGreaterThan(200);
      } else {
        await expect.poll(async () => (await monitorAudit(page)).waveforms[waveformId]?.range).toBeLessThan(.01);
        await expect.poll(async () => Math.max(...(await monitorAudit(page)).channels[channel]!.bands)).toBeLessThan(10);
      }
      await expect.poll(async () => (await monitorAudit(page)).channels[channel]?.bands[1 - channel]).toBeLessThan(10);
      expect((await monitorAudit(page)).waveforms[waveformId]!.color).toBe(colors[channel]);
      const renderedBars = async () => (await monitorAudit(page)).spectrumBars[colors[channel]!] ?? [];
      await expect.poll(async () => (await renderedBars()).length).toBe(64);
      if (active) {
        await expect.poll(async () => Math.max(...(await renderedBars()).slice(channel === 0 ? 6 : 14, channel === 0 ? 11 : 19))).toBeGreaterThan(40);
        await expect.poll(async () => Math.max(...(await renderedBars()).slice(channel === 0 ? 14 : 6, channel === 0 ? 19 : 11))).toBeLessThan(3);
        const crossings = (await monitorAudit(page)).waveforms[waveformId]!.crossings;
        expect(crossings).toBeGreaterThanOrEqual(channel === 0 ? 14 : 62);
        expect(crossings).toBeLessThanOrEqual(channel === 0 ? 18 : 66);
      } else {
        await expect.poll(async () => {
          const rendered = await renderedBars();
          return rendered.length === 64 ? Math.max(...rendered) : Infinity;
        }).toBeLessThan(3);
      }
    }
  }
  await page.locator('#play-button').click();
  await expect(page.locator('#play-status')).toHaveText('Paused');
});

test('stereo audio output stays compact on desktop and narrow screens and restores mono presentation', async ({page}) => {
  await page.goto('/');
  const widths = [1440, 1024, 390];
  const monoHeights = new Map<number, number>();
  for (const width of widths) {
    await page.setViewportSize({width, height: 1100});
    monoHeights.set(width, (await page.locator('.audio-body').boundingBox())!.height);
  }
  await page.setViewportSize({width: 1440, height: 1100});
  await page.locator('#sample-select').selectOption('bach-toccata-stereo');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(0);
  await page.locator('#play-button').click();
  await expect(page.locator('#analysis-monitor')).toBeVisible();
  await expect(page.locator('#analysis-monitor')).toContainText('L · Left');
  await expect(page.locator('#analysis-monitor')).toContainText('R · Right');
  await expect(page.locator('#peak-title')).toHaveText('Peak');
  await expect(page.locator('#waveform-plot')).toHaveAttribute('aria-label', 'Actual left output waveform');
  await expect(page.locator('#waveform-plot-right')).toHaveAttribute('aria-label', 'Actual right output waveform');
  await expect(page.locator('#spectrum-plot')).toHaveAttribute('aria-label', 'Actual left and right output frequency spectrum');
  for (const width of widths) {
    await page.setViewportSize({width, height: 1100});
    for (const id of ['peak-label', 'rms-label', 'peak-meter', 'waveform-plot', 'peak-label-right', 'rms-label-right', 'peak-meter-right', 'waveform-plot-right', 'spectrum-plot']) await expect(page.locator(`#${id}`)).toBeVisible();
    expect((await page.locator('.audio-body').boundingBox())!.height).toBeLessThanOrEqual(monoHeights.get(width)! + 40);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('[aria-labelledby="output-title"]').screenshot({path: `build/poc/${test.info().project.name}-stereo-monitor-${width}.png`});
  }
  await page.locator('#sample-select').selectOption('rambo-loader-main');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect(page.locator('#analysis-monitor')).toBeHidden();
  await expect(page.locator('#audio-channel-right')).toBeHidden();
  await expect(page.locator('#peak-title')).toHaveText('Peak · measured PCM');
  await expect(page.locator('#rms-title')).toHaveText('RMS');
  await expect(page.locator('#waveform-plot')).toHaveAttribute('aria-label', 'Actual output waveform');
  await expect(page.locator('#spectrum-plot')).toHaveAttribute('aria-label', 'Actual output frequency spectrum');
});

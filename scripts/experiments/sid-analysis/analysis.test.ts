import assert from 'node:assert/strict';
import test from 'node:test';
import type { LoadResult, RenderResult, SidWrite } from '../../../src/engine/session.ts';
import { AnalysisAccumulator } from './analysis.ts';

function profile(channels: 1 | 2 = 1, sampleRate = 1000): LoadResult {
  return {
    clock: 'PAL', model: 'MOS6581', subtune: 1, title: 'Fixture', author: '', released: '', songs: 1,
    installedSids: channels, channels, sidChipBases: channels === 1 ? [0xd400] : [0xd400, 0xd420],
    sampleRate, registers: Array(channels * 32).fill(0),
    engine: {
      builder: 'fixture', version: '1', requestedPowerOnDelay: 0, effectivePowerOnDelay: 0,
      songSpeed: 'VBI', ciaModel: 'fixture', samplingMethod: 'fixture', digiBoost: false,
      traceCycleOrigin: 0, traceTimeBasis: 'fixture',
    },
  };
}

function write(timeSeconds: number, address: number, value: number, sidNumber = 0): SidWrite {
  return { timeSeconds, address, value, sidNumber, cyclePhi1: Math.round(timeSeconds * 1000000) };
}

function block(info: LoadResult, startFrame: number, endFrame: number, writes: SidWrite[] = [], pcm?: Int16Array, dropped = 0): RenderResult {
  const registers = info.registers.slice();
  for (const event of writes) registers[event.sidNumber * 32 + event.address] = event.value;
  return { startFrame, endFrame, writes, registers, dropped, pcm: pcm ?? new Int16Array((endFrame - startFrame) * info.channels) };
}

function near(actual: number | null, expected: number): void {
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-12, `${actual} differs from ${expected}`);
}

test('time-weighted controls count duration once despite redundant writes', () => {
  const info = profile();
  const analysis = new AnalysisAccumulator(info, 1000);
  analysis.append(block(info, 0, 1000, [
    write(0.1, 4, 0x11), write(0.2, 4, 0x11), write(0.25, 2, 0x40),
    write(0.3, 3, 0x08), write(0.6, 4, 0),
  ]));
  const voice = analysis.finish().voices[0];
  assert.equal(voice.observedWrites, 5);
  assert.equal(voice.valueChanges, 4);
  assert.equal(voice.gateTransitions, 2);
  near(voice.gateOnSeconds, 0.5);
  near(voice.waveformSeconds!.triangle, 0.5);
  near(voice.waveformSeconds!.none, 0.5);
  assert.deepEqual(voice.pulseWidthRange, { min: 0, max: 0x840 });
});

test('rapid gates remain visible even when the final register snapshot is unchanged', () => {
  const info = profile();
  const analysis = new AnalysisAccumulator(info, 1000);
  analysis.append(block(info, 0, 1000, [
    write(0.4, 4, 0x11), write(0.401, 4, 0x10), write(0.402, 4, 0x11), write(0.403, 4, 0x10),
  ]));
  const report = analysis.finish();
  assert.equal(report.voices[0].gateTransitions, 4);
  near(report.voices[0].gateOnSeconds, 0.002);
  assert.equal(report.moments.find(moment => moment.kind === 'gate')?.after, 1);
});

test('same-time writes preserve supplied order without inventing elapsed duration', () => {
  const info = profile();
  const analysis = new AnalysisAccumulator(info, 1000);
  analysis.append(block(info, 0, 1000, [write(0.4, 4, 0x11), write(0.4, 4, 0x21), write(0.4, 4, 0x20)]));
  const voice = analysis.finish().voices[0];
  assert.equal(voice.valueChanges, 3);
  assert.equal(voice.gateTransitions, 2);
  near(voice.gateOnSeconds, 0);
  near(voice.waveformSeconds!.triangle, 0);
  near(voice.waveformSeconds!.sawtooth, 0.6);
});

test('voice settings and shared filter state remain attached to their chip', () => {
  const info = profile(2);
  const analysis = new AnalysisAccumulator(info, 1000);
  analysis.append(block(info, 0, 1000, [
    write(0.2, 4, 0x11), write(0.3, 21, 7, 1), write(0.3, 22, 255, 1),
    write(0.6, 23, 1, 1), write(0.7, 4, 0x81, 1),
  ]));
  const report = analysis.finish();
  near(report.voices[0].gateOnSeconds, 0.8);
  near(report.voices[3].gateOnSeconds, 0.3);
  near(report.voices[3].waveformSeconds!.noise, 0.3);
  assert.deepEqual(report.chips[0].cutoffRange, { min: 0, max: 0 });
  assert.deepEqual(report.chips[1].cutoffRange, { min: 0, max: 2047 });
  near(report.chips[0].filterRoutingSeconds![0], 0);
  near(report.chips[1].filterRoutingSeconds![0], 0.4);
});

test('PCM metrics use signed-16-bit full scale and separate interleaved channels', () => {
  const mono = profile(1, 4);
  const analysis = new AnalysisAccumulator(mono, 4);
  analysis.append(block(mono, 0, 4, [], new Int16Array([-32768, 0, 16384, 32767])));
  const output = analysis.finish().output.channels[0];
  assert.equal(output.sampleCount, 4);
  assert.equal(output.peak, 1);
  near(output.rms, Math.sqrt((1 + 0.25 + (32767 / 32768) ** 2) / 4));
  near(output.dc, (-1 + 0.5 + 32767 / 32768) / 4);
  const stereo = profile(2, 2);
  const split = new AnalysisAccumulator(stereo, 2);
  split.append(block(stereo, 0, 2, [], new Int16Array([-32768, 0, 0, 16384])));
  const channels = split.finish().output.channels;
  near(channels[0].rms, Math.sqrt(0.5));
  near(channels[1].rms, Math.sqrt(0.125));
  near(channels[0].dc, -0.5);
  near(channels[1].dc, 0.25);
});

test('consumer chunk boundaries do not change the report, including events on a boundary', () => {
  const info = profile(2);
  const writes = [write(0.1, 4, 0x11), write(0.5, 4, 0x27), write(0.5, 23, 3, 1), write(0.9, 4, 0)];
  const pcm = Int16Array.from({ length: 2000 }, (_, index) => index % 200 - 100);
  const whole = new AnalysisAccumulator(info, 1000);
  whole.append(block(info, 0, 1000, writes, pcm));
  const divided = new AnalysisAccumulator(info, 1000);
  for (const [start, end] of [[0, 100], [100, 500], [500, 700], [700, 1000]]) {
    divided.append(block(info, start, end, writes.filter(event => event.timeSeconds >= start / 1000 && event.timeSeconds < end / 1000), pcm.slice(start * 2, end * 2)));
  }
  assert.deepEqual(divided.finish(), whole.finish());
});

test('the initial snapshot owns the first interval and a time-zero write replaces it immediately', () => {
  const info = profile();
  info.registers[4] = 0x31;
  info.registers[2] = 0x34;
  info.registers[3] = 2;
  info.registers[23] = 5;
  const unchanged = new AnalysisAccumulator(info, 1000);
  unchanged.append(block(info, 0, 1000));
  const report = unchanged.finish();
  near(report.voices[0].gateOnSeconds, 1);
  near(report.voices[0].waveformSeconds!.triangle, 1);
  near(report.voices[0].waveformSeconds!.sawtooth, 1);
  assert.deepEqual(report.voices[0].pulseWidthRange, { min: 0x234, max: 0x234 });
  assert.deepEqual(report.chips[0].filterRoutingSeconds, [1, 0, 1]);
  const immediate = new AnalysisAccumulator(info, 1000);
  immediate.append(block(info, 0, 1000, [write(0, 4, 0)]));
  near(immediate.finish().voices[0].gateOnSeconds, 0);
  assert.equal(immediate.finish().voices[0].gateTransitions, 1);
});

test('trace loss preserves observed counts and PCM but invalidates derived register precision', () => {
  const info = profile();
  const analysis = new AnalysisAccumulator(info, 1000);
  analysis.append(block(info, 0, 500, [write(0.3, 4, 0x11)]));
  analysis.append(block(info, 500, 1000, [write(0.6, 4, 0x20)], undefined, 2));
  const report = analysis.finish();
  assert.equal(report.coverage.droppedWrites, 2);
  assert.equal(report.coverage.droppedBlocks, 1);
  assert.equal(report.coverage.registerStateQuality, 'incomplete');
  assert.equal(report.coverage.reliableStateFrames, 500);
  assert.equal(report.voices[0].observedWrites, 2);
  assert.equal(report.voices[0].valueChanges, null);
  assert.equal(report.voices[0].gateOnSeconds, null);
  assert.equal(report.voices[0].waveformSeconds, null);
  assert.equal(report.chips[0].cutoffRange, null);
  assert.equal(report.output.channels[0].sampleCount, 1000);
  assert.ok(report.moments.every(moment => moment.timeSeconds < 0.5));
});

test('selection avoids startup spam and repeated gates while retaining explanatory non-gate changes', () => {
  const info = profile(2);
  const analysis = new AnalysisAccumulator(info, 1000);
  const writes = [write(0.01, 4, 0x11)];
  for (let index = 30; index < 90; index++) writes.push(write(index / 100, 4, index % 2 ? 0x10 : 0x11));
  writes.push(write(0.9, 4, 0x26), write(0.91, 23, 7));
  analysis.append(block(info, 0, 1000, writes));
  const report = analysis.finish();
  assert.ok(report.moments.length <= 12);
  assert.ok(report.moments.every(moment => moment.timeSeconds >= 0.25));
  assert.equal(report.moments.filter(moment => moment.kind === 'gate').length, 1);
  assert.ok(report.moments.some(moment => moment.kind === 'modulation'));
  assert.ok(report.moments.some(moment => moment.kind === 'filter-routing'));
  assert.equal(report.definitions.moments.maximum, 12);
});

test('bounded selection retains changes late in a busy interval instead of filling with its first events', () => {
  const info = profile(2, 10);
  const writes: SidWrite[] = [];
  for (let second = 0; second < 12; second++) {
    for (let chip = 0; chip < 2; chip++) {
      for (let voice = 0; voice < 3; voice++) writes.push(write(second + 0.3, voice * 7 + 4, second % 2 ? 0x27 : 0x11, chip));
    }
    writes.push(write(second + 0.4, 23, second % 2 ? 7 : 0));
  }
  const analysis = new AnalysisAccumulator(info, 120);
  analysis.append(block(info, 0, 120, writes));
  const report = analysis.finish();
  assert.equal(report.moments.length, 12);
  assert.ok(report.moments.some(moment => moment.timeSeconds > 11));
  assert.equal(new Set(report.moments.map(moment => Math.floor(moment.timeSeconds))).size, 12);
  assert.ok(JSON.stringify(report).length < 32768);
});

test('brief waveform resets and restoration do not become moments but remain measured', () => {
  const info = profile();
  info.registers[4] = 0x21;
  const analysis = new AnalysisAccumulator(info, 1000);
  analysis.append(block(info, 0, 1000, [write(0.3, 4, 0), write(0.301, 4, 0x21), write(0.6, 4, 0), write(0.601, 4, 0x21)]));
  const report = analysis.finish();
  assert.deepEqual(report.moments.filter(moment => moment.kind === 'waveform'), []);
  near(report.voices[0].waveformSeconds!.none, 0.002);
  near(report.voices[0].waveformSeconds!.sawtooth, 0.998);
  assert.equal(report.voices[0].observedWrites, 4);
  assert.equal(report.voices[0].valueChanges, 4);
  assert.equal(report.voices[0].gateTransitions, 4);
});

test('a sustained waveform after a brief reset compares with the preceding sustained setting', () => {
  const info = profile();
  info.registers[4] = 0x21;
  const analysis = new AnalysisAccumulator(info, 1000);
  analysis.append(block(info, 0, 1000, [write(0.3, 4, 0), write(0.301, 4, 0x41)]));
  const report = analysis.finish();
  assert.deepEqual(report.moments.filter(moment => moment.kind === 'waveform').map(moment => ({ time: moment.timeSeconds, before: moment.before, after: moment.after })), [
    { time: 0.301, before: 0x20, after: 0x40 },
  ]);
  near(report.voices[0].waveformSeconds!.sawtooth, 0.3);
  near(report.voices[0].waveformSeconds!.none, 0.001);
  near(report.voices[0].waveformSeconds!.pulse, 0.699);
  assert.equal(report.definitions.moments.waveformMinimumSeconds, 0.02);
});

test('brief deliberate waveforms stay in occupancy without becoming sustained-change candidates', () => {
  const info = profile();
  info.registers[4] = 0x21;
  const analysis = new AnalysisAccumulator(info, 1000);
  analysis.append(block(info, 0, 1000, [write(0.3, 4, 0x41), write(0.31, 4, 0x21), write(0.99, 4, 0x81)]));
  const report = analysis.finish();
  assert.deepEqual(report.moments.filter(moment => moment.kind === 'waveform'), []);
  near(report.voices[0].waveformSeconds!.pulse, 0.01);
  near(report.voices[0].waveformSeconds!.noise, 0.01);
  assert.equal(report.voices[0].valueChanges, 3);
});

test('finish confirms a final waveform only when its observed duration reaches 20 ms', () => {
  const info = profile();
  info.registers[4] = 0x21;
  for (const [time, count] of [[0.98, 1], [0.981, 0]]) {
    const analysis = new AnalysisAccumulator(info, 1000);
    analysis.append(block(info, 0, 1000, [write(time, 4, 0x41)]));
    const moments = analysis.finish().moments.filter(moment => moment.kind === 'waveform');
    assert.equal(moments.length, count);
    if (count) assert.deepEqual([moments[0].timeSeconds, moments[0].before, moments[0].after], [time, 0x20, 0x40]);
  }
});

test('sustained waveform confirmation spans consumer chunk boundaries without changing the report', () => {
  const info = profile();
  info.registers[4] = 0x21;
  const writes = [write(0.3, 4, 0), write(0.301, 4, 0x21), write(0.6, 4, 0), write(0.601, 4, 0x41)];
  const whole = new AnalysisAccumulator(info, 1000);
  whole.append(block(info, 0, 1000, writes));
  const divided = new AnalysisAccumulator(info, 1000);
  const frames = [0, 300, 301, 600, 601, 611, 700, 1000];
  for (let index = 1; index < frames.length; index++) {
    const start = frames[index - 1];
    const end = frames[index];
    divided.append(block(info, start, end, writes.filter(event => event.timeSeconds >= start / 1000 && event.timeSeconds < end / 1000)));
  }
  assert.deepEqual(divided.finish(), whole.finish());
  assert.deepEqual(whole.finish().moments.filter(moment => moment.kind === 'waveform').map(moment => [moment.timeSeconds, moment.before, moment.after]), [[0.601, 0x20, 0x40]]);
});

test('trace loss cannot supply the remaining duration needed to confirm a pending waveform', () => {
  const info = profile();
  info.registers[4] = 0x21;
  for (const [time, count] of [[0.48, 1], [0.49, 0]]) {
    const analysis = new AnalysisAccumulator(info, 1000);
    analysis.append(block(info, 0, 500, [write(time, 4, 0x41)]));
    analysis.append(block(info, 500, 1000, [], undefined, 1));
    assert.equal(analysis.finish().moments.filter(moment => moment.kind === 'waveform').length, count);
  }
});

test('invalid intervals, trace order and PCM lengths fail without accepting partial blocks', () => {
  const info = profile();
  for (const frames of [0, -1, Infinity, 600001, 1.5]) assert.throws(() => new AnalysisAccumulator(info, frames));
  const analysis = new AnalysisAccumulator(info, 1000);
  assert.throws(() => analysis.append(block(info, 1, 1000)), /contiguous/);
  assert.throws(() => analysis.append(block(info, 0, 1000, [write(1, 4, 0x11)])), /interval/);
  assert.throws(() => analysis.append(block(info, 0, 1000, [write(0.6, 4, 0), write(0.5, 4, 0)])), /order/);
  assert.throws(() => analysis.append(block(info, 0, 1000, [], new Int16Array(999))), /PCM/);
  analysis.append(block(info, 0, 1000));
  assert.equal(analysis.finish().coverage.renderedFrames, 1000);
  assert.throws(() => analysis.append(block(info, 1000, 1001)));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {SidSession} from '../../../src/engine/session.ts';
import {dualSid, monoSid} from '../../../tests/fixtures/dual-sid.ts';
import {AnalysisAccumulator} from './analysis.ts';

const moduleUrl = pathToFileURL(resolve('build/engine/libsidplayfp.js')).href;
const profile = {clock: 'PAL', model: 'MOS8580', subtune: 1} as const;

test('real diagnostic program preserves known controls and independent channel PCM statistics', async () => {
  const session = await SidSession.create({moduleUrl});
  const active = await SidSession.create({moduleUrl});
  const frames = 22050;
  try {
    const info = await session.load(dualSid(profile.model, 1), profile);
    await active.load(monoSid(profile.model, 1), profile);
    const aggregate = new AnalysisAccumulator(info, frames);
    const raw = session.render(frames);
    aggregate.append(raw);
    const report = aggregate.finish();
    assert.equal(report.coverage.droppedWrites, 0);
    for (const voice of report.voices) {
      assert.equal(voice.gateTransitions, voice.chip === 1 ? 1 : 0);
      assert.equal(voice.waveformSeconds!.pulse, 0);
      assert.equal(voice.waveformSeconds!.noise, 0);
      assert.equal(voice.waveformSeconds!.triangle, 0);
      if (voice.chip === 0) assert.equal(voice.gateOnSeconds, 0);
      else {
        const gate = raw.writes.find(write => write.sidNumber === 1 && write.address === voice.voice * 7 + 4)!;
        assert.equal(gate.value, 0x21);
        assert.ok(Math.abs(voice.gateOnSeconds! - (0.5 - gate.timeSeconds)) < 1e-12);
        assert.equal(voice.gateOnSeconds, voice.waveformSeconds!.sawtooth);
      }
    }
    assert.deepEqual(report.chips.map(chip => chip.filterRoutingSeconds), [[0, 0, 0], [0, 0, 0]]);
    assert.deepEqual(report.moments, []);
    for (const [channel, pcm] of [raw.pcm.filter((_, index) => index % 2 === 0), active.render(frames).pcm].entries()) {
      if (channel === 1) assert.deepEqual(raw.pcm.filter((_, index) => index % 2 === channel), pcm);
      const samples = Array.from(pcm, value => value / 32768);
      const mean = samples.reduce((sum, value) => sum + value, 0) / frames;
      const squares = samples.reduce((sum, value) => sum + value * value, 0) / frames;
      assert.equal(report.output.channels[channel].dc, mean);
      assert.equal(report.output.channels[channel].rms, Math.sqrt(squares));
      assert.equal(report.output.channels[channel].peak, Math.max(...samples.map(Math.abs)));
    }
  } finally {
    session.dispose();
    active.dispose();
  }
});

test('real sequential observations produce identical reports at different consumer chunk boundaries', async () => {
  const whole = await SidSession.create({moduleUrl});
  const split = await SidSession.create({moduleUrl});
  try {
    const bytes = dualSid(profile.model);
    const first = new AnalysisAccumulator(await whole.load(bytes, profile), 22050);
    const second = new AnalysisAccumulator(await split.load(bytes, profile), 22050);
    first.append(whole.render(22050));
    for (const frames of [1, 12346, 9703]) second.append(split.render(frames));
    assert.deepEqual(first.finish(), second.finish());
  } finally {
    whole.dispose();
    split.dispose();
  }
});

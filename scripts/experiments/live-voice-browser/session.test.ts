import assert from 'node:assert/strict';
import {test} from 'node:test';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {
  LiveVoiceSession,
  type CaptureBlock,
  type LiveVoiceModule,
  type ModuleFactory,
  type Profile,
} from './session.ts';

const rate = 44100;
const recordBytes = 10;
const checkpoint = (chips: number, model: Profile['model'] = 'MOS6581') => Int32Array.from(
  Array.from({length: chips}, () => [1, 0, 0, 0, 0, 0, Number(model === 'MOS8580'), rate]).flat(),
);
const monoProfile = {model: 'MOS6581', clock: 'PAL'} as const;

function fakeModule(captures: CaptureBlock[] = []) {
  const calls = {players: 0, deletedPlayers: 0, replays: 0, deletedReplays: 0, renders: 0, configured: [] as unknown[]};
  let current: CaptureBlock;
  const module: LiveVoiceModule = {
    SidPlayerContext: class {
      constructor() { calls.players++; }
      configure(...args: unknown[]) { calls.configured.push(args); return true; }
      setEmulationConfig(config: unknown) { calls.configured.push(config); return true; }
      loadSidBuffer() { return true; }
      getInstalledSids() { return 1; }
      getLastError() { return 'fake engine error'; }
      renderCapture() { calls.renders++; current = captures.shift()!; return current; }
      delete() { calls.deletedPlayers++; }
    },
    VoiceReplay: class {
      constructor(state: Int32Array) {
        calls.replays++;
        current.records.fill(255);
        current.checkpoint.fill(255);
        assert.equal(state[0], 1, 'checkpoint must be copied before another WASM call');
      }
      render(records: Uint8Array, mask: number) {
        assert.equal(records[0], 17, 'records must be copied before another WASM call');
        return Int16Array.from({length: records.length / recordBytes}, () => mask);
      }
      delete() { calls.deletedReplays++; }
    },
  };
  return {module, calls};
}

function block(frames = 3): CaptureBlock {
  return {frames, chips: 1, pcm: new Int16Array(frames), records: new Uint8Array(frames * recordBytes).fill(17), checkpoint: checkpoint(1)};
}

test('copies capture views before replay allocation and preserves one replay across masks', async () => {
  const fake = fakeModule([block(0), block(), block(), block()]);
  const session = await LiveVoiceSession.create({moduleFactory: async () => fake.module});
  try {
    assert.deepEqual(session.load(new Uint8Array([1]), monoProfile), {chips: 1, rate});
    assert.deepEqual(fake.calls.configured[0], [rate, true]);
    assert.deepEqual(fake.calls.configured[1], {
      frequency: rate, stereo: true, c64Model: 'PAL', forceC64Model: true,
      sidModel: 'MOS6581', forceSidModel: true, powerOnDelay: 0, secondSidAddress: 0, thirdSidAddress: 0,
    });
    assert.equal(session.render(7).endFrame, 0);
    assert.equal(fake.calls.replays, 0, 'startup with no output must not establish a filter checkpoint');
    for (const [index, mask] of [7, 0, 1].entries()) {
      const result = session.render(mask);
      assert.deepEqual(result, {pcm: Int16Array.from([mask, mask, mask]), startFrame: index * 3, endFrame: (index + 1) * 3, mask, chips: 1});
    }
    assert.equal(fake.calls.replays, 1);
    assert.equal(fake.calls.deletedReplays, 0);
    session.load(new Uint8Array([1]), monoProfile);
    assert.equal(fake.calls.deletedPlayers, 1);
    assert.equal(fake.calls.deletedReplays, 1);
    session.dispose();
    session.dispose();
    assert.equal(fake.calls.deletedPlayers, 2);
    assert.throws(() => session.render(7), /load|disposed/i);
  } finally { session.dispose(); }
});

test('rejects invalid masks before advancing emulation', async () => {
  const fake = fakeModule([block()]);
  const session = await LiveVoiceSession.create({moduleFactory: async () => fake.module});
  try {
    session.load(new Uint8Array([1]), monoProfile);
    for (const mask of [-1, 8, 1.5, NaN, Infinity, 2 ** 32 + 7]) assert.throws(() => session.render(mask), /mask/i);
    assert.equal(fake.calls.renders, 0);
  } finally { session.dispose(); }
});

test('accepts the native 4096-frame capture limit', async () => {
  const fake = fakeModule([block(4096)]);
  const session = await LiveVoiceSession.create({moduleFactory: async () => fake.module});
  try {
    session.load(new Uint8Array([1]), monoProfile);
    const result = session.render(7);
    assert.equal(result.startFrame, 0);
    assert.equal(result.endFrame, 4096);
    assert.equal(result.pcm.length, 4096);
    assert.ok(result.pcm.every(sample => sample === 7));
  } finally { session.dispose(); }
});

test('rejects malformed capture counts, checkpoint flags and output sizes', async () => {
  const cases: Array<[string, (capture: CaptureBlock) => void]> = [
    ['frame count', capture => { Object.assign(capture, block(4097)); }],
    ['fractional frame count', capture => { capture.frames = 1.5; }],
    ['chip count', capture => { capture.chips = 2; }],
    ['record count', capture => { capture.records = new Uint8Array(1); }],
    ['PCM count', capture => { capture.pcm = new Int16Array(1); }],
    ['checkpoint count', capture => { capture.checkpoint = new Int32Array(1); }],
    ['checkpoint version', capture => { capture.checkpoint[0] = 2; }],
    ['checkpoint flags', capture => { capture.checkpoint[6] = 4; }],
    ['checkpoint model', capture => { capture.checkpoint[6] = 1; }],
    ['checkpoint rate', capture => { capture.checkpoint[7] = 48000; }],
  ];
  for (const [name, mutate] of cases) {
    const capture = block();
    mutate(capture);
    const fake = fakeModule([capture]);
    const session = await LiveVoiceSession.create({moduleFactory: async () => fake.module});
    try {
      session.load(new Uint8Array([1]), monoProfile);
      assert.throws(() => session.render(7), /capture|checkpoint/i, name);
      assert.throws(() => session.render(7), /load|failed/i, `${name}: invalid capture must prevent discontinuous continuation`);
      assert.equal(fake.calls.replays, 0, name);
    } finally { session.dispose(); }
  }
});

const fixtureUrl = pathToFileURL(resolve('scripts/experiments/live-voice-replay/fixtures.mjs')).href;
const captureUrl = pathToFileURL(resolve('build/live-voice-replay/output/libsidplayfp.js')).href;
const rawUrl = pathToFileURL(resolve('build/stereo-gate/output/libsidplayfp.js')).href;
const fixture = await import(fixtureUrl) as {syntheticSid: (settings: Profile & {kind: string; chips: number}) => Uint8Array};
const captureFactory = (await import(captureUrl)).default as ModuleFactory;
interface RawContext {
  configure(rate: number, stereo: boolean): boolean;
  setEmulationConfig(config: unknown): boolean;
  loadSidBuffer(bytes: Uint8Array): boolean;
  renderRaw(cycles: number): Int16Array;
  delete(): void;
}
const rawFactory = (await import(rawUrl)).default as () => Promise<{SidPlayerContext: new () => RawContext}>;

function configure(context: Pick<RawContext, 'configure' | 'setEmulationConfig' | 'loadSidBuffer'>, bytes: Uint8Array, profile: Profile) {
  assert.equal(context.configure(rate, true), true);
  assert.equal(context.setEmulationConfig({frequency: rate, stereo: true, c64Model: profile.clock,
    forceC64Model: true, sidModel: profile.model, forceSidModel: true, powerOnDelay: 0, secondSidAddress: 0, thirdSidAddress: 0}), true);
  assert.equal(context.loadSidBuffer(bytes), true);
}

for (const model of ['MOS6581', 'MOS8580'] as const) {
  for (const clock of ['PAL', 'NTSC'] as const) {
    for (const chips of [1, 2] as const) {
      test(`${model}/${clock}/${chips} chips: all voices equal adopted raw PCM; masks retain filter history across split oracle reads`, {timeout: 10000}, async () => {
        const profile = {model, clock};
        const bytes = fixture.syntheticSid({...profile, kind: 'filter', chips});
        const module = await captureFactory();
        const rawModule = await rawFactory();
        const session = await LiveVoiceSession.create({moduleFactory: async () => module});
        const captured = new module.SidPlayerContext();
        const raw = new rawModule.SidPlayerContext();
        const fullMask = (1 << chips * 3) - 1;
        let replay: InstanceType<LiveVoiceModule['VoiceReplay']> | undefined;
        let frame = 0;
        let resetWouldDiffer = false;
        let heardNonzero = false;
        try {
          assert.deepEqual(session.load(bytes, profile), {chips, rate});
          configure(captured, bytes, profile);
          configure(raw, bytes, profile);
          for (let index = 0; index < 36; index++) {
            const mask = index < 10 || index >= 25 ? fullMask : index < 17 ? 1 : 0;
            const actual = session.render(mask);
            const capture = captured.renderCapture(20000)!;
            const records = capture.records.slice();
            const state = capture.checkpoint.slice();
            const originalPcm = raw.renderRaw(20000).slice();
            assert.equal(actual.startFrame, frame);
            assert.equal(actual.endFrame, frame + capture.frames);
            assert.equal(actual.chips, chips);
            assert.equal(actual.mask, mask);
            if (index < 10) assert.deepEqual(actual.pcm, originalPcm, 'all voices must equal the unmodified raw-chip engine');
            if (capture.frames) {
              replay ??= new module.VoiceReplay(state);
              const split = Math.min(137, capture.frames) * chips * recordBytes;
              const prefix = replay.render(records.subarray(0, split), mask).slice();
              const suffix = replay.render(records.subarray(split), mask).slice();
              const expected = new Int16Array(prefix.length + suffix.length);
              expected.set(prefix);
              expected.set(suffix, prefix.length);
              assert.deepEqual(actual.pcm, expected, `persistent filter continuation at frame ${frame}`);
              const reset = new module.VoiceReplay(state);
              try {
                const resetPcm = reset.render(records, mask).slice();
                resetWouldDiffer ||= resetPcm.some((sample, offset) => sample !== expected[offset]);
              } finally { reset.delete(); }
              heardNonzero ||= actual.pcm.some(sample => sample !== 0);
            }
            frame = actual.endFrame;
          }
          assert.ok(frame > rate / 2);
          assert.ok(heardNonzero);
          assert.ok(resetWouldDiffer, 'the filtered fixture must reject restoring the all-voice checkpoint after mask changes');
          session.load(bytes, profile);
          assert.equal(session.render(fullMask).startFrame, 0, 'reload starts a fresh live engine and filter');
        } finally { session.dispose(); replay?.delete(); captured.delete(); raw.delete(); }
      });
    }
  }
}

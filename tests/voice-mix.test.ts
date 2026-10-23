import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceMix, voiceMixMask, voiceIsSolo, updateVoiceMix, type VoiceMix, type VoiceMixAction} from '../src/voice-mix.ts';

function frozenMix(muted: readonly boolean[], enabledChips: readonly boolean[]): VoiceMix {
  return Object.freeze({muted: Object.freeze([...muted]), enabledChips: Object.freeze([...enabledChips])});
}

for (const chips of [1, 2] as const) {
  test(`${chips}-chip mixes start with all installed voices and chips enabled`, () => {
    const mix = createVoiceMix(chips);
    assert.deepEqual(mix, {muted: Array(chips * 3).fill(false), enabledChips: Array(chips).fill(true)});
    assert.deepEqual(voiceMixMask(mix), Array(chips * 3).fill(false));
    for (let voice = 0; voice < chips * 3; voice++) assert.equal(voiceIsSolo(mix, voice), false);
  });

  test(`one chip action produces the complete ${chips}-chip intervention mask`, () => {
    for (let chip = 0; chip < chips; chip++) {
      const mix = updateVoiceMix(createVoiceMix(chips), {type: 'chip', chip});
      assert.deepEqual(mix.muted, Array(chips * 3).fill(false));
      assert.deepEqual(voiceMixMask(mix), Array.from({length: chips * 3}, (_, voice) => Math.floor(voice / 3) === chip));
    }
  });
}

test('chip off/on cycles restore each voice preference on both chips', () => {
  let mix = createVoiceMix(2);
  mix = updateVoiceMix(mix, {type: 'mute', voice: 0});
  mix = updateVoiceMix(mix, {type: 'mute', voice: 4});
  const preferences = [true, false, false, false, true, false];
  assert.deepEqual(mix.muted, preferences);
  mix = updateVoiceMix(mix, {type: 'chip', chip: 0});
  mix = updateVoiceMix(mix, {type: 'chip', chip: 1});
  assert.deepEqual(voiceMixMask(mix), [true, true, true, true, true, true]);
  assert.deepEqual(mix.muted, preferences);
  mix = updateVoiceMix(mix, {type: 'chip', chip: 0});
  assert.deepEqual(voiceMixMask(mix), [true, false, false, true, true, true]);
  mix = updateVoiceMix(mix, {type: 'chip', chip: 1});
  assert.deepEqual(mix.muted, preferences);
  assert.deepEqual(voiceMixMask(mix), preferences);
});

test('voice preference edits while a chip is disabled become audible only when it returns', () => {
  let mix = frozenMix([false, false, false, false, true, false], [true, false]);
  mix = updateVoiceMix(mix, {type: 'mute', voice: 4});
  mix = updateVoiceMix(mix, {type: 'mute', voice: 5});
  assert.deepEqual(mix.muted, [false, false, false, false, false, true]);
  assert.deepEqual(voiceMixMask(mix), [false, false, false, true, true, true]);
  mix = updateVoiceMix(mix, {type: 'chip', chip: 1});
  assert.deepEqual(voiceMixMask(mix), [false, false, false, false, false, true]);
});

test('mute toggles only the selected voice preference', () => {
  const original = frozenMix([true, false, true, false, true, false], [false, true]);
  const changed = updateVoiceMix(original, {type: 'mute', voice: 4});
  assert.deepEqual(changed, {muted: [true, false, true, false, false, false], enabledChips: [false, true]});
  assert.deepEqual(updateVoiceMix(changed, {type: 'mute', voice: 4}), original);
});

test('solo enables its disabled target chip and preserves the other disabled chip', () => {
  const mix = updateVoiceMix(frozenMix([false, true, false, true, false, true], [false, false]), {type: 'solo', voice: 4});
  assert.deepEqual(mix, {muted: [true, true, true, true, false, true], enabledChips: [false, true]});
  assert.deepEqual(voiceMixMask(mix), [true, true, true, true, false, true]);
  assert.equal(voiceIsSolo(mix, 4), true);
  assert.equal(voiceIsSolo(mix, 0), false);
});

test('solo on an enabled chip preserves the other enabled chip state', () => {
  const mix = updateVoiceMix(createVoiceMix(2), {type: 'solo', voice: 2});
  assert.deepEqual(mix, {muted: [true, true, false, true, true, true], enabledChips: [true, true]});
  assert.equal(voiceIsSolo(mix, 2), true);
});

test('clicking active solo clears voice mutes while preserving chip switches', () => {
  const solo = frozenMix([true, true, true, true, false, true], [false, true]);
  const mix = updateVoiceMix(solo, {type: 'solo', voice: 4});
  assert.deepEqual(mix, {muted: [false, false, false, false, false, false], enabledChips: [false, true]});
  assert.deepEqual(voiceMixMask(mix), [true, true, true, false, false, false]);
  assert.equal(voiceIsSolo(mix, 4), false);
});

test('solo on another voice replaces the global preferred solo', () => {
  const first = updateVoiceMix(createVoiceMix(2), {type: 'solo', voice: 0});
  const next = updateVoiceMix(first, {type: 'solo', voice: 5});
  assert.deepEqual(next.muted, [true, true, true, true, true, false]);
  assert.equal(voiceIsSolo(next, 0), false);
  assert.equal(voiceIsSolo(next, 5), true);
});

test('a disabled remembered solo is inactive and solo re-enables it without clearing preferences', () => {
  const disabled = frozenMix([true, false, true], [false]);
  assert.equal(voiceIsSolo(disabled, 1), false);
  const enabled = updateVoiceMix(disabled, {type: 'solo', voice: 1});
  assert.deepEqual(enabled, {muted: [true, false, true], enabledChips: [true]});
  assert.equal(voiceIsSolo(enabled, 1), true);
});

test('solo detection uses global voice preferences rather than chip masking', () => {
  const mix = frozenMix([false, true, true, false, false, false], [true, false]);
  assert.deepEqual(voiceMixMask(mix), [false, true, true, true, true, true]);
  assert.equal(voiceIsSolo(mix, 0), false);
});

test('Full mix clears every preferred mute and re-enables every chip', () => {
  assert.deepEqual(updateVoiceMix(frozenMix([true, false, true, false, true, true], [false, false]), {type: 'restore'}), createVoiceMix(2));
  assert.deepEqual(updateVoiceMix(frozenMix([true, true, false], [false]), {type: 'restore'}), createVoiceMix(1));
});

test('every action returns a new mix without mutating frozen input', () => {
  const original = frozenMix([false, true, false, true, false, true], [false, true]);
  const actions: VoiceMixAction[] = [{type: 'mute', voice: 1}, {type: 'solo', voice: 4}, {type: 'chip', chip: 1}, {type: 'restore'}];
  for (const action of actions) {
    assert.notEqual(updateVoiceMix(original, action), original);
    assert.deepEqual(original, {muted: [false, true, false, true, false, true], enabledChips: [false, true]});
  }
  const mask = voiceMixMask(original);
  mask.fill(false);
  assert.deepEqual(original.muted, [false, true, false, true, false, true]);
});

for (const chips of [1, 2] as const) {
  test(`invalid voice or chip IDs cannot extend the ${chips}-chip mix`, () => {
    const mix = frozenMix(Array(chips * 3).fill(false), Array(chips).fill(true));
    for (const voice of [-1, .5, chips * 3, chips * 3 + 10, NaN, Infinity]) {
      assert.throws(() => voiceIsSolo(mix, voice), /invalid.*voice/i);
      assert.throws(() => updateVoiceMix(mix, {type: 'mute', voice}), /invalid.*voice/i);
      assert.throws(() => updateVoiceMix(mix, {type: 'solo', voice}), /invalid.*voice/i);
    }
    for (const chip of [-1, .5, chips, chips + 10, NaN, Infinity]) {
      assert.throws(() => updateVoiceMix(mix, {type: 'chip', chip}), /invalid.*chip/i);
    }
    assert.deepEqual(mix, createVoiceMix(chips));
  });
}

test('only supported installed chip counts can create a mix', () => {
  for (const chips of [0, 3, 1.5, NaN]) assert.throws(() => createVoiceMix(chips as 1 | 2), /chip/i);
});

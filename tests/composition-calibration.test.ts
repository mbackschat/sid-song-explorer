import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {alignComposition, noteSignature} from '../scripts/calibrate-composition.ts';
import {parseCompositionPackage} from '../src/composition-package.ts';
import type {SidWrite} from '../src/engine/session.ts';

const pkg = parseCompositionPackage(JSON.parse(readFileSync(new URL('../config/composition.json', import.meta.url), 'utf8')));
const events = [...new Map(pkg.passages.flatMap(passage => passage.events).map(event => [event.id, event])).values()];

function writes(clockHz: number): SidWrite[] {
  return events.flatMap(event => {
    const voice = pkg.allocations.find(allocation => allocation.partId === event.partId)!.voice;
    const time = (event.sourceCall - 1586) * 19656 / clockHz + 0.009 + voice * 0.001;
    return noteSignature(pkg, event).map((write, index) => ({
      ...write, sidNumber: 0, timeSeconds: time + index / clockHz, cyclePhi1: Math.round(time * clockHz) + index,
    }));
  }).sort((a, b) => a.timeSeconds - b.timeSeconds);
}

test('alignment requires complete ordered note initialization, not an equal sustained frequency', () => {
  const complete = writes(983981.25);
  const aligned = alignComposition(pkg, complete);
  assert.equal(aligned.checkedEvents, 101);
  assert.ok(aligned.maxOnsetErrorSeconds < 0.003);
  const missingPair = complete.slice();
  missingPair.splice(1, 1);
  assert.throws(() => alignComposition(pkg, missingPair), /complete ordered note-init signature/);
  const equalFrequency = complete.map(write => ({...write, address: 1, value: 25}));
  assert.throws(() => alignComposition(pkg, equalFrequency), /complete ordered note-init signature/);
});

test('nominal C64 seconds fail the audio timeline oracle while the quantized PCM clock aligns both passages', () => {
  assert.throws(() => alignComposition(pkg, writes(17734475 / 18)), /complete ordered note-init signature/);
  const aligned = alignComposition(pkg, writes(983981.25));
  for (const passage of pkg.passages) {
    assert.ok(aligned.matches.some(match => match.sourceCall >= passage.sourceStartCall && match.sourceCall < passage.sourceEndCall));
  }
});

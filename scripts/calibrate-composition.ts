import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {SidSession, type SidWrite} from '../src/engine/session.ts';
import {parseCompositionPackage, type CompositionPackage, type CompositionEvent} from '../src/composition-package.ts';
import {parseProducerJson} from '../src/producer-catalog.ts';

const PCM_CYCLES_PER_SECOND = 983981.25;
const MAX_ONSET_ERROR_SECONDS = 0.01;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function noteSignature(pkg: CompositionPackage, event: CompositionEvent): {address: number; value: number}[] {
  const allocation = pkg.allocations.find(item => item.partId === event.partId)!;
  const data = pkg.instruments.find(item => item.id === event.instrumentId)!.program.data;
  const base = (allocation.voice - 1) * 7;
  // Crafter's pinned songs/players/rambo.asm rb_note_registers writes zero/data pairs from SR down to pulse-low.
  return [6, 5, 4, 3, 2].flatMap(register => [{address: base + register, value: 0}, {address: base + register, value: data[20 + register]!}]);
}

export function alignComposition(pkg: CompositionPackage, writes: SidWrite[]) {
  const events = [...new Map(pkg.passages.flatMap(passage => passage.events).map(event => [event.id, event])).values()]
    .sort((a, b) => a.sourceCall - b.sourceCall || a.partId.localeCompare(b.partId));
  const matches = events.map(event => {
    const signature = noteSignature(pkg, event);
    const nominalPcm = (event.sourceCall - pkg.timing.sourceStartCall) * pkg.timing.callCycles / PCM_CYCLES_PER_SECOND;
    const candidates = writes.filter((write, index) =>
      Math.abs(write.timeSeconds - nominalPcm) < 0.04 &&
      signature.every((expected, offset) => {
        const actual = writes[index + offset];
        return actual?.sidNumber === 0 && actual.address === expected.address && actual.value === expected.value;
      }));
    assert.equal(candidates.length, 1, `${event.id}: expected one complete ordered note-init signature near the source call`);
    return {id: event.id, sourceCall: event.sourceCall, timeSeconds: candidates[0]!.timeSeconds, cyclePhi1: candidates[0]!.cyclePhi1};
  });
  assert.ok(matches.length > 1, 'Need multiple independent event boundaries');
  const anchor = {sourceCall: matches[0]!.sourceCall, timeSeconds: matches[0]!.timeSeconds};
  const error = (match: typeof matches[number]) => match.timeSeconds - (anchor.timeSeconds + (match.sourceCall - anchor.sourceCall) * pkg.timing.callCycles / PCM_CYCLES_PER_SECOND);
  const maxOnsetErrorSeconds = Math.max(...matches.map(match => Math.abs(error(match))));
  assert.ok(maxOnsetErrorSeconds <= MAX_ONSET_ERROR_SECONDS, `Source-to-PCM onset deviation ${maxOnsetErrorSeconds}s exceeds half a PAL call`);
  for (const passage of pkg.passages) {
    assert.ok(matches.some(match => match.sourceCall >= passage.sourceStartCall && match.sourceCall < passage.sourceEndCall), 'Each passage needs observed onsets');
  }
  return {anchor, maxOnsetErrorSeconds, checkedEvents: matches.length, matches: matches.map(match => ({...match, errorSeconds: error(match)}))};
}

async function main(): Promise<void> {
  const check = process.argv.slice(2);
  assert.ok(check.length === 0 || (check.length === 1 && check[0] === '--check'), 'Usage: node scripts/calibrate-composition.ts [--check]');
  const started = performance.now();
  const packageBytes = await readFile('config/composition.json');
  const pkg = parseCompositionPackage(parseProducerJson(packageBytes.toString('utf8')));
  const sid = await readFile('public/generated/rambo-loader-main.sid');
  assert.equal(digest(sid), pkg.binding.sidSha256);
  const engine = {
    moduleSha256: digest(await readFile('build/engine/libsidplayfp.js')),
    wasmSha256: digest(await readFile('build/engine/libsidplayfp.wasm')),
    sessionSha256: digest(await readFile('src/engine/session.ts')),
  };
  const session = await SidSession.create({moduleUrl: pathToFileURL(resolve('build/engine/libsidplayfp.js')).href});
  try {
    const info = await session.load(sid, {clock: 'PAL', model: 'MOS6581', subtune: 1});
    const firstCall = Math.min(...pkg.passages.flatMap(passage => passage.events.map(event => event.sourceCall)));
    const firstSecond = Math.floor((firstCall - pkg.timing.sourceStartCall) * pkg.timing.callCycles / PCM_CYCLES_PER_SECOND) - 1;
    const lastSecond = Math.ceil(Math.max(...pkg.passages.map(passage => (passage.sourceEndCall - pkg.timing.sourceStartCall) * pkg.timing.callCycles / PCM_CYCLES_PER_SECOND))) + 1;
    const writes: SidWrite[] = [];
    for (let second = 0; second < lastSecond; second++) {
      assert.ok(performance.now() - started < 60_000, 'Composition calibration exceeded 60 seconds');
      const block = session.render(info.sampleRate);
      assert.equal(block.dropped, 0, 'Complete ordered writes required');
      if (second >= firstSecond) writes.push(...block.writes);
      if (second % 10 === 0) process.stdout.write(`Rendered ${second + 1}/${lastSecond} seconds\n`);
    }
    const {matches, ...alignment} = alignComposition(pkg, writes);
    const timing = {schemaVersion: 1, packageSha256: digest(packageBytes), engine, sampleRate: 44100, cyclesPerSecond: PCM_CYCLES_PER_SECOND, ...alignment};
    const encoded = `${JSON.stringify(timing, null, 2)}\n`;
    if (check.length) assert.equal(await readFile('config/composition-timing.json', 'utf8'), encoded, 'Committed timing differs from actual engine calibration');
    else await writeFile('config/composition-timing.json', encoded);
    await mkdir('build/composition', {recursive: true});
    await writeFile('build/composition/onset-alignment.json', `${JSON.stringify({timing, matches}, null, 2)}\n`);
    process.stdout.write(`Verified ${matches.length} note-init signatures; maximum onset deviation ${(alignment.maxOnsetErrorSeconds * 1000).toFixed(3)} ms; ${(performance.now() - started).toFixed(0)} ms elapsed\n`);
  } finally {
    session.dispose();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error: unknown) => {console.error(error); process.exitCode = 1;});
}

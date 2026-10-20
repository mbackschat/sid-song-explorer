import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCompositionView, mountCompositionPanel, phrasePlaybackRange} from '../src/composition-panel.ts';
import type {CompositionEvent} from '../src/composition-package.ts';
import type {PlaybackCompositionPackage} from '../src/composition-time.ts';

function event(value: Omit<CompositionEvent, 'entrySound' | 'evidenceLevel'>): CompositionEvent {
  return {...value, entrySound: Array<number>(39).fill(0), evidenceLevel: 'verified'};
}

function composition(): PlaybackCompositionPackage {
  return {
    schemaVersion: 1, id: 'rambo-passages', catalogEntryId: 'rambo-loader-main', title: 'Rambo selected passages',
    source: {repository: 'https://github.com/example/crafter', revision: 'a'.repeat(40), scorePath: 'songs/score.json', evidencePath: 'docs/study.md', rightsPath: 'LICENSE'},
    binding: {sidSha256: 'b'.repeat(64), subtune: 1, clock: 'PAL', sidModel: 'MOS6581', sidCount: 1, baseAddress: 54272, routing: 'mono'},
    sourceTiming: {sourceStartCall: 1586, callCycles: 19656, clockHz: 17734475 / 18, timeBasis: 'source-call-grid', rule: '(sourceCall-sourceStartCall)*callCycles/clockHz'},
    timing: {timeBasis: 'sidlite-pcm', sampleRate: 44100, maxOnsetErrorSeconds: 0.004},
    coverage: {scope: 'selected-passages', wholeSong: false, description: 'Two source-backed phrases; other regions are not mapped.'},
    parts: [
      {id: 'lead', title: 'Lead', role: 'Carries the melody', evidenceLevel: 'verified', sourcePath: 'docs/study.md#lead'},
      {id: 'bass', title: 'Bass', role: 'Supports the harmony', evidenceLevel: 'interpretation', sourcePath: 'docs/study.md#bass'},
    ],
    instruments: [
      {id: 'pulse', title: 'Moving pulse', description: 'A recovered source program state.', evidenceLevel: 'verified', behavior: ['Pulse width evolves after the onset.'], kind: 'source-program-state', program: {data: Array<number>(49).fill(1)}, sourcePath: 'docs/programs.md#pulse'},
      {id: 'pluck', title: '<img src=x onerror=alert(1)>', description: 'Short articulation', evidenceLevel: 'verified', behavior: ['The next onset restarts the program.'], kind: 'source-program-state', program: {data: Array<number>(49).fill(3)}, sourcePath: 'docs/programs.md#pluck'},
    ],
    allocations: [{partId: 'lead', chip: 1, voice: 1}, {partId: 'bass', chip: 1, voice: 2}],
    passages: [
      {
        id: 'statement', title: 'First statement', sourceStartCall: 1586, sourceEndCall: 2086, startSeconds: 0, endSeconds: 10,
        recurrence: null, description: 'Hear how the lead leaves room for the accompaniment.', evidenceLevel: 'interpretation',
        events: [
          event({id: 'lead-1', partId: 'lead', instrumentId: 'pulse', sourceCall: 1586, endSourceCall: 1686, startSeconds: 0, endSeconds: 2, pitchIndex: 40, frequencyWord: 1000, nodeId: 'node-1', sourceAddress: 4096}),
          event({id: 'lead-2', partId: 'lead', instrumentId: 'pulse', sourceCall: 1786, endSourceCall: 1886, startSeconds: 4, endSeconds: 6, pitchIndex: 42, frequencyWord: 1200, nodeId: 'node-2', sourceAddress: 4100}),
          event({id: 'bass-1', partId: 'bass', instrumentId: 'pluck', sourceCall: 1586, endSourceCall: 1786, startSeconds: 0, endSeconds: 4, pitchIndex: 20, frequencyWord: 200, nodeId: 'node-3', sourceAddress: 4104}),
        ],
        dependencies: [{kind: 'shared-chip-filter', partIds: ['lead', 'bass'], description: 'Both parts share one chip filter.', sourcePath: 'docs/study.md#filter', evidenceLevel: 'verified'}], sourcePath: 'docs/study.md#statement',
      },
      {
        id: 'return', title: 'Later return', sourceStartCall: 2586, sourceEndCall: 3086, startSeconds: 20, endSeconds: 30,
        recurrence: {of: 'statement', partIds: ['lead'], relationship: 'same-source-phrase', description: 'The lead repeats the same source phrase.'}, description: 'The same lead phrase returns.', evidenceLevel: 'interpretation',
        events: [event({id: 'lead-3', partId: 'lead', instrumentId: 'pulse', sourceCall: 2586, endSourceCall: 2786, startSeconds: 20, endSeconds: 24, pitchIndex: 52, frequencyWord: 2000, nodeId: 'node-4', sourceAddress: 4108})],
        dependencies: [], sourcePath: 'docs/study.md#return',
      },
    ],
    rights: {license: 'GPL-3.0-only', attribution: 'Example source attribution', sourcePath: 'LICENSE'},
  };
}

test('musical occurrences group events by passage, part and source program without filling silent gaps', () => {
  const view = buildCompositionView(composition(), 1, 1);
  assert.equal(view.occurrences.length, 3);
  assert.equal(view.selected?.part.id, 'lead');
  assert.equal(view.selected?.instrument.id, 'pulse');
  assert.deepEqual(view.selected?.spans, [
    {startSeconds: 0, endSeconds: 2, voice: 1},
    {startSeconds: 4, endSeconds: 6, voice: 1},
  ]);
  assert.equal(view.selected?.comparison?.passage.id, 'return');
  assert.equal(view.selected?.dependencies[0]?.description, 'Both parts share one chip filter.');
  assert.equal(buildCompositionView(composition(), 1, 2).selected?.comparison, null);
});

test('carry-in and carry-out execution intervals are clipped to passage coverage for highlighting', () => {
  const pkg = composition();
  pkg.passages[0]!.startSeconds = 1;
  pkg.passages[0]!.endSeconds = 5;
  assert.deepEqual(buildCompositionView(pkg, 1.5, 1).selected?.spans, [
    {startSeconds: 1, endSeconds: 2, voice: 1},
    {startSeconds: 4, endSeconds: 5, voice: 1},
  ]);
});

test('cursor mapping uses event intervals and the selected physical voice rather than static part allocation', () => {
  assert.equal(buildCompositionView(composition(), 1, 2).selected?.part.id, 'bass');
  assert.equal(buildCompositionView(composition(), 2, 1).selected, null);
  assert.equal(buildCompositionView(composition(), 12, 1).passage, null);
  assert.equal(buildCompositionView(composition(), 1, null).selected, null);
  const later = buildCompositionView(composition(), 21, 1);
  assert.equal(later.selected?.passage.id, 'return');
  assert.equal(later.selected?.comparison?.passage.id, 'statement');
});

class FakeDocument {
  activeElement: FakeElement | null = null;
  createElement(tagName: string) { return new FakeElement(tagName, this); }
}

class FakeElement extends EventTarget {
  children: FakeElement[] = [];
  attributes = new Map<string, string>();
  className = '';
  textContent = '';
  hidden = false;
  disabled = false;
  type = '';
  href = '';
  target = '';
  rel = '';
  title = '';
  readonly tagName: string;
  readonly ownerDocument: FakeDocument;
  constructor(tagName: string, ownerDocument: FakeDocument) { super(); this.tagName = tagName; this.ownerDocument = ownerDocument; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  append(...children: FakeElement[]) { this.children.push(...children); }
  replaceChildren(...children: FakeElement[]) { this.children = [...children]; }
  focus() { this.ownerDocument.activeElement = this; }
}

function descendants(element: FakeElement): FakeElement[] {
  return [element, ...element.children.flatMap(descendants)];
}

function setup() {
  const document = new FakeDocument();
  const container = document.createElement('div');
  const heard: {title: string; startSeconds: number; endSeconds: number; voices: number[]}[] = [];
  let changes = 0;
  const panel = mountCompositionPanel(container as unknown as HTMLElement, {
    onHear: selection => { heard.push(selection); },
    onSelectionChange: () => { changes++; },
  });
  const update = (overrides: Record<string, unknown> = {}) => panel.update({package: composition(), timeSeconds: 1, voice: 1, disabled: false, ...overrides});
  const find = (label: string) => descendants(container).find(element => element.tagName === 'button' && element.textContent === label)!;
  const click = (label: string) => { const target = find(label); assert.ok(target, label); target.dispatchEvent(new Event('click')); };
  return {document, container, panel, heard, update, find, click, changes: () => changes};
}

test('phrase and recurrence actions keep authored spans and physical voice mappings', () => {
  const value = setup();
  value.update();
  value.click('Hear first statement');
  assert.deepEqual(value.heard[0], {id: 'statement', title: 'First statement', startSeconds: 0, endSeconds: 10, voices: [1]});
  value.click('Compare later return');
  assert.deepEqual(value.heard[1], {id: 'return:lead:pulse', title: 'Lead · Later return', startSeconds: 20, endSeconds: 24, voices: [1]});
  assert.equal(value.panel.selection()?.startSeconds, 20);
});

test('phrase listening retains the chosen part as the inspector subject while playing the full mix', () => {
  const value = setup();
  value.update({voice: 2});
  value.click('Hear first statement');
  assert.deepEqual(value.heard[0]?.voices, [2]);
  assert.equal(value.panel.selection()?.id, 'statement:bass:pluck');
});

test('phrase navigation selects the main program instead of a brief carried-in state', () => {
  const value = setup();
  const pkg = composition();
  const lead = pkg.passages[0]!.events[0]!;
  lead.startSeconds = 0.02;
  pkg.passages[0]!.events.unshift({...lead, id: 'carry-in', instrumentId: 'pluck', startSeconds: 0, endSeconds: 0.02});
  value.update({package: pkg, timeSeconds: 9});
  value.click('Hear first statement');
  assert.equal(value.panel.selection()?.id, 'statement:lead:pulse');
  value.update({package: pkg, timeSeconds: 0});
  assert.equal(value.panel.selection()?.id, 'statement:lead:pulse');
});

test('short adjacent musical comparisons retain exact boundaries while legacy annotations can add context', () => {
  const phrase = {startSeconds: 76.60917860274773, endSeconds: 79.16281788950599};
  assert.deepEqual(phrasePlaybackRange(phrase, 193), {start: phrase.startSeconds, end: phrase.endSeconds});
  assert.deepEqual(phrasePlaybackRange(phrase, 193, 4), {start: phrase.startSeconds, end: phrase.startSeconds + 4});
});

test('part selection shows literal safe text and source links without starting playback', () => {
  const value = setup();
  value.update();
  const bass = value.find('Bass · <img src=x onerror=alert(1)>');
  bass.focus();
  value.click('Bass · <img src=x onerror=alert(1)>');
  assert.equal(value.heard.length, 0);
  assert.equal(value.changes(), 1);
  assert.equal(value.panel.selection()?.voices[0], 2);
  assert.equal(value.document.activeElement, value.find('Bass · <img src=x onerror=alert(1)>'));
  assert.ok(descendants(value.container).some(element => element.textContent === '<img src=x onerror=alert(1)>'));
  assert.ok(descendants(value.container).every(element => element.tagName !== 'img'));
  assert.ok(descendants(value.container).some(element => element.href === `https://github.com/example/crafter/blob/${'a'.repeat(40)}/docs/programs.md#pluck`));
});

test('unchanged playback updates retain focused controls, while unavailable packages clear authored selection', () => {
  const value = setup();
  const pkg = composition();
  value.update({package: pkg});
  const button = value.find('Hear first statement');
  button.focus();
  value.update({package: pkg, timeSeconds: 1.1});
  assert.equal(value.find('Hear first statement'), button);
  assert.equal(value.document.activeElement, button);
  value.panel.update({package: null, timeSeconds: 1, voice: 1, disabled: false});
  assert.equal(value.container.hidden, true);
  assert.equal(value.panel.selection(), null);
});

test('lane selection outside mapped events states the evidence limit and disabled actions cannot play', () => {
  const value = setup();
  const pkg = composition();
  value.update({package: pkg});
  value.panel.selectAt(3, 1);
  assert.equal(value.panel.selection(), null);
  assert.ok(descendants(value.container).some(element => element.textContent.includes('No mapped part or program')));
  value.update({package: pkg, disabled: true});
  const button = value.find('Hear first statement');
  assert.equal(button.disabled, true);
  button.dispatchEvent(new Event('click'));
  assert.equal(value.heard.length, 0);
});

test('ordinary seek follows changing playback mapping while held inspection retains its selected occurrence', () => {
  const value = setup();
  const pkg = composition();
  value.update({package: pkg});
  value.panel.selectAt(1, 1);
  value.update({package: pkg, timeSeconds: 21});
  assert.equal(value.panel.selection()?.id, 'statement:lead:pulse');
  value.panel.selectAt(1, 1, 'follow');
  value.update({package: pkg, timeSeconds: 21});
  assert.equal(value.panel.selection()?.id, 'return:lead:pulse');
  value.update({package: pkg, timeSeconds: 25});
  assert.equal(value.panel.selection(), null);
});

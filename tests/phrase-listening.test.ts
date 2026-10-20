import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext, runInContext} from 'node:vm';
import ts from 'typescript';
import {phrasePlaybackRange} from '../src/composition-panel.ts';

// Execute the actual UI callback at its transport boundary: snapshot ownership must not depend on DOM or browser scheduling.
const source = ts.createSourceFile('ui.ts', readFileSync(new URL('../src/ui.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
function uiCallback(name: string) {
  let callback: string | undefined;
  function findCallback(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) callback = node.initializer?.getText(source);
    ts.forEachChild(node, findCallback);
  }
  findCallback(source);
  assert.ok(callback, `The ${name} UI callback must exist`);
  return ts.transpileModule(`globalThis.${name} = ${callback}`, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
}

function setup(initialHold: object | null) {
  const calls: string[] = [];
  const inputs = new Map<string, {value: string}>();
  const selectionCalls: unknown[][] = [];
  const details = {open: false};
  const context = createContext({
    el: (id: string) => { assert.equal(id, 'loop-details'); return details; },
    held: initialHold,
    seekViewport: {center: 10},
    cursor: 10,
    selectedEnd: null,
    selectedVoice: 2,
    selectedFilterChip: 0,
    selectedLoopMarkers: null,
    state: {duration: 193, position: 0, loop: null as {start: number; end: number} | null},
    FOLLOW_WINDOW_SECONDS: 10,
    MAX_SEEK_SECONDS: 600,
    copyVisibleHistory: () => ({frames: [], start: 0, end: 0}),
    reference: {pause: () => calls.push('pause reference')},
    controls: {
      setTimelineCenter: (center: number | null) => calls.push(`center ${center}`),
      setLoop: async (loop: {start: number; end: number} | null) => {
        calls.push(loop ? `loop ${loop.start} ${loop.end}` : 'loop off');
        context.state.loop = loop;
      },
      seek: async (position: number) => {
        assert.equal(context.held, null, 'Listening must release captured history before the seek publishes new observations');
        calls.push(`seek ${position}`);
      },
      play: async () => { calls.push('play'); },
    },
    compositionPanel: {selectAt: (...args: unknown[]) => selectionCalls.push(args)},
    phrasePlaybackRange,
    input: (id: string) => {
      if (!inputs.has(id)) inputs.set(id, {value: ''});
      return inputs.get(id)!;
    },
    time: String,
    report: () => {},
    draw: () => {},
  });
  runInContext(uiCallback('setSelectedLoopMarkers'), context);
  runInContext(uiCallback('hearPhrase'), context);
  return {context, calls, inputs, selectionCalls, details};
}

test('hearing the Rambo ending after load uses live destination observations and retains the evidence span', async () => {
  const {context, calls, inputs, selectionCalls} = setup(null);
  await context.hearPhrase({
    title: 'Sound processing continues after the score',
    startSeconds: 179.03, endSeconds: 184.12, voices: [1, 2, 3],
  });
  assert.equal(context.held, null);
  assert.equal(context.seekViewport, null);
  assert.equal(context.cursor, 179.03);
  assert.equal(context.selectedEnd, 184.12);
  assert.equal(context.selectedVoice, 0);
  assert.equal(context.selectedFilterChip, null);
  assert.deepEqual(calls, ['pause reference', 'center null', 'loop 179.03 184.12', 'seek 179.03', 'play']);
  assert.equal(inputs.get('loop-end')?.value, '184.12');
  assert.deepEqual(selectionCalls, [[179.03, 1]]);
});

test('phrase listening opens the loop controls before starting playback', async () => {
  const {context, details} = setup(null);
  context.controls.play = async () => { assert.equal(details.open, true); };
  await context.hearPhrase({title: 'Ending', startSeconds: 179.03, endSeconds: 184.12, voices: [1]});
});

test('the transport loop indicator follows active loop state even when the loop editor is collapsed', () => {
  const elements = new Map<string, {hidden: boolean; title: string; textContent: string; attributes: Map<string, string>; setAttribute: (name: string, value: string) => void}>();
  const el = (id: string) => {
    if (!elements.has(id)) {
      const attributes = new Map<string, string>();
      elements.set(id, {hidden: true, title: '', textContent: '', attributes, setAttribute: (name, value) => { attributes.set(name, value); }});
    }
    return elements.get(id)!;
  };
  const context = createContext({
    state: {loop: null as {start: number; end: number} | null}, el, button: el,
    selectedLoopMarkers: null,
    setText: (id: string, value: string) => { el(id).textContent = value; },
    time: String,
  });
  runInContext(uiCallback('renderLoop'), context);
  context.renderLoop();
  assert.equal(el('loop-indicator').hidden, true);
  context.state.loop = {start: 179.03, end: 184.12};
  context.renderLoop();
  assert.equal(el('loop-indicator').hidden, false);
  assert.match(el('loop-indicator').title, /179.03.*184.12/);
  assert.equal(el('loop-button').attributes.get('aria-pressed'), 'true');
  context.state.loop = null;
  context.renderLoop();
  assert.equal(el('loop-indicator').hidden, true);
  assert.equal(el('loop-button').attributes.get('aria-pressed'), 'false');
});

test('hearing a composition phrase releases an unrelated Hold without replacing the selected part', async () => {
  const {context, calls, selectionCalls} = setup({frames: [{time: 10}], start: 9, end: 11});
  await context.hearPhrase(
    {title: 'First statement', startSeconds: 76.6, endSeconds: 79.16, voices: [2]},
    {minimumContextSeconds: 0, preserveCompositionSelection: true},
  );
  assert.equal(context.held, null);
  assert.equal(context.selectedVoice, 1);
  assert.equal(context.cursor, 76.6);
  assert.equal(context.selectedEnd, 79.16);
  assert.deepEqual(selectionCalls, []);
  assert.deepEqual(calls.slice(-3), ['loop 76.6 79.16', 'seek 76.6', 'play']);
});

test('loop boundaries overlay every lane without altering unheard or unavailable background fills', () => {
  const fills: unknown[] = [];
  const strokes: {color: string; dash: number[]; path: number[][]}[] = [];
  let dash: number[] = [];
  let path: number[][] = [];
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    fillRect: (...rectangle: number[]) => fills.push([ctx.fillStyle, ...rectangle]),
    setLineDash: (value: number[]) => { dash = value; },
    beginPath: () => { path = []; },
    moveTo: (...point: number[]) => { path.push(point); },
    lineTo: (...point: number[]) => { path.push(point); },
    stroke: () => { strokes.push({color: ctx.strokeStyle, dash, path}); },
  };
  let draft: {start: number; end: number} | null = null;
  const context = createContext({
    state: {position: 105, loop: null as {start: number; end: number} | null},
    selectedLoopMarkers: null as {start: number; end: number} | null,
    loopEditor: {draft: () => draft},
    canvasContext: () => ({ctx, width: 100, height: 60}),
    el: () => ({dataset: {}, setAttribute: () => {}}),
    compositionPanel: {selection: () => null},
    plotStart: 100, plotEnd: 110, cursor: 0, selectedEnd: null,
    seekViewport: null, held: null, chartHeld: null, COLORS: ['cyan', 'yellow', 'pink'], time: String,
  });
  runInContext(uiCallback('drawLane'), context);
  context.drawLane('lane', [], [], 0, 0, 109, 101);
  const originalFills = [...fills];
  context.selectedLoopMarkers = {start: 102, end: 108};
  for (const voice of [0, 1, 2, 3, 4, 5, null]) {
    fills.length = 0;
    strokes.length = 0;
    context.drawLane('lane', [], [], voice, 0, 109, 101);
    assert.deepEqual(fills, originalFills);
    assert.deepEqual(strokes.filter(stroke => stroke.dash.join() === '6,4').map(stroke => stroke.path), [
      [[20, 0], [20, 60]], [[80, 0], [80, 60]],
    ]);
    assert.equal(strokes.at(-1)?.color, '#dce9fa', 'the white playhead stays above loop boundaries');
  }
  draft = {start: 99, end: 106};
  strokes.length = 0;
  context.drawLane('lane', [], [], 0, 0, 109, 101);
  assert.deepEqual(strokes.filter(stroke => stroke.dash.join() === '6,4').map(stroke => stroke.path), [
    [[60, 0], [60, 60]],
  ], 'the draft replaces applied markers without inventing an offscreen boundary');
});

test('Set A and Set B create visible selected markers without enabling playback looping', async () => {
  const {context, calls, inputs} = setup(null);
  runInContext(uiCallback('setSelectedLoopMarkers'), context);
  runInContext(uiCallback('editLoopMarkers'), context);
  runInContext(uiCallback('markLoopBoundary'), context);
  context.state.position = 179.03;
  await context.markLoopBoundary('start');
  assert.equal(context.selectedLoopMarkers.start, 179.03);
  assert.equal(context.selectedLoopMarkers.end, null);
  context.state.position = 184.12;
  await context.markLoopBoundary('end');
  assert.equal(context.selectedLoopMarkers.end, 184.12);
  assert.equal(inputs.get('loop-start')?.value, '179.03');
  assert.equal(inputs.get('loop-end')?.value, '184.12');
  assert.deepEqual(calls, []);
});

test('turning playback looping off retains the range; Clear removes the markers', async () => {
  const {context, calls} = setup(null);
  for (const name of ['setSelectedLoopMarkers', 'editLoopMarkers', 'toggleLoop', 'clearLoop']) runInContext(uiCallback(name), context);
  await context.editLoopMarkers({start: 2, end: 6});
  await context.toggleLoop();
  await context.toggleLoop();
  assert.equal(context.selectedLoopMarkers.start, 2);
  assert.equal(context.selectedLoopMarkers.end, 6);
  assert.equal(context.state.loop, null);
  await context.editLoopMarkers({start: 3, end: 7});
  assert.deepEqual(calls, ['loop 2 6', 'loop off'], 'editing an inactive range must not restart or loop audio');
  await context.clearLoop();
  assert.equal(context.selectedLoopMarkers, null);
});

test('setting A beyond B keeps the new A and clears B instead of hiding both markers', async () => {
  const {context, calls} = setup(null);
  for (const name of ['setSelectedLoopMarkers', 'editLoopMarkers', 'markLoopBoundary']) runInContext(uiCallback(name), context);
  context.setSelectedLoopMarkers({start: 2, end: 6});
  context.state.loop = {start: 2, end: 6};
  context.state.position = 9;
  await context.markLoopBoundary('start');
  assert.equal(context.selectedLoopMarkers.start, 9);
  assert.equal(context.selectedLoopMarkers.end, null);
  assert.deepEqual(calls, ['loop off']);
});

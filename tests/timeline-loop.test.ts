import test from 'node:test';
import assert from 'node:assert/strict';
import {mountTimelineLoop, type LoopMarkers} from '../src/timeline-loop.ts';

class FakeDocument {
  activeElement: FakeElement | null = null;
  createElement(tagName: string) { return new FakeElement(tagName, this); }
}

class FakeElement extends EventTarget {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  readonly captures = new Set<number>();
  className = '';
  classList = {add: (name: string) => { this.className = `${this.className} ${name}`.trim(); }};
  textContent = '';
  type = '';
  title = '';
  hidden = false;
  disabled = false;
  rect = {left: 100, width: 400};
  readonly tagName: string;
  readonly ownerDocument: FakeDocument;
  constructor(tagName: string, ownerDocument: FakeDocument) { super(); this.tagName = tagName; this.ownerDocument = ownerDocument; }
  append(...elements: FakeElement[]) { this.children.push(...elements); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  getBoundingClientRect() { return this.rect; }
  setPointerCapture(pointerId: number) { this.captures.add(pointerId); }
  hasPointerCapture(pointerId: number) { return this.captures.has(pointerId); }
  releasePointerCapture(pointerId: number) { this.captures.delete(pointerId); }
  focus() { this.ownerDocument.activeElement = this; }
}

function dispatch(element: FakeElement, type: string, properties: Record<string, unknown> = {}) {
  const event = new Event(type, {cancelable: true});
  for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, {value});
  element.dispatchEvent(event);
  return event;
}

function setup(loop: LoopMarkers = {start: 2, end: 6}, viewport = {start: 0, end: 10}, limit = 10) {
  const document = new FakeDocument();
  const root = document.createElement('div');
  const commits: LoopMarkers[] = [];
  let previews = 0;
  const component = mountTimelineLoop(root as unknown as HTMLElement, {
    onPreview: () => { previews += 1; },
    onCommit: range => { commits.push(range); },
    formatTime: seconds => `${seconds.toFixed(2)}s`,
  });
  component.update(loop, viewport, limit, false);
  const start = root.children.find(element => element.dataset.boundary === 'start')!;
  const end = root.children.find(element => element.dataset.boundary === 'end')!;
  const bracket = root.children.find(element => element.className === 'timeline-loop-bracket')!;
  const pointer = (target: FakeElement, type: string, clientX: number, properties: Record<string, unknown> = {}) =>
    dispatch(target, type, {clientX, pointerId: 7, button: 0, isPrimary: true, ...properties});
  const key = (target: FakeElement, type: string, key: string, properties: Record<string, unknown> = {}) =>
    dispatch(target, type, {key, shiftKey: false, repeat: false, ...properties});
  return {component, root, start, end, bracket, commits, pointer, key, previews: () => previews};
}

test('mounted ruler exposes accessible A/B controls and the true loop geometry', () => {
  const f = setup();
  assert.equal(f.root.hidden, false);
  assert.equal(f.bracket.style.left, '20%');
  assert.equal(f.bracket.style.width, '40%');
  assert.equal(f.start.textContent, 'A');
  assert.equal(f.end.textContent, 'B');
  assert.equal(f.start.getAttribute('role'), 'slider');
  assert.equal(f.start.getAttribute('aria-valuenow'), '2');
  assert.equal(f.start.getAttribute('aria-valuetext'), '2.00s');
  assert.match(f.start.getAttribute('aria-label')!, /start/i);
  assert.match(f.end.getAttribute('aria-label')!, /end/i);
  assert.equal(f.component.draft(), null);
  assert.equal(f.component.viewport(), null);
});

test('pointer movement previews on the actual ruler width and commits exactly once on release', () => {
  const f = setup();
  f.pointer(f.start, 'pointerdown', 180);
  f.pointer(f.start, 'pointermove', 220);
  f.pointer(f.start, 'pointermove', 260);
  assert.deepEqual(f.component.draft(), {start: 4, end: 6});
  assert.equal(f.start.getAttribute('aria-valuenow'), '4');
  assert.equal(f.start.style.left, '40%');
  assert.equal(f.commits.length, 0);
  assert.ok(f.previews() >= 2);
  f.pointer(f.start, 'pointerup', 260);
  f.pointer(f.start, 'pointerup', 260);
  assert.deepEqual(f.commits, [{start: 4, end: 6}]);
  assert.equal(f.component.draft(), null);
  assert.equal(f.component.viewport(), null);
  assert.equal(f.start.captures.size, 0);
});

test('a pointer grab keeps its initial offset and ignores other pointer identifiers', () => {
  const f = setup();
  f.pointer(f.start, 'pointerdown', 190);
  f.pointer(f.start, 'pointermove', 230, {pointerId: 99});
  assert.deepEqual(f.component.draft(), {start: 2, end: 6});
  f.pointer(f.start, 'pointermove', 230);
  f.pointer(f.start, 'pointerup', 230);
  assert.deepEqual(f.commits, [{start: 3, end: 6}]);
});

test('unchanged gestures and non-primary pointer presses do not commit', () => {
  const f = setup();
  f.pointer(f.start, 'pointerdown', 180, {button: 2});
  assert.equal(f.component.draft(), null);
  f.pointer(f.start, 'pointerdown', 180, {isPrimary: false});
  assert.equal(f.component.draft(), null);
  f.pointer(f.start, 'pointerdown', 180);
  f.pointer(f.start, 'pointerup', 180);
  assert.equal(f.commits.length, 0);
});

test('pointer cancellation lost capture and Escape restore the original range without committing', () => {
  for (const reason of ['pointercancel', 'lostpointercapture', 'Escape']) {
    const f = setup();
    f.pointer(f.end, 'pointerdown', 340);
    f.pointer(f.end, 'pointermove', 420);
    if (reason === 'Escape') f.key(f.end, 'keydown', 'Escape');
    else f.pointer(f.end, reason, 420);
    assert.equal(f.component.draft(), null, reason);
    assert.equal(f.component.viewport(), null, reason);
    assert.equal(f.end.getAttribute('aria-valuenow'), '6', reason);
    assert.equal(f.commits.length, 0, reason);
    assert.equal(f.end.captures.size, 0, reason);
  }
});

test('both boundaries clamp to the song limits and cannot cross', () => {
  const f = setup();
  f.pointer(f.start, 'pointerdown', 180);
  f.pointer(f.start, 'pointermove', -500);
  assert.deepEqual(f.component.draft(), {start: 0, end: 6});
  f.pointer(f.start, 'pointermove', 900);
  assert.deepEqual(f.component.draft(), {start: 5.99, end: 6});
  f.component.cancel();
  f.pointer(f.end, 'pointerdown', 340);
  f.pointer(f.end, 'pointermove', 900);
  assert.deepEqual(f.component.draft(), {start: 2, end: 10});
  f.pointer(f.end, 'pointermove', -500);
  assert.deepEqual(f.component.draft(), {start: 2, end: 2.01});
});

test('an existing loop shorter than ten milliseconds remains editable without forced expansion', () => {
  const f = setup({start: 2, end: 2.005});
  f.pointer(f.start, 'pointerdown', 180);
  f.pointer(f.start, 'pointermove', 500);
  assert.deepEqual(f.component.draft(), {start: 2, end: 2.005});
  f.pointer(f.start, 'pointermove', 140);
  assert.deepEqual(f.component.draft(), {start: 1, end: 2.005});
  f.pointer(f.start, 'pointerup', 140);
  assert.deepEqual(f.commits, [{start: 1, end: 2.005}]);
});

test('numeric-equivalent loop updates preserve the draft and freeze viewport mapping until release', () => {
  const f = setup({start: 12, end: 16}, {start: 10, end: 20}, 30);
  f.pointer(f.start, 'pointerdown', 180);
  f.pointer(f.start, 'pointermove', 220);
  f.component.update({start: 12, end: 16}, {start: 15, end: 25}, 30, false);
  assert.deepEqual(f.component.viewport(), {start: 10, end: 20});
  assert.deepEqual(f.component.draft(), {start: 13, end: 16});
  assert.equal(f.start.style.left, '30%');
  f.pointer(f.start, 'pointerup', 260);
  assert.deepEqual(f.commits, [{start: 14, end: 16}]);
  assert.equal(f.component.viewport(), null);
});

test('returned draft and viewport snapshots cannot mutate an active edit', () => {
  const f = setup();
  f.pointer(f.start, 'pointerdown', 180);
  f.component.draft()!.start = 9;
  f.component.viewport()!.start = 9;
  f.pointer(f.start, 'pointerup', 220);
  assert.deepEqual(f.commits, [{start: 3, end: 6}]);
});

test('keyboard repeats preview increments and commit once on arrow keyup', () => {
  const f = setup();
  f.key(f.end, 'keydown', 'ArrowRight');
  f.key(f.end, 'keydown', 'ArrowRight', {repeat: true});
  f.key(f.end, 'keydown', 'ArrowRight', {shiftKey: true, repeat: true});
  assert.ok(Math.abs(f.component.draft()!.end! - 7.2) < 1e-10);
  assert.equal(f.commits.length, 0);
  f.key(f.end, 'keyup', 'Shift');
  assert.equal(f.commits.length, 0);
  f.key(f.end, 'keyup', 'ArrowRight');
  f.key(f.end, 'keyup', 'ArrowRight');
  assert.equal(f.commits.length, 1);
  assert.ok(Math.abs(f.commits[0]!.end! - 7.2) < 1e-10);
  assert.equal(f.component.draft(), null);
});

test('keyboard editing clamps boundaries and Escape or blur cancels a pending edit', () => {
  const f = setup({start: 0, end: 0.5});
  f.key(f.start, 'keydown', 'ArrowLeft', {shiftKey: true});
  f.key(f.start, 'keyup', 'ArrowLeft');
  assert.equal(f.commits.length, 0);
  f.key(f.start, 'keydown', 'ArrowRight', {shiftKey: true});
  assert.deepEqual(f.component.draft(), {start: 0.49, end: 0.5});
  f.key(f.start, 'keydown', 'Escape');
  assert.equal(f.start.getAttribute('aria-valuenow'), '0');
  assert.equal(f.commits.length, 0);
  f.key(f.end, 'keydown', 'ArrowRight');
  dispatch(f.end, 'blur');
  assert.equal(f.component.draft(), null);
  assert.equal(f.commits.length, 0);
});

test('offscreen boundaries stay hidden while bracket clipping never invents a visible boundary', () => {
  const f = setup({start: 2, end: 12}, {start: 4, end: 10}, 15);
  assert.equal(f.start.hidden, true);
  assert.equal(f.end.hidden, true);
  assert.equal(f.bracket.style.left, '0%');
  assert.equal(f.bracket.style.width, '100%');
  assert.equal(f.bracket.dataset.startVisible, 'false');
  assert.equal(f.bracket.dataset.endVisible, 'false');
  f.component.update({start: 2, end: 5}, {start: 4, end: 10}, 15, false);
  assert.equal(f.end.hidden, false);
  assert.equal(f.bracket.dataset.endVisible, 'true');
  f.component.update({start: 0, end: 2}, {start: 4, end: 10}, 15, false);
  assert.equal(f.bracket.hidden, true);
});

test('compact and viewport-edge flags allow visible labels to avoid overlap and clipping', () => {
  const f = setup({start: 0, end: 0.1});
  assert.equal(f.root.dataset.compact, 'true');
  assert.equal(f.root.dataset.startEdge, 'true');
  assert.equal(f.root.dataset.endEdge, 'false');
  assert.equal(f.root.dataset.staggered, 'true');
  f.component.update({start: 9.9, end: 10}, {start: 0, end: 10}, 10, false);
  assert.equal(f.root.dataset.endEdge, 'true');
});

test('loop replacement disabling and clearing silently cancel edits without recursive previews', () => {
  for (const replacement of ['loop', 'disabled', 'clear'] as const) {
    const f = setup();
    f.pointer(f.start, 'pointerdown', 180);
    f.pointer(f.start, 'pointermove', 220);
    const count = f.previews();
    f.component.update(replacement === 'clear' ? null : replacement === 'loop' ? {start: 1, end: 5} : {start: 2, end: 6}, {start: 0, end: 10}, 10, replacement === 'disabled');
    assert.equal(f.component.draft(), null, replacement);
    assert.equal(f.component.viewport(), null, replacement);
    assert.equal(f.previews(), count, replacement);
    f.pointer(f.start, 'pointerup', 300);
    assert.equal(f.commits.length, 0, replacement);
    assert.equal(f.start.captures.size, 0, replacement);
    assert.equal(f.root.hidden, replacement === 'clear', replacement);
    assert.equal(f.start.disabled, replacement !== 'loop', replacement);
    if (replacement === 'clear') assert.equal(f.root.dataset.staggered, 'false');
  }
});

test('a lone A marker remains visible and draggable without inventing a B marker or bracket', () => {
  const f = setup({start: 2, end: null});
  assert.equal(f.root.hidden, false);
  assert.equal(f.start.hidden, false);
  assert.equal(f.end.hidden, true);
  assert.equal(f.bracket.hidden, true);
  assert.equal(f.start.getAttribute('aria-valuemin'), '0');
  assert.equal(f.start.getAttribute('aria-valuemax'), '10');
  f.pointer(f.start, 'pointerdown', 180);
  f.pointer(f.start, 'pointermove', 420);
  assert.deepEqual(f.component.draft(), {start: 8, end: null});
  assert.equal(f.commits.length, 0);
  f.pointer(f.start, 'pointerup', 420);
  assert.deepEqual(f.commits, [{start: 8, end: null}]);
  assert.equal(f.bracket.hidden, true);
});

test('a lone B marker supports keyboard and pointer edits across the whole song', () => {
  const f = setup({start: null, end: 6});
  assert.equal(f.root.hidden, false);
  assert.equal(f.start.hidden, true);
  assert.equal(f.end.hidden, false);
  assert.equal(f.bracket.hidden, true);
  assert.equal(f.end.getAttribute('aria-valuemin'), '0');
  assert.equal(f.end.getAttribute('aria-valuemax'), '10');
  f.key(f.end, 'keydown', 'ArrowLeft', {shiftKey: true});
  f.key(f.end, 'keyup', 'ArrowLeft');
  assert.deepEqual(f.commits, [{start: null, end: 5}]);
  f.pointer(f.end, 'pointerdown', 300);
  f.pointer(f.end, 'pointermove', -100);
  assert.deepEqual(f.component.draft(), {start: null, end: 0});
  f.pointer(f.end, 'pointermove', 900);
  f.pointer(f.end, 'pointerup', 900);
  assert.deepEqual(f.commits, [{start: null, end: 5}, {start: null, end: 10}]);
});

test('adding and removing a boundary updates the bracket without an edit or commit', () => {
  const f = setup({start: 2, end: null});
  f.component.update({start: 2, end: 6}, {start: 0, end: 10}, 10, false);
  assert.equal(f.start.hidden, false);
  assert.equal(f.end.hidden, false);
  assert.equal(f.bracket.hidden, false);
  assert.equal(f.bracket.style.left, '20%');
  assert.equal(f.bracket.style.width, '40%');
  f.component.update({start: null, end: 6}, {start: 0, end: 10}, 10, false);
  assert.equal(f.start.hidden, true);
  assert.equal(f.end.hidden, false);
  assert.equal(f.bracket.hidden, true);
  assert.equal(f.commits.length, 0);
  assert.equal(f.previews(), 0);
});

test('removing a boundary during a drag cancels the draft and retains the remaining marker', () => {
  const f = setup();
  f.pointer(f.end, 'pointerdown', 340);
  f.pointer(f.end, 'pointermove', 420);
  const count = f.previews();
  f.component.update({start: null, end: 6}, {start: 0, end: 10}, 10, false);
  assert.equal(f.component.draft(), null);
  assert.equal(f.end.captures.size, 0);
  assert.equal(f.previews(), count);
  assert.equal(f.start.hidden, true);
  assert.equal(f.end.hidden, false);
  f.pointer(f.end, 'pointerup', 420);
  assert.equal(f.commits.length, 0);
});

test('empty invalid or unordered marker selections never produce an invented bracket', () => {
  for (const markers of [
    {start: null, end: null}, {start: 6, end: 2}, {start: 2, end: 2},
    {start: -1, end: null}, {start: null, end: 11}, {start: NaN, end: null},
  ]) {
    const f = setup(markers);
    assert.equal(f.root.hidden, true);
    assert.equal(f.start.hidden, true);
    assert.equal(f.end.hidden, true);
    assert.equal(f.bracket.hidden, true);
    f.key(f.start, 'keydown', 'ArrowRight');
    f.pointer(f.end, 'pointerdown', 340);
    assert.equal(f.component.draft(), null);
    assert.equal(f.commits.length, 0);
  }
});

import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mountLibraryPicker, type LibrarySelection} from '../src/library-picker.ts';

const PROVIDER_ORIGIN = 'https://sidquake.c64demo.com';

class FakeWindow extends EventTarget {
  location = {origin: 'https://explorer.example'};
  setTimeout = (handler: () => void, delay: number) => setTimeout(handler, delay);
  clearTimeout = (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer);
}

class FakeDocument {
  defaultView = new FakeWindow();
  activeElement: FakeElement | null = null;
  createElement(tagName: string) { return new FakeElement(tagName, this); }
}

class FakeElement extends EventTarget {
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  attributes = new Map<string, string>();
  id = '';
  className = '';
  textContent = '';
  title = '';
  type = '';
  src = '';
  hidden = false;
  disabled = false;
  autofocus = false;
  open = false;
  contentWindow: object | null;
  readonly tagName: string;
  readonly ownerDocument: FakeDocument;
  constructor(tagName: string, ownerDocument: FakeDocument) {
    super();
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.contentWindow = tagName === 'iframe' ? {} : null;
  }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  append(...children: FakeElement[]) {
    for (const child of children) {
      child.remove();
      child.parentElement = this;
      this.children.push(child);
    }
  }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; this.focus(); }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
}

function find(element: FakeElement, predicate: (candidate: FakeElement) => boolean): FakeElement | undefined {
  if (predicate(element)) return element;
  for (const child of element.children) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return undefined;
}

function sidBytes(magic = 'PSID', length = 126): ArrayBuffer {
  const bytes = new Uint8Array(length);
  bytes.set([...magic].map(character => character.charCodeAt(0)));
  bytes[5] = 2;
  bytes[7] = 124;
  bytes[15] = 1;
  bytes[17] = 1;
  return bytes.buffer;
}

function selection(overrides: Record<string, unknown> = {}) {
  return {
    type: 'hvsc:selected', mode: 'file', bytes: sidBytes(), name: 'Example.sid',
    path: 'C64Music/MUSICIANS/E/Example/Example.sid', title: 'Example', author: 'Composer',
    released: '2026', stil: 'Library commentary', url: 'https://sidquake.c64demo.com/private?token=discard-me',
    ...overrides,
  };
}

function setup(t: TestContext) {
  t.mock.timers.enable({apis: ['setTimeout']});
  const document = new FakeDocument();
  const container = document.createElement('section');
  const trigger = document.createElement('button');
  trigger.id = 'browse-library';
  const selected: LibrarySelection[] = [];
  const picker = mountLibraryPicker(container as unknown as HTMLElement, trigger as unknown as HTMLButtonElement, value => {
    assert.equal(dialog().open, false);
    assert.notEqual(frame(), undefined);
    selected.push(value);
  });
  t.after(() => picker.dispose());
  const byId = (id: string) => find(container, element => element.id === id);
  const dialog = () => find(container, element => element.tagName === 'dialog')!;
  const frame = () => byId('library-frame');
  const click = (element: FakeElement) => element.dispatchEvent(new Event('click'));
  const open = () => click(trigger);
  const send = (data: unknown, source: object | null = frame()?.contentWindow ?? null, origin = PROVIDER_ORIGIN) => {
    const event = new Event('message');
    Object.defineProperties(event, {data: {value: data}, source: {value: source}, origin: {value: origin}});
    document.defaultView.dispatchEvent(event);
  };
  return {document, container, trigger, selected, picker, byId, dialog, frame, click, open, send};
}

test('the dialog lazily opens one file-mode provider frame with its own playback disabled', t => {
  const fixture = setup(t);
  assert.equal(fixture.frame(), undefined);
  fixture.open();
  assert.equal(fixture.dialog().open, true);
  assert.equal(fixture.dialog().getAttribute('aria-labelledby'), 'library-title');
  assert.equal(fixture.byId('library-title')?.textContent, 'Browse SID library');
  assert.equal(fixture.byId('library-retry')?.hidden, true);
  const frame = fixture.frame()!;
  const url = new URL(frame.src);
  assert.equal(url.origin, PROVIDER_ORIGIN);
  assert.equal(url.pathname, '/hvsc-embed.html');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    mode: 'file', origin: 'https://explorer.example', autoplay: '0', player: '0', viz: '0', path: '0',
  });
  fixture.open();
  assert.equal(fixture.frame(), frame);
  assert.equal(frame.getAttribute('allow'), "autoplay 'none'");
});

test('a valid file handoff hides the retained frame before returning bytes and inert metadata', t => {
  const fixture = setup(t);
  fixture.open();
  const frame = fixture.frame();
  fixture.send({type: 'hvsc:ready', mode: 'file'});
  const message = selection({title: '<img src=x onerror=alert(1)>', author: '<script>example</script>'});
  fixture.send(message);
  assert.equal(fixture.selected.length, 1);
  assert.deepEqual(fixture.selected[0], {
    bytes: new Uint8Array(message.bytes), name: message.name, path: message.path,
    title: message.title, author: message.author, released: message.released, stil: message.stil,
  });
  assert.equal('url' in fixture.selected[0], false);
  assert.equal(fixture.document.activeElement, fixture.trigger);
  assert.equal(find(fixture.container, element => element.tagName === 'img'), undefined);
  fixture.open();
  assert.equal(fixture.frame(), frame);
  assert.match(fixture.byId('library-status')?.textContent ?? '', /search|select|choose/i);
});

test('untrusted origins and unrelated windows cannot alter or complete the active picker', t => {
  const fixture = setup(t);
  fixture.open();
  const frame = fixture.frame();
  fixture.send(selection(), frame?.contentWindow, 'https://attacker.example');
  fixture.send(selection(), {});
  fixture.send({type: 'future:message'});
  assert.equal(fixture.selected.length, 0);
  assert.equal(fixture.frame(), frame);
  assert.equal(fixture.byId('library-retry')?.hidden, true);
});

const malformedMessages: [string, unknown][] = [
  ['null', null],
  ['array', []],
  ['missing type', {}],
  ['wrong mode', selection({mode: 'link'})],
  ['typed-array rather than transferred buffer', selection({bytes: new Uint8Array(126)})],
  ['empty bytes', selection({bytes: new ArrayBuffer(0)})],
  ['truncated SID', selection({bytes: sidBytes('PSID', 117)})],
  ['oversized SID', selection({bytes: sidBytes('PSID', 65_663)})],
  ['unrecognized file bytes', selection({bytes: sidBytes('TEXT')})],
  ['missing filename', selection({name: undefined})],
  ['blank filename', selection({name: '   '})],
  ['oversized filename', selection({name: 'x'.repeat(256)})],
  ['missing path', selection({path: undefined})],
  ['oversized path', selection({path: 'x'.repeat(2049)})],
  ['wrong metadata type', selection({title: 42})],
  ['null metadata', selection({author: null})],
  ['oversized metadata', selection({released: 'x'.repeat(1025)})],
  ['oversized STIL', selection({stil: 'x'.repeat(65_537)})],
  ['wrong ready mode', {type: 'hvsc:ready', mode: 'play'}],
];
for (const [name, message] of malformedMessages) {
  test(`a trusted ${name} payload fails without loading and offers a fresh retry`, t => {
    const fixture = setup(t);
    fixture.open();
    fixture.send(message);
    assert.equal(fixture.selected.length, 0);
    assert.equal(fixture.frame(), undefined);
    assert.equal(fixture.dialog().open, true);
    assert.equal(fixture.byId('library-retry')?.hidden, false);
    assert.match(fixture.byId('library-status')?.textContent ?? '', /library|selection|SID/i);
  });
}

test('missing optional metadata becomes empty and the receiver leaves RSID profile rejection to the loader', t => {
  const fixture = setup(t);
  fixture.open();
  fixture.send({type: 'hvsc:selected', mode: 'file', bytes: sidBytes('RSID', 65_662), name: 'Example.sid', path: 'Example.sid'});
  assert.equal(fixture.selected.length, 1);
  assert.equal(fixture.selected[0].bytes.length, 65_662);
  assert.equal(String.fromCharCode(...fixture.selected[0].bytes.slice(0, 4)), 'RSID');
  for (const field of ['title', 'author', 'released', 'stil'] as const) assert.equal(fixture.selected[0][field], '');
  const frame = fixture.frame();
  t.mock.timers.tick(20_000);
  fixture.open();
  assert.equal(fixture.frame(), frame);
});

test('provider readiness cancels the bounded startup deadline', t => {
  const fixture = setup(t);
  fixture.open();
  const frame = fixture.frame();
  fixture.send({type: 'hvsc:ready', mode: 'file'});
  t.mock.timers.tick(20_000);
  assert.equal(fixture.frame(), frame);
  assert.equal(fixture.byId('library-retry')?.hidden, true);
  assert.match(fixture.byId('library-status')?.textContent ?? '', /search|select|choose/i);
});

test('a startup timeout removes the pending frame and exposes retry without loading', t => {
  const fixture = setup(t);
  fixture.open();
  t.mock.timers.tick(19_999);
  assert.notEqual(fixture.frame(), undefined);
  t.mock.timers.tick(1);
  assert.equal(fixture.frame(), undefined);
  assert.equal(fixture.selected.length, 0);
  assert.equal(fixture.byId('library-retry')?.hidden, false);
});

test('selection errors preserve provider state and discard token-bearing diagnostics until an explicit reload', t => {
  const fixture = setup(t);
  fixture.open();
  fixture.send({type: 'hvsc:ready', mode: 'file'});
  const oldFrame = fixture.frame()!;
  const oldWindow = oldFrame.contentWindow;
  fixture.send({type: 'hvsc:error', message: 'Fetch failed: https://example.test?token=private'});
  assert.equal(fixture.frame(), oldFrame);
  assert.equal(fixture.byId('library-status')?.textContent.includes('private'), false);
  assert.equal(fixture.byId('library-retry')?.hidden, false);
  assert.equal(fixture.byId('library-retry')?.textContent, 'Reload library');
  fixture.picker.close();
  fixture.open();
  assert.equal(fixture.frame(), oldFrame);
  assert.equal(fixture.byId('library-retry')?.hidden, false);
  fixture.click(fixture.byId('library-retry')!);
  assert.notEqual(fixture.frame()!.contentWindow, oldWindow);
  assert.equal(oldFrame.parentElement, null);
  fixture.send(selection(), oldWindow);
  assert.equal(fixture.selected.length, 0);
  fixture.send(selection());
  assert.equal(fixture.selected.length, 1);
});

test('iframe load errors stop the current load and leave a closable retry state', t => {
  const fixture = setup(t);
  fixture.open();
  fixture.frame()!.dispatchEvent(new Event('error'));
  assert.equal(fixture.frame(), undefined);
  assert.equal(fixture.byId('library-retry')?.hidden, false);
  fixture.picker.close();
  assert.equal(fixture.dialog().open, false);
  assert.equal(fixture.document.activeElement, fixture.trigger);
});

test('cancel and reopening retain one provider window despite queued native close events', t => {
  const fixture = setup(t);
  fixture.open();
  const frame = fixture.frame()!;
  fixture.dialog().dispatchEvent(new Event('cancel', {cancelable: true}));
  assert.equal(fixture.dialog().open, false);
  assert.equal(fixture.frame(), frame);
  assert.equal(fixture.document.activeElement, fixture.trigger);
  fixture.send(selection());
  assert.equal(fixture.selected.length, 0);
  fixture.dialog().dispatchEvent(new Event('close'));
  assert.equal(fixture.frame(), frame);
  fixture.open();
  assert.equal(fixture.frame(), frame);
  fixture.dialog().dispatchEvent(new Event('close'));
  assert.equal(fixture.selected.length, 0);
  assert.equal(fixture.dialog().open, true);
  assert.equal(fixture.frame(), frame);
  assert.equal(fixture.document.activeElement?.getAttribute('aria-label'), 'Close library browser');
  fixture.send(selection());
  assert.equal(fixture.selected.length, 1);
});

test('the labelled close button closes without selecting and disposal unregisters the picker', t => {
  const fixture = setup(t);
  fixture.open();
  const close = find(fixture.container, element => element.getAttribute('aria-label') === 'Close library browser')!;
  fixture.click(close);
  assert.equal(fixture.dialog().open, false);
  const retainedFrame = fixture.frame()!;
  assert.notEqual(retainedFrame, undefined);
  assert.equal(fixture.selected.length, 0);
  fixture.open();
  assert.equal(fixture.frame(), retainedFrame);
  const oldWindow = fixture.frame()!.contentWindow;
  fixture.picker.dispose();
  assert.equal(retainedFrame.parentElement, null);
  fixture.open();
  fixture.send(selection(), oldWindow);
  t.mock.timers.tick(20_000);
  assert.equal(fixture.selected.length, 0);
  assert.deepEqual(fixture.container.children, []);
  fixture.picker.dispose();
});

test('a closed picker ignores a queued reload and reopening does not extend the startup deadline', t => {
  const fixture = setup(t);
  fixture.open();
  const frame = fixture.frame();
  t.mock.timers.tick(19_999);
  fixture.picker.close();
  fixture.click(fixture.byId('library-retry')!);
  assert.equal(fixture.frame(), frame);
  fixture.open();
  assert.equal(fixture.frame(), frame);
  t.mock.timers.tick(1);
  assert.equal(fixture.frame(), undefined);
  assert.equal(fixture.byId('library-retry')?.hidden, false);
});

test('valid provider readiness while hidden settles the original startup deadline', t => {
  const fixture = setup(t);
  fixture.open();
  const frame = fixture.frame();
  t.mock.timers.tick(19_999);
  fixture.picker.close();
  fixture.send({type: 'hvsc:ready', mode: 'file'});
  t.mock.timers.tick(20_000);
  assert.equal(fixture.dialog().open, false);
  assert.equal(fixture.frame(), frame);
  fixture.open();
  assert.equal(fixture.frame(), frame);
  assert.equal(fixture.byId('library-retry')?.hidden, true);
  assert.match(fixture.byId('library-status')?.textContent ?? '', /search|select|choose/i);
});

test('hidden selections, errors and malformed payloads cannot complete or alter the retained picker', t => {
  const fixture = setup(t);
  fixture.open();
  fixture.send({type: 'hvsc:ready', mode: 'file'});
  const frame = fixture.frame();
  const status = fixture.byId('library-status')?.textContent;
  fixture.picker.close();
  for (const message of [selection(), {type: 'hvsc:error'}, null, [], {}, {type: 'hvsc:ready', mode: 'play'}, selection({bytes: sidBytes('TEXT')})]) fixture.send(message);
  assert.equal(fixture.selected.length, 0);
  assert.equal(fixture.frame(), frame);
  assert.equal(fixture.byId('library-status')?.textContent, status);
  assert.equal(fixture.byId('library-retry')?.hidden, true);
  fixture.open();
  fixture.send(selection());
  assert.equal(fixture.selected.length, 1);
});

test('a retained picker accepts another selection after a provider selection error', t => {
  const fixture = setup(t);
  fixture.open();
  fixture.send({type: 'hvsc:ready', mode: 'file'});
  const frame = fixture.frame();
  fixture.send({type: 'hvsc:error'});
  fixture.send(selection());
  assert.equal(fixture.selected.length, 1);
  fixture.open();
  assert.equal(fixture.frame(), frame);
  assert.equal(fixture.byId('library-retry')?.hidden, true);
  assert.match(fixture.byId('library-status')?.textContent ?? '', /search|select|choose/i);
});

test('reloading rejects readiness and load errors from the discarded frame without extending the new deadline', t => {
  const fixture = setup(t);
  fixture.open();
  const oldFrame = fixture.frame()!;
  fixture.send({type: 'hvsc:error'});
  fixture.click(fixture.byId('library-retry')!);
  const frame = fixture.frame();
  oldFrame.dispatchEvent(new Event('error'));
  fixture.send({type: 'hvsc:ready', mode: 'file'}, oldFrame.contentWindow);
  assert.equal(fixture.frame(), frame);
  assert.equal(fixture.byId('library-retry')?.hidden, true);
  t.mock.timers.tick(20_000);
  assert.equal(fixture.frame(), undefined);
  assert.equal(fixture.byId('library-retry')?.hidden, false);
});

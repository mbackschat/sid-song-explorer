export interface LibrarySelection {
  bytes: Uint8Array;
  name: string;
  path: string;
  title: string;
  author: string;
  released: string;
  stil: string;
}

const PROVIDER_ORIGIN = 'https://sidquake.c64demo.com';
const READY_TIMEOUT_MS = 20_000;
const MAX_SID_BYTES = 65_662;

function optionalText(value: unknown, maximumLength: number): string | null {
  if (value === undefined) return '';
  return typeof value === 'string' && value.length <= maximumLength ? value : null;
}

function parseSelection(data: Record<string, unknown>): LibrarySelection | null {
  const {bytes, name, path} = data;
  if (data.mode !== 'file' || !(bytes instanceof ArrayBuffer) || bytes.byteLength < 118 || bytes.byteLength > MAX_SID_BYTES) return null;
  if (typeof name !== 'string' || !name.trim() || name.length > 255) return null;
  if (typeof path !== 'string' || !path.trim() || path.length > 2048) return null;
  const contents = new Uint8Array(bytes);
  const magic = String.fromCharCode(...contents.subarray(0, 4));
  if (magic !== 'PSID' && magic !== 'RSID') return null;
  const title = optionalText(data.title, 1024);
  const author = optionalText(data.author, 1024);
  const released = optionalText(data.released, 1024);
  const stil = optionalText(data.stil, 65_536);
  if (title === null || author === null || released === null || stil === null) return null;
  return {bytes: contents, name, path, title, author, released, stil};
}

export function mountLibraryPicker(container: HTMLElement, trigger: HTMLButtonElement, onSelect: (selection: LibrarySelection) => void): {close(): void; dispose(): void} {
  const document = container.ownerDocument;
  const view = document.defaultView;
  if (!view) throw new Error('The library picker requires a browser window.');

  const dialog = document.createElement('dialog');
  dialog.id = 'library-dialog';
  dialog.className = 'library-dialog';
  dialog.setAttribute('aria-labelledby', 'library-title');

  const header = document.createElement('header');
  header.className = 'library-dialog-header';
  const title = document.createElement('h2');
  title.id = 'library-title';
  title.textContent = 'Browse SID library';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'quiet';
  closeButton.textContent = 'Close';
  closeButton.setAttribute('aria-label', 'Close library browser');
  closeButton.autofocus = true;
  header.append(title, closeButton);

  const feedback = document.createElement('div');
  feedback.className = 'library-dialog-feedback';
  const status = document.createElement('p');
  status.id = 'library-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const retry = document.createElement('button');
  retry.id = 'library-retry';
  retry.type = 'button';
  retry.textContent = 'Reload library';
  retry.hidden = true;
  feedback.append(status, retry);

  const frameContainer = document.createElement('div');
  frameContainer.className = 'library-frame-container';
  dialog.append(header, feedback, frameContainer);
  container.append(dialog);
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', dialog.id);
  trigger.setAttribute('aria-expanded', 'false');

  let activeFrame: HTMLIFrameElement | null = null;
  let activeWindow: Window | null = null;
  let readyTimeout: number | undefined;
  let disposed = false;

  function cancelDeadline(): void {
    if (readyTimeout === undefined) return;
    view!.clearTimeout(readyTimeout);
    readyTimeout = undefined;
  }

  function removeFrame(): void {
    activeWindow = null;
    cancelDeadline();
    activeFrame?.removeEventListener('error', frameFailed);
    activeFrame?.remove();
    activeFrame = null;
  }

  function close(): void {
    if (!dialog.open) return;
    dialog.close();
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus({preventScroll: true});
  }

  function showFailure(message: string): void {
    status.textContent = message;
    retry.hidden = false;
  }

  function fail(message: string): void {
    removeFrame();
    showFailure(message);
  }

  function markReady(): void {
    cancelDeadline();
    status.textContent = 'Search the library, then select a SID to open in Explorer.';
    retry.hidden = true;
  }

  function frameFailed(event: Event): void {
    if (activeFrame === event.currentTarget) fail('The SID library could not load. Reload the library or close the browser.');
  }

  function loadFrame(): void {
    if (disposed || !dialog.open) return;
    removeFrame();
    retry.hidden = true;
    status.textContent = 'Loading SID library…';
    const frame = document.createElement('iframe');
    frame.id = 'library-frame';
    frame.title = 'SIDquake SID library browser';
    frame.setAttribute('allow', "autoplay 'none'");
    const url = new URL('/hvsc-embed.html', PROVIDER_ORIGIN);
    // File mode avoids host CORS; the pinned SIDquake contract is in docs/research/sid-library-picker.md.
    // The provider's mobile footer path pushes Select outside the frame; its supported path=0 option keeps it visible (docs/validation/library-picker.md).
    for (const [key, value] of Object.entries({mode: 'file', origin: view!.location.origin, autoplay: '0', player: '0', viz: '0', path: '0'})) {
      url.searchParams.set(key, value);
    }
    frame.src = url.href;
    frame.addEventListener('error', frameFailed);
    activeFrame = frame;
    frameContainer.append(frame);
    activeWindow = frame.contentWindow;
    readyTimeout = view!.setTimeout(() => {
      if (activeFrame === frame) fail('The SID library did not respond. Reload the library or close the browser.');
    }, READY_TIMEOUT_MS);
  }

  function open(): void {
    if (disposed || dialog.open) return;
    dialog.showModal();
    trigger.setAttribute('aria-expanded', 'true');
    if (!activeFrame) loadFrame();
    closeButton.focus({preventScroll: true});
  }

  function receive(event: MessageEvent<unknown>): void {
    if (!activeWindow || event.origin !== PROVIDER_ORIGIN || event.source !== activeWindow) return;
    const data = event.data;
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      if (dialog.open) fail('The SID library returned an invalid selection. Reload the library or close the browser.');
      return;
    }
    const message = data as Record<string, unknown>;
    if (!dialog.open && (message.type !== 'hvsc:ready' || message.mode !== 'file')) return;
    switch (message.type) {
      case 'hvsc:ready':
        if (message.mode !== 'file') {
          fail('The SID library returned an invalid response. Reload the library or close the browser.');
          return;
        }
        markReady();
        break;
      case 'hvsc:selected': {
        const selection = parseSelection(message);
        if (!selection) {
          fail('The SID library returned an invalid selection. Reload the library or close the browser.');
          return;
        }
        markReady();
        close();
        onSelect(selection);
        break;
      }
      case 'hvsc:error':
        showFailure('The SID library could not return this selection. Try another selection or reload the library.');
        break;
      default:
        if (typeof message.type !== 'string') fail('The SID library returned an invalid response. Reload the library or close the browser.');
    }
  }

  function cancel(event: Event): void {
    event.preventDefault();
    close();
  }

  function closed(): void {
    if (dialog.open) return;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus({preventScroll: true});
  }

  trigger.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  retry.addEventListener('click', loadFrame);
  dialog.addEventListener('cancel', cancel);
  dialog.addEventListener('close', closed);
  view.addEventListener('message', receive);

  return {
    close,
    dispose() {
      if (disposed) return;
      disposed = true;
      close();
      removeFrame();
      trigger.removeEventListener('click', open);
      closeButton.removeEventListener('click', close);
      retry.removeEventListener('click', loadFrame);
      dialog.removeEventListener('cancel', cancel);
      dialog.removeEventListener('close', closed);
      view.removeEventListener('message', receive);
      dialog.remove();
    },
  };
}

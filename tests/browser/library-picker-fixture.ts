import {readFileSync} from 'node:fs';
import type {Frame, Page} from '@playwright/test';

export const libraryOrigin = 'https://sidquake.c64demo.com';
export const libraryPath = 'C64Music/MUSICIANS/F/Fixture/Rambo.sid';
export const libraryTitle = 'Fixture <img src=x onerror="window.libraryMarkupRan=true"> Rambo';
export const libraryAuthor = 'Fixture & Composer';
export const libraryReleased = '2026 <b>test release</b>';
export const libraryStil = 'TITLE: <img src=x onerror="window.libraryMarkupRan=true">\nCOMMENT: <script>window.libraryMarkupRan=true</script>';
const clearedSid = readFileSync('public/generated/rambo-loader-main.sid');
export const clearedSidTitle = clearedSid.subarray(22, 54).toString('ascii').replace(/\0.*$/s, '').trim();
const differentSid = readFileSync('public/generated/bach-toccata.sid');
export const differentSidTitle = differentSid.subarray(22, 54).toString('ascii').replace(/\0.*$/s, '').trim();
export const differentLibraryPath = 'C64Music/MUSICIANS/F/Fixture/Bach.sid';

export type FixtureChoice = 'valid' | 'missing-metadata' | 'different' | 'malformed' | 'rsid' | 'third-chip' | 'error' | 'ready';
type FixtureWindow = Window & {
  libraryFixtureChoose: (choice: FixtureChoice, checkpoint?: string) => void;
  libraryFixtureCheckpoints: string[];
  libraryFixtureMessages: string[];
  libraryFixtureBeforeSelection?: () => void;
  libraryFixturePointerEvents: unknown[];
};

export function fixtureSidBytes(subtunes = 1): Buffer {
  const bytes = Buffer.from(clearedSid);
  bytes.writeUInt16BE(subtunes, 14);
  return bytes;
}

function providerHtml(parentOrigin: string, autoReady: boolean, subtunes = 1): string {
  const fixture = JSON.stringify({
    base64: fixtureSidBytes(subtunes).toString('base64'), path: libraryPath, title: libraryTitle,
    differentBase64: differentSid.toString('base64'), differentPath: differentLibraryPath,
    author: libraryAuthor, released: libraryReleased, stil: libraryStil,
  }).replaceAll('<', '\\u003c');
  return `<!doctype html><html><head><title>Deterministic SID picker provider</title></head><body>
    <p>Provider contract fixture · <a href="https://sidquake.c64demo.com/">SIDquake / HVSC</a></p>
    <label>Search <input id="fixture-search"></label>
    <label>Folder <select id="fixture-folder"><option>HVSC</option><option>MUSICIANS/H</option></select></label>
    <div id="fixture-results" style="height:80px;overflow:auto"><div style="height:1000px">Library results</div></div>
    <button data-choice="valid" disabled>Choose valid SID</button>
    <button data-choice="missing-metadata" disabled>Choose SID without metadata</button>
    <button data-choice="different" disabled>Choose different SID without metadata</button>
    <button data-choice="malformed" disabled>Send malformed selection</button>
    <button data-choice="rsid" disabled>Choose RSID</button>
    <button data-choice="third-chip" disabled>Choose third-chip SID</button>
    <button data-choice="error" disabled>Report provider failure</button>
    <button data-choice="ready" disabled>Report provider ready</button>
    <script>
      const fixture = ${fixture};
      const targetOrigin = ${JSON.stringify(parentOrigin)};
      window.libraryFixtureChoose = (choice, checkpoint) => {
        let message;
        let bytes;
        if (choice === 'ready') message = {type:'hvsc:ready', mode:'file'};
        else if (choice === 'error') message = {type:'hvsc:error', message:'Fixture provider failure'};
        else {
          const different = choice === 'different';
          bytes = Uint8Array.from(atob(different ? fixture.differentBase64 : fixture.base64), character => character.charCodeAt(0));
          if (choice === 'rsid') bytes.set([82, 83, 73, 68]);
          if (choice === 'third-chip') {
            new DataView(bytes.buffer).setUint16(4, 4);
            bytes[123] = 0x44;
          }
          message = {
            type:'hvsc:selected', mode:'file', bytes:bytes.buffer,
            name:different ? 'fixture-bach.sid' : 'fixture-rambo.sid', path:different ? fixture.differentPath : fixture.path,
          };
          if (choice !== 'missing-metadata' && !different) Object.assign(message, {
            title:fixture.title, author:fixture.author, released:fixture.released, stil:fixture.stil,
          });
          if (choice === 'malformed') message.bytes = 'not an ArrayBuffer';
        }
        parent.postMessage(message, targetOrigin, bytes && choice !== 'malformed' ? [bytes.buffer] : []);
        if (checkpoint) parent.postMessage({type:'fixture:checkpoint', checkpoint}, targetOrigin);
      };
      document.querySelectorAll('button').forEach(button => {
        button.addEventListener('click', () => window.libraryFixtureChoose(button.dataset.choice));
        button.disabled = false;
      });
      ${autoReady ? "window.libraryFixtureChoose('ready');" : ''}
    </script>
  </body></html>`;
}

export async function installLibraryProvider(page: Page, options: {autoReady?: boolean; subtunes?: number; songlengths?: string; songlengthStatus?: number} = {}) {
  let requests = 0;
  let lengthRequests = 0;
  await page.route('https://hvsc.c64.org/download/C64Music/DOCUMENTS/Songlengths.md5', async route => {
    lengthRequests++;
    await route.fulfill({status: options.songlengthStatus ?? 200, contentType: 'text/plain', headers: {'Access-Control-Allow-Origin':'*'}, body: options.songlengths ?? '[Database]\n'});
  });
  await page.addInitScript(() => {
    const fixture = window as unknown as FixtureWindow;
    fixture.libraryFixturePointerEvents = [];
    for (const type of ['pointerdown', 'pointerup', 'click', 'focusin']) {
      document.addEventListener(type, event => {
        const pointer = event as PointerEvent;
        const target = event.target as HTMLElement;
        fixture.libraryFixturePointerEvents.push({
          type, at: performance.now(), trusted: event.isTrusted,
          tag: target.tagName, id: target.id, choice: target.dataset?.choice,
          x: pointer.clientX, y: pointer.clientY,
        });
        if (fixture.libraryFixturePointerEvents.length > 64) fixture.libraryFixturePointerEvents.shift();
      }, true);
    }
    if (window !== window.top) return;
    fixture.libraryFixtureCheckpoints = [];
    fixture.libraryFixtureMessages = [];
    fixture.libraryFixtureBeforeSelection = undefined;
    window.addEventListener('message', event => {
      if (typeof event.data?.type === 'string' && event.data.type.startsWith('hvsc:')) fixture.libraryFixtureMessages.push(event.data.type);
      if (event.data?.type === 'fixture:checkpoint') fixture.libraryFixtureCheckpoints.push(event.data.checkpoint);
      if (fixture.libraryFixtureBeforeSelection && event.data?.type === 'hvsc:selected') {
        const supersede = fixture.libraryFixtureBeforeSelection;
        fixture.libraryFixtureBeforeSelection = undefined;
        supersede();
      }
    }, {capture: true});
  });
  await page.route(`${libraryOrigin}/hvsc-embed.html**`, async route => {
    requests++;
    await route.fulfill({contentType: 'text/html', body: providerHtml(new URL(page.url()).origin, options.autoReady ?? true, options.subtunes ?? 1)});
  });
  await page.route('https://unrelated.example/library-fixture**', async route => {
    await route.fulfill({contentType: 'text/html', body: providerHtml(new URL(page.url()).origin, true)});
  });
  return {requests: () => requests, lengthRequests: () => lengthRequests};
}

let checkpointCount = 0;
export async function sendFixtureMessage(page: Page, choice: FixtureChoice, selector = '#library-frame'): Promise<void> {
  const handle = await page.locator(selector).elementHandle();
  const frame = await handle!.contentFrame();
  if (!frame) throw new Error(`No provider frame for ${selector}`);
  await waitForFixture(frame);
  const checkpoint = `library-checkpoint-${++checkpointCount}`;
  await frame.evaluate(({choice, checkpoint}) => (window as unknown as FixtureWindow).libraryFixtureChoose(choice, checkpoint), {choice, checkpoint});
  await page.waitForFunction(checkpoint => (window as unknown as FixtureWindow).libraryFixtureCheckpoints.includes(checkpoint), checkpoint);
}

export async function addFixtureSender(page: Page, id: string, url: string): Promise<void> {
  await page.evaluate(({id, url}) => {
    const frame = document.createElement('iframe');
    frame.id = id;
    frame.hidden = true;
    frame.src = url;
    document.body.append(frame);
  }, {id, url});
  const handle = await page.locator(`#${id}`).elementHandle();
  const frame = await handle!.contentFrame();
  if (!frame) throw new Error(`No sender frame for ${id}`);
  await waitForFixture(frame);
}

export async function selectionMessageCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as FixtureWindow).libraryFixtureMessages.filter(type => type === 'hvsc:selected').length);
}

export async function libraryPointerDiagnostics(page: Page): Promise<unknown[]> {
  return Promise.all(page.frames().map(async frame => {
    try {
      return await frame.evaluate(() => {
        const fixture = window as unknown as FixtureWindow;
        return {origin: location.origin, timeOrigin: performance.timeOrigin, events: fixture.libraryFixturePointerEvents, messages: fixture.libraryFixtureMessages};
      });
    } catch {
      return {url: frame.url(), detached: frame.isDetached()};
    }
  }));
}

async function waitForFixture(frame: Frame): Promise<void> {
  await frame.waitForFunction(() => typeof (window as unknown as FixtureWindow).libraryFixtureChoose === 'function');
}

export async function reloadBeforeQueuedSelection(page: Page): Promise<void> {
  // Capture replaces the frame before delivery to test a genuinely discarded sender.
  await page.evaluate(() => {
    (window as unknown as FixtureWindow).libraryFixtureBeforeSelection = () => {
      document.querySelector<HTMLButtonElement>('#library-retry')!.click();
    };
  });
}

export async function dropBeforeQueuedSelection(page: Page): Promise<void> {
  await page.evaluate(base64 => {
    (window as unknown as FixtureWindow).libraryFixtureBeforeSelection = () => {
      const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'dropped-local.sid', {type: 'application/octet-stream'}));
      document.querySelector('#library-dialog header')!.dispatchEvent(new DragEvent('drop', {dataTransfer: transfer, bubbles: true, cancelable: true}));
    };
  }, clearedSid.toString('base64'));
}

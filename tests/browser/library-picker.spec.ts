import {test, expect} from './fixtures.ts';
import {holdWorkerRequest} from './worker-control.ts';
import {
  addFixtureSender, clearedSidTitle, differentLibraryPath, differentSidTitle, dropBeforeQueuedSelection, installLibraryProvider, libraryAuthor, libraryOrigin,
  libraryPath, libraryPointerDiagnostics, libraryReleased, libraryStil, libraryTitle, reloadBeforeQueuedSelection, selectionMessageCount, sendFixtureMessage,
} from './library-picker-fixture.ts';
import {resolve} from 'node:path';
import type {Page} from '@playwright/test';

const sample = resolve('public/generated/rambo-loader-main.sid');

test.afterEach(async ({page}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('library-pointer-events', {
      body: JSON.stringify(await libraryPointerDiagnostics(page), null, 2),
      contentType: 'application/json',
    });
  }
});

async function loadPausedSample(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  // fixtures.ts audits a connected silent sink; loading alone does not create an AudioContext.
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(0);
  await page.locator('#play-button').click();
  await expect(page.locator('#play-status')).toHaveText('Paused');
}

async function openLibrary(page: Page): Promise<void> {
  await page.locator('#browse-library').click();
  await expect(page.getByRole('dialog', {name: 'Browse SID library'})).toBeVisible();
}

async function expectLibraryLoaded(page: Page): Promise<void> {
  await expect(page.getByRole('dialog', {name: 'Browse SID library'})).toBeHidden();
  await expect(page.locator('#play-status')).toHaveText('Ready');
  await expect(page.locator('#source-kind')).toHaveText('SIDquake · HVSC');
  await expect(page.locator('#play-button')).toBeEnabled();
}

test('library browser is lazy and cancellation preserves playback and focus', async ({page}) => {
  const provider = await installLibraryProvider(page);
  await loadPausedSample(page);
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(.25);
  const title = await page.locator('#track-title').textContent();
  expect(provider.requests()).toBe(0);
  const open = page.locator('#browse-library');
  await expect(open).toBeVisible();
  await open.click();
  const dialog = page.getByRole('dialog', {name: 'Browse SID library'});
  await expect(dialog).toBeVisible();
  await expect.poll(provider.requests).toBe(1);
  await expect(page.frameLocator('#library-frame').getByRole('link', {name: 'SIDquake / HVSC'})).toBeVisible();
  const frameUrl = new URL((await page.locator('#library-frame').getAttribute('src'))!);
  expect(frameUrl.searchParams.get('mode')).toBe('file');
  for (const parameter of ['player', 'viz', 'autoplay', 'path']) expect(frameUrl.searchParams.get(parameter)).toBe('0');
  const position = Number(await page.locator('#seek-slider').inputValue());
  await page.setViewportSize({width: 390, height: 844});
  expect(await dialog.evaluate(element => element.getBoundingClientRect().width <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  expect(provider.requests()).toBe(1);
  await open.click();
  const providerChoice = page.frameLocator('#library-frame').getByRole('button', {name: 'Choose valid SID', exact: true});
  await expect(providerChoice).toBeEnabled();
  await providerChoice.focus();
  await expect(providerChoice).toBeFocused();
  await page.getByRole('button', {name: 'Close library browser'}).click();
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  await expect(page.locator('#track-title')).toHaveText(title!);
  await expect(page.locator('#play-status')).toHaveText('Live SID');
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(position);
  expect(provider.requests()).toBe(1);
});

test('selected SID uses the existing pending loader and keeps provider metadata inert', async ({page}) => {
  await installLibraryProvider(page);
  await loadPausedSample(page);
  await openLibrary(page);
  const releaseLoad = await holdWorkerRequest(page, 'load');
  await page.frameLocator('#library-frame').getByRole('button', {name: 'Choose valid SID', exact: true}).click();
  await expect(page.getByRole('dialog', {name: 'Browse SID library'})).toBeHidden();
  await expect(page.locator('#play-status')).toHaveText('Loading…');
  await expect(page.locator('#status-message')).toContainText('Opening SID from SIDquake…');
  await expect(page.locator('#play-button')).toBeDisabled();
  await expect(page.locator('#browse-library')).toBeDisabled();
  await releaseLoad();
  await expectLibraryLoaded(page);
  await expect(page.locator('#track-title')).toHaveText(libraryTitle);
  await expect(page.locator('#track-description')).toContainText(libraryAuthor);
  await expect(page.locator('#track-description')).toContainText(libraryReleased);
  expect(await page.locator('#source-links').getAttribute('title') ?? '').toBe('');
  await page.locator('#library-info > summary').click();
  await expect(page.locator('#library-info')).toContainText('Provided by SIDquake / HVSC');
  await expect(page.locator('#library-path')).toHaveText(libraryPath);
  await expect(page.locator('#library-stil')).toHaveText(libraryStil);
  await expect(page.locator('#track-title img, #track-description b, #library-stil img, #library-stil script')).toHaveCount(0);
  expect(await page.evaluate(() => 'libraryMarkupRan' in window)).toBe(false);
  await expect(page.locator('#analysis-badge')).toHaveText('Generic inspection');
  await page.locator('#load-button').click();
  await expectLibraryLoaded(page);
  await expect(page.locator('#track-title')).toHaveText(libraryTitle);
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(.25);
});

test('missing metadata falls back to the SID and local or sample loading clears library provenance', async ({page}) => {
  await installLibraryProvider(page);
  await loadPausedSample(page);
  await openLibrary(page);
  await page.frameLocator('#library-frame').getByRole('button', {name: 'Choose SID without metadata'}).click();
  await expectLibraryLoaded(page);
  await expect(page.locator('#track-title')).toHaveText(clearedSidTitle);
  await page.locator('#library-info > summary').click();
  await expect(page.locator('#library-path')).toHaveText(libraryPath);
  await expect(page.locator('#library-stil')).toBeHidden();
  await page.locator('#local-file').setInputFiles(sample);
  await expect(page.locator('#source-kind')).toContainText('Local file');
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect(page.locator('#library-info')).toBeHidden();
  await expect(page.locator('#library-path')).toBeEmpty();
  await expect(page.locator('#library-stil')).toBeEmpty();
  await openLibrary(page);
  await page.frameLocator('#library-frame').getByRole('button', {name: 'Choose valid SID', exact: true}).click();
  await expect.poll(() => selectionMessageCount(page)).toBe(2);
  await expectLibraryLoaded(page);
  await page.locator('#use-sample-button').click();
  await expect(page.locator('#source-kind')).toHaveText('From the sample library');
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect(page.locator('#library-info')).toBeHidden();
  await expect(page.locator('#library-path')).toBeEmpty();
  await expect(page.locator('#library-stil')).toBeEmpty();
});

test('another song from the retained library replaces the playing bytes and header metadata', async ({page}) => {
  const provider = await installLibraryProvider(page);
  await loadPausedSample(page);
  await openLibrary(page);
  const retainedFrame = await page.locator('#library-frame').elementHandle();
  const widget = page.frameLocator('#library-frame');
  await widget.getByRole('button', {name: 'Choose SID without metadata', exact: true}).click();
  await expectLibraryLoaded(page);
  await expect(page.locator('#track-title')).toHaveText(clearedSidTitle);
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(.25);
  await openLibrary(page);
  expect(await retainedFrame!.evaluate(element => element === document.querySelector('#library-frame'))).toBe(true);
  await widget.getByRole('button', {name: 'Choose different SID without metadata', exact: true}).click();
  await expectLibraryLoaded(page);
  await expect(page.locator('#track-title')).toHaveText(differentSidTitle);
  await expect(page.locator('#library-path')).toHaveText(differentLibraryPath);
  expect(provider.requests()).toBe(1);
  await expect(page.locator('#seek-slider')).toHaveValue('0');
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(.25);
  await expect(page.locator('#peak-label')).not.toHaveText('−∞ dBFS');
});

test('malformed, unrelated and superseded iframe messages cannot replace the current tune', async ({page}) => {
  const provider = await installLibraryProvider(page);
  await loadPausedSample(page);
  const title = await page.locator('#track-title').textContent();
  await openLibrary(page);
  await sendFixtureMessage(page, 'malformed');
  await expect(page.locator('#library-retry')).toBeVisible();
  await expect(page.locator('#track-title')).toHaveText(title!);
  await page.locator('#library-retry').click();
  await expect.poll(provider.requests).toBe(2);
  await addFixtureSender(page, 'wrong-origin-frame', 'https://unrelated.example/library-fixture');
  await sendFixtureMessage(page, 'valid', '#wrong-origin-frame');
  await expect(page.getByRole('dialog', {name: 'Browse SID library'})).toBeVisible();
  await expect(page.locator('#track-title')).toHaveText(title!);
  await addFixtureSender(page, 'wrong-window-frame', `${libraryOrigin}/hvsc-embed.html?fixture=unrelated`);
  await sendFixtureMessage(page, 'valid', '#wrong-window-frame');
  await expect(page.getByRole('dialog', {name: 'Browse SID library'})).toBeVisible();
  await expect(page.locator('#track-title')).toHaveText(title!);
  await sendFixtureMessage(page, 'error');
  await expect(page.locator('#library-retry')).toBeVisible();
  await reloadBeforeQueuedSelection(page);
  await sendFixtureMessage(page, 'valid');
  await expect.poll(provider.requests).toBe(4);
  await expect(page.getByRole('dialog', {name: 'Browse SID library'})).toBeVisible();
  await expect(page.locator('#track-title')).toHaveText(title!);
  await expect(page.locator('#source-kind')).toHaveText('From the sample library');
  await dropBeforeQueuedSelection(page);
  await sendFixtureMessage(page, 'valid');
  await expect(page.getByRole('dialog', {name: 'Browse SID library'})).toBeHidden();
  await expect(page.locator('#source-kind')).toContainText('Local file · dropped-local.sid');
  await expect(page.locator('#play-button')).toBeEnabled();
  await sendFixtureMessage(page, 'valid', '#wrong-window-frame');
  await expect(page.locator('#source-kind')).toContainText('Local file · dropped-local.sid');
  await expect(page.locator('#track-title')).toHaveText(clearedSidTitle);
});

test('unsupported library profiles report errors without replacing current playback', async ({page}) => {
  await installLibraryProvider(page);
  await loadPausedSample(page);
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(.25);
  const title = await page.locator('#track-title').textContent();
  for (const [choice, error] of [['Choose RSID', 'RSID'], ['Choose third-chip SID', 'third chip']] as const) {
    const position = Number(await page.locator('#seek-slider').inputValue());
    await openLibrary(page);
    await page.frameLocator('#library-frame').getByRole('button', {name: choice, exact: true}).click();
    await expect(page.getByRole('dialog', {name: 'Browse SID library'})).toBeHidden();
    await expect(page.locator('#status-message')).toContainText(error);
    await expect(page.locator('#status-message')).toHaveClass(/error/);
    await expect(page.locator('#track-title')).toHaveText(title!);
    await expect(page.locator('#source-kind')).toHaveText('From the sample library');
    await expect(page.locator('#play-status')).toHaveText('Live SID');
    await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(position);
  }
});

test('provider loading and failures expose retry and leave local opening available', async ({page}) => {
  const provider = await installLibraryProvider(page, {autoReady: false});
  await loadPausedSample(page);
  await openLibrary(page);
  await expect(page.locator('#library-status')).toContainText(/loading/i);
  await sendFixtureMessage(page, 'ready');
  await expect(page.locator('#library-status')).toContainText(/search|select|choose/i);
  await sendFixtureMessage(page, 'error');
  await expect(page.locator('#library-retry')).toBeVisible();
  await expect(page.locator('#library-status')).toContainText(/unavailable|failed|could not|retry/i);
  await page.locator('#library-retry').click();
  await expect.poll(provider.requests).toBe(2);
  await expect(page.locator('#library-status')).toContainText(/loading/i);
  await sendFixtureMessage(page, 'ready');
  await expect(page.locator('#library-retry')).toBeHidden();
  await page.getByRole('button', {name: 'Close library browser'}).click();
  await expect(page.locator('#browse-library')).toBeFocused();
  await page.locator('#local-file').setInputFiles(sample);
  await expect(page.locator('#source-kind')).toContainText('Local file');
  await expect(page.locator('#play-button')).toBeEnabled();
});

test('library search, folder and result position survive closing and selecting within the tab', async ({page}) => {
  const provider = await installLibraryProvider(page);
  await loadPausedSample(page);
  await openLibrary(page);
  const widget = page.frameLocator('#library-frame');
  await widget.locator('#fixture-search').fill('hülsbeck');
  await widget.locator('#fixture-folder').selectOption('MUSICIANS/H');
  await widget.locator('#fixture-results').evaluate(element => { element.scrollTop = 240; });
  const retainedFrame = await page.locator('#library-frame').elementHandle();
  const verifyState = async () => {
    expect(await retainedFrame!.evaluate(element => element === document.querySelector('#library-frame'))).toBe(true);
    expect(provider.requests()).toBe(1);
    await expect(widget.locator('#fixture-search')).toHaveValue('hülsbeck');
    await expect(widget.locator('#fixture-folder')).toHaveValue('MUSICIANS/H');
    expect(await widget.locator('#fixture-results').evaluate(element => element.scrollTop)).toBe(240);
  };
  await page.getByRole('button', {name: 'Close library browser'}).click();
  await expect(page.locator('#library-frame')).toHaveCount(1);
  await sendFixtureMessage(page, 'valid');
  await expect(page.locator('#source-kind')).toHaveText('From the sample library');
  await openLibrary(page);
  await verifyState();
  await widget.getByRole('button', {name: 'Choose valid SID', exact: true}).click();
  await expectLibraryLoaded(page);
  await openLibrary(page);
  await verifyState();
  await sendFixtureMessage(page, 'error');
  await expect(page.locator('#library-retry')).toHaveText('Reload library');
  await page.getByRole('button', {name: 'Close library browser'}).click();
  await openLibrary(page);
  await verifyState();
  await page.reload();
  await expect(page.locator('#library-frame')).toHaveCount(0);
  await openLibrary(page);
  await expect(widget.locator('#fixture-search')).toHaveValue('');
  await expect(widget.locator('#fixture-folder')).toHaveValue('HVSC');
  expect(provider.requests()).toBe(2);
  await page.getByRole('button', {name: 'Close library browser'}).click();
  await page.locator('#load-button').click();
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(0);
});

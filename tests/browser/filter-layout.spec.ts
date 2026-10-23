import type {Page} from '@playwright/test';
import {test, expect} from './fixtures.ts';

function changingFilterSid(): Uint8Array {
  const bytes = new Uint8Array(124 + 256);
  bytes.set([80, 83, 73, 68]);
  const header = new DataView(bytes.buffer);
  for (const [offset, value] of [[4, 2], [6, 124], [8, 0x1000], [10, 0x1000], [12, 0x1080], [14, 1], [16, 1]]) header.setUint16(offset, value);
  header.setUint16(118, 4 | 1 << 4);
  const writes = (settings: [number, number][]) => settings.flatMap(([register, value]) => [0xa9, value, 0x8d, register, 0xd4]);
  const minimum = writes([[21, 0], [22, 0], [23, 0], [24, 0]]);
  const maximum = writes([[21, 7], [22, 255], [23, 255], [24, 255]]);
  bytes.set([...writes([[0, 0x40], [1, 0x10], [4, 0x21], [5, 0], [6, 0xf0]]), ...minimum, 0xa9, 0, 0x8d, 0, 0x12, 0x60], 124);
  const end = 0x1080 + 10 + maximum.length + 3 + minimum.length;
  bytes.set([0xee, 0, 0x12, 0xad, 0, 0x12, 0x29, 0x40, 0xf0, maximum.length + 3, ...maximum, 0x4c, end & 255, end >> 8, ...minimum, 0x60], 124 + 0x80);
  return bytes;
}

async function layout(page: Page) {
  return page.evaluate(() => {
    const filter = document.querySelector('.shared-filter')!.getBoundingClientRect();
    const writes = document.querySelector('.inspector-writes')!.getBoundingClientRect();
    const output = document.querySelector('[aria-labelledby="output-title"]')!.getBoundingClientRect();
    return {height: filter.height, writesTop: writes.top - filter.top, outputTop: output.top - filter.top};
  });
}

test('shared-filter disclosure starts collapsed and keeps following content still as register values change', async ({page}, testInfo) => {
  await page.goto('/');
  const disclosure = page.locator('details.shared-filter');
  await expect(disclosure).not.toHaveAttribute('open');
  await expect(page.locator('#filter-details')).toBeHidden();
  await page.locator('#local-file').setInputFiles({name: 'changing-filter.sid', mimeType: 'application/octet-stream', buffer: Buffer.from(changingFilterSid())});
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await expect.poll(() => page.locator('#seek-slider').inputValue().then(Number)).toBeGreaterThan(0);
  await page.locator('#play-button').click();
  await expect(page.locator('#play-status')).toHaveText('Paused');

  for (const width of [1440, 1024, 390, 340]) {
    await page.setViewportSize({width, height: 1100});
    for (const expanded of [false, true]) {
      if (expanded) await disclosure.locator('summary').click();
      await expect(page.locator('#filter-details')).toBeVisible({visible: expanded});
      let baseline: Awaited<ReturnType<typeof layout>> | undefined;
      for (const maximum of [false, true, false]) {
        await page.locator('#seek-slider').fill(maximum ? '1.5' : '0.2');
        await expect(page.locator('#play-status')).toHaveText('Paused');
        await expect(page.locator('#filter-cutoff')).toHaveText(maximum ? '2047 / 2047' : '0 / 2047');
        await expect(page.locator('#filter-resonance')).toHaveText(maximum ? '15 / 15' : '0 / 15');
        await expect(page.locator('#filter-routed')).toHaveText(maximum ? 'V1, V2, V3' : 'None');
        await expect(page.locator('#filter-volume')).toHaveText(maximum ? '15 / 15' : '0 / 15');
        await expect(page.locator('#filter-direct')).toHaveText(maximum ? 'Off' : 'On');
        for (const mode of ['low-pass', 'band-pass', 'high-pass']) await expect(page.locator(`#filter-${mode}`)).toHaveText(maximum ? 'On' : 'Off');
        const current = await layout(page);
        if (baseline) expect(current).toEqual(baseline);
        else baseline = current;
        if (expanded) {
          expect(await page.locator('#filter-details dd').evaluateAll(values => values.every(value => value.scrollWidth <= value.clientWidth && value.scrollHeight <= value.clientHeight))).toBe(true);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (maximum && (width === 1024 || width === 390) && (expanded || width === 1024)) {
          await page.locator('.inspector').screenshot({path: `build/poc/filter-${expanded ? 'expanded' : 'collapsed'}-${width}-${testInfo.project.name}.png`});
        }
      }
    }
    await disclosure.locator('summary').click();
    await expect(disclosure).not.toHaveAttribute('open');
  }
});

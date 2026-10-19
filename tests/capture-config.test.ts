import {test} from 'node:test';
import assert from 'node:assert/strict';

test('README publication owns a local server even with a hosted-smoke URL', async t => {
  const saved = {...process.env};
  t.after(() => { process.env = saved; });
  process.env.EXPLORER_TEST_URL = 'https://example.com/old-build/';
  process.env.EXPLORER_README_CAPTURE = '1';
  delete process.env.CI;
  const {default: config} = await import('../playwright.config.ts' + '?readme');
  assert.equal(config.use?.baseURL, 'http://127.0.0.1:4174');
  assert.equal(config.webServer?.reuseExistingServer, false);
  assert.equal(config.webServer?.command, 'pnpm preview --port 4174 --strictPort');
});

test('ordinary browser checks retain hosted-smoke support', async t => {
  const saved = {...process.env};
  t.after(() => { process.env = saved; });
  process.env.EXPLORER_TEST_URL = 'https://example.com/current-build/';
  delete process.env.EXPLORER_README_CAPTURE;
  const {default: config} = await import('../playwright.config.ts' + '?hosted');
  assert.equal(config.use?.baseURL, process.env.EXPLORER_TEST_URL);
  assert.equal(config.webServer, undefined);
});

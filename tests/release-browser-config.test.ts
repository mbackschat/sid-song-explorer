import {test} from 'node:test';
import assert from 'node:assert/strict';

let importIndex = 0;

async function releaseConfig() {
  return (await import(`../playwright.config.ts?release=${importIndex++}`)).default;
}

function releaseEnvironment(t: {after(callback: () => void): void}) {
  const saved = {...process.env};
  t.after(() => { process.env = saved; });
  delete process.env.EXPLORER_TEST_URL;
  delete process.env.EXPLORER_README_CAPTURE;
  delete process.env.EXPLORER_FULL_SONG;
  delete process.env.CI;
  process.env.EXPLORER_RELEASE_CHECK = '1';
}

test('release browser checks own an unreused production preview and native test policy', async t => {
  releaseEnvironment(t);
  const config = await releaseConfig();
  assert.equal(config.use?.baseURL, 'http://127.0.0.1:4175');
  assert.equal(config.webServer?.reuseExistingServer, false);
  assert.equal(config.webServer?.command, 'pnpm preview --port 4175 --strictPort');
  assert.equal(config.timeout, 45_000);
  assert.equal(config.workers, 1);
  assert.equal(config.retries, 0);
  assert.equal(config.use?.trace, 'retain-on-failure');
  assert.equal(config.forbidOnly, true);
  assert.equal(config.globalSetup, './scripts/release-browser-setup.ts');
  assert.deepEqual(config.reporter, [['list'], ['./scripts/release-browser-reporter.ts']]);
});

for (const name of ['EXPLORER_TEST_URL', 'EXPLORER_README_CAPTURE', 'EXPLORER_FULL_SONG']) {
  for (const value of ['', '1']) {
    test(`release browser checks reject ${name}=${JSON.stringify(value)}`, async t => {
      releaseEnvironment(t);
      process.env[name] = value;
      await assert.rejects(releaseConfig, new RegExp(name));
    });
  }
}

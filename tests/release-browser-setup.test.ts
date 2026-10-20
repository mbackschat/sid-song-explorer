import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {FullConfig} from '@playwright/test';
import {validateReleaseBrowserConfig} from '../scripts/release-browser-setup.ts';

function candidateConfig(): FullConfig {
  return {
    workers: 1, forbidOnly: true,
    webServer: {command: 'pnpm preview --port 4175 --strictPort', url: 'http://127.0.0.1:4175', reuseExistingServer: false},
    projects: [{name: 'chrome', retries: 0, timeout: 45_000, use: {baseURL: 'http://127.0.0.1:4175', trace: 'retain-on-failure'}}],
  } as unknown as FullConfig;
}

test('release global setup accepts only the native production-preview policy', () => {
  assert.deepEqual(validateReleaseBrowserConfig(candidateConfig()), []);
});

test('release global setup rejects CLI overrides that weaken native browser validation', () => {
  const mutations = [
    (config: FullConfig) => { config.workers = 2; },
    (config: FullConfig) => { config.forbidOnly = false; },
    (config: FullConfig) => { config.projects[0].retries = 1; },
    (config: FullConfig) => { config.projects[0].timeout = 0; },
    (config: FullConfig) => { config.projects[0].use.trace = 'off'; },
    (config: FullConfig) => { config.projects[0].use.baseURL = 'https://example.com'; },
    (config: FullConfig) => { config.webServer!.reuseExistingServer = true; },
    (config: FullConfig) => { config.webServer!.command = 'pnpm dev'; },
    (config: FullConfig) => { config.webServer = null; },
  ];
  for (const mutate of mutations) {
    const config = candidateConfig();
    mutate(config);
    assert.notDeepEqual(validateReleaseBrowserConfig(config), []);
  }
});

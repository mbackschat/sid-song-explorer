import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'browser.spec.ts', timeout: 45_000, globalTimeout: 60_000,
  fullyParallel: false, workers: 1, retries: 0,
  outputDir: '../../../build/live-voice-browser/test-results',
  use: {baseURL: 'http://127.0.0.1:4175', viewport: {width: 1100, height: 850}, trace: 'retain-on-failure'},
  projects: [
    {name: 'chrome', use: {browserName: 'chromium', channel: 'chrome'}},
    ...(process.platform === 'darwin' ? [{name: 'webkit', use: {browserName: 'webkit' as const}}] : []),
  ],
  webServer: {command: 'pnpm exec vite preview --config scripts/experiments/live-voice-browser/vite.config.mjs',
    cwd: '../../..', url: 'http://127.0.0.1:4175', reuseExistingServer: true, timeout: 15_000},
});

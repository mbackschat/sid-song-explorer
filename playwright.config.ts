import { defineConfig } from '@playwright/test';

const publishedUrl = process.env.EXPLORER_TEST_URL;
export default defineConfig({
  testDir: './tests/browser', timeout: 45_000, fullyParallel: false, workers: 1,
  use: {baseURL: publishedUrl ?? 'http://127.0.0.1:4173', viewport: {width: 1440, height: 1100}, trace: 'retain-on-failure'},
  projects: [
    {name: 'chrome', use: {browserName: 'chromium', channel: 'chrome'}},
    ...(process.platform === 'darwin' ? [{name: 'webkit', use: {browserName: 'webkit' as const}}] : []),
  ],
  webServer: publishedUrl ? undefined : {command: 'pnpm preview --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI, timeout: 30_000},
});

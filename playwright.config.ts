import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 45_000, fullyParallel: false, workers: 1,
  use: {baseURL: 'http://127.0.0.1:4173', viewport: {width: 1440, height: 1100}, trace: 'retain-on-failure'},
  projects: [
    {name: 'chromium', use: {browserName: 'chromium', ...(process.env.EXPLORER_CHROME ? {channel: 'chrome'} : {})}},
    {name: 'webkit', use: {browserName: 'webkit'}},
  ],
  webServer: {command: 'pnpm preview --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI, timeout: 30_000},
});

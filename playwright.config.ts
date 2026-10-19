import { defineConfig } from '@playwright/test';

const readmeCapture = process.env.EXPLORER_README_CAPTURE === '1';
const port = readmeCapture ? 4174 : 4173;
const localUrl = `http://127.0.0.1:${port}`;
const publishedUrl = readmeCapture ? undefined : process.env.EXPLORER_TEST_URL;
export default defineConfig({
  testDir: './tests/browser', timeout: 45_000, fullyParallel: false, workers: 1, retries: 0,
  use: {baseURL: publishedUrl ?? localUrl, viewport: {width: 1440, height: 1100}, trace: 'retain-on-failure'},
  projects: [
    {name: 'chrome', use: {browserName: 'chromium', channel: 'chrome'}},
    ...(process.platform === 'darwin' ? [{name: 'webkit', use: {browserName: 'webkit' as const}}] : []),
  ],
  webServer: publishedUrl ? undefined : {command: `pnpm preview --port ${port} --strictPort`, url: localUrl, reuseExistingServer: !readmeCapture && !process.env.CI, timeout: 30_000},
});

import {execFile} from 'node:child_process';
import {resolve} from 'node:path';
import {promisify} from 'node:util';
import type {FullConfig} from '@playwright/test';
import {verifyArtifact, verifyServedArtifact} from './release-artifact.ts';
import type {ReleaseBrowserMetadata} from './release-browser-reporter.ts';

const baseURL = 'http://127.0.0.1:4175';
const execute = promisify(execFile);

export function validateReleaseBrowserConfig(config: FullConfig): string[] {
  const errors: string[] = [];
  if (config.workers !== 1) errors.push('Release browser checks require one native Playwright worker.');
  if (!config.forbidOnly) errors.push('Release browser checks must forbid focused tests.');
  if (config.webServer?.command !== 'pnpm preview --port 4175 --strictPort'
    || config.webServer.url !== baseURL || config.webServer.reuseExistingServer !== false) {
    errors.push('Release browser checks must own the strict local production preview.');
  }
  for (const project of config.projects) {
    if (project.use.baseURL !== baseURL || project.retries !== 0 || project.timeout !== 45_000 || project.use.trace !== 'retain-on-failure') {
      errors.push(`Release browser project ${project.name} changed the required URL, retries, timeout or tracing policy.`);
    }
  }
  return errors;
}

export default async function releaseBrowserSetup(config: FullConfig): Promise<void> {
  delete config.metadata.releaseBrowser;
  const errors = validateReleaseBrowserConfig(config);
  if (errors.length) throw new Error(errors.join('\n'));
  const root = resolve(import.meta.dirname, '..');
  const {stdout} = await execute('git', ['rev-parse', 'HEAD'], {cwd: root, timeout: 5000});
  const manifest = await verifyArtifact(root, stdout.trim());
  await verifyServedArtifact(baseURL, manifest);
  const metadata: ReleaseBrowserMetadata = {commit: manifest.commit, artifactDigest: manifest.digest};
  config.metadata.releaseBrowser = metadata;
}

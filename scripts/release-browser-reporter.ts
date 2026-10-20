import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, join, relative, resolve, sep} from 'node:path';
import type {Reporter, FullConfig, FullProject, Suite, TestCase, TestResult, FullResult, TestError} from '@playwright/test/reporter';

type Annotation = {type: string; description?: string};
type Status = TestResult['status'];

export type ReleaseTest = {
  id: string;
  project: string;
  file: string;
  titlePath: string[];
  expectedStatus: Status;
  annotations: Annotation[];
};

export type ReleaseResult = {
  id: string;
  project: string;
  status: Status;
  retry: number;
  expectedStatus: Status;
  annotations: Annotation[];
};

export type ReleaseBrowserMetadata = {commit: string; artifactDigest: string};
export type ReleaseBrowserReceipt = {
  schemaVersion: 1;
  commit: string | null;
  artifactDigest: string | null;
  platform: NodeJS.Platform;
  project: string;
  shard: {current: number; total: number};
  browsers: {project: string; browserName: string; channel?: string; version: string}[];
  discovered: ReleaseTest[];
  results: ReleaseResult[];
  skips: {id: string; reason: string; exclusion: string | null}[];
  errors: string[];
  status: 'passed' | 'failed';
};

const fullSongFile = 'tests/browser/full-song.spec.ts';
const fullSongReason = 'Opt in to full-duration real-time playback checks.';

function declaredExclusion(test: ReleaseTest, result: ReleaseResult): boolean {
  return test.file === fullSongFile && result.status === 'skipped'
    && result.annotations.some(annotation => annotation.type === 'skip' && annotation.description === fullSongReason)
    && result.annotations.every(annotation => !['fail', 'fixme'].includes(annotation.type));
}

export function validateReleaseInventory(discovered: ReleaseTest[], results: ReleaseResult[]): string[] {
  const errors: string[] = [];
  const tests = new Map<string, ReleaseTest>();
  const attempts = new Map<string, ReleaseResult[]>();
  if (!discovered.length) errors.push('Empty release browser inventory.');
  for (const test of discovered) {
    if (tests.has(test.id)) errors.push(`Duplicate discovered test ID: ${test.id}`);
    tests.set(test.id, test);
    if (test.expectedStatus === 'failed' || test.annotations.some(annotation => annotation.type === 'fail')) {
      errors.push(`Expected-failure masking is forbidden: ${test.id}`);
    }
  }
  for (const result of results) {
    const test = tests.get(result.id);
    if (!test) errors.push(`Undiscovered result: ${result.id}`);
    else if (test.project !== result.project) errors.push(`Result project does not match discovery: ${result.id}`);
    const group = attempts.get(result.id) ?? [];
    group.push(result);
    attempts.set(result.id, group);
    if (result.retry !== 0) errors.push(`Retry is forbidden: ${result.id}`);
    if (result.expectedStatus === 'failed' || result.annotations.some(annotation => annotation.type === 'fail')) {
      errors.push(`Expected-failure masking is forbidden: ${result.id}`);
    }
    if (result.status === 'skipped') {
      if (!test || !declaredExclusion(test, result)) errors.push(`Unexpected skip: ${result.id}`);
    } else if (result.status !== 'passed' || result.expectedStatus !== 'passed') {
      errors.push(`Result did not pass: ${result.id} (${result.status}, expected ${result.expectedStatus})`);
    }
  }
  for (const test of discovered) {
    const count = attempts.get(test.id)?.length ?? 0;
    if (count === 0) errors.push(`Missing result: ${test.id}`);
    if (count > 1) errors.push(`Multiple result attempts: ${test.id}`);
  }
  return errors;
}

export default class ReleaseBrowserReporter implements Reporter {
  private root = resolve(import.meta.dirname, '..');
  private shard = {current: 1, total: 1};
  private metadata: ReleaseBrowserMetadata | undefined;
  private discovered: ReleaseTest[] = [];
  private results: ReleaseResult[] = [];
  private projects = new Map<string, FullProject>();
  private errors: string[] = [];

  onBegin(config: FullConfig, suite: Suite): void {
    this.root = dirname(config.configFile ?? join(this.root, 'playwright.config.ts'));
    this.shard = config.shard ?? this.shard;
    const metadata = config.metadata.releaseBrowser as Partial<ReleaseBrowserMetadata> | undefined;
    if (typeof metadata?.commit === 'string' && typeof metadata.artifactDigest === 'string') {
      this.metadata = {commit: metadata.commit, artifactDigest: metadata.artifactDigest};
    }
    this.discovered = suite.allTests().map(test => {
      const project = test.parent.project();
      if (project) this.projects.set(project.name, project);
      return {
        id: test.id, project: project?.name ?? '',
        file: relative(this.root, test.location.file).split(sep).join('/'),
        titlePath: test.titlePath(), expectedStatus: test.expectedStatus,
        annotations: test.annotations.map(({type, description}) => ({type, description})),
      };
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.results.push({
      id: test.id, project: test.parent.project()?.name ?? '', status: result.status,
      retry: result.retry, expectedStatus: test.expectedStatus,
      annotations: result.annotations.map(({type, description}) => ({type, description})),
    });
  }

  onError(error: TestError): void {
    this.errors.push(error.message ?? error.value ?? 'Unknown Playwright error.');
  }

  async onEnd(result: FullResult): Promise<{status: 'failed'} | undefined> {
    const errors = [...this.errors, ...validateReleaseInventory(this.discovered, this.results)];
    if (!this.metadata) errors.push('Release artifact metadata is missing; global setup did not verify the candidate.');
    if (result.status !== 'passed') errors.push(`Playwright run did not pass: ${result.status}`);
    for (const attempt of this.results) {
      if (attempt.status === 'passed' && !attempt.annotations.some(annotation => annotation.type === 'browser-version' && annotation.description?.trim())) {
        errors.push(`Actual browser version is missing: ${attempt.id}`);
      }
    }
    await mkdir(join(this.root, 'build/release'), {recursive: true});
    for (const [name, project] of this.projects) {
      const discovered = this.discovered.filter(test => test.project === name);
      const results = this.results.filter(test => test.project === name);
      const versions = new Set(results.flatMap(test => test.annotations
        .filter(annotation => annotation.type === 'browser-version' && annotation.description?.trim())
        .map(annotation => annotation.description!)));
      const receipt: ReleaseBrowserReceipt = {
        schemaVersion: 1, commit: this.metadata?.commit ?? null, artifactDigest: this.metadata?.artifactDigest ?? null,
        platform: process.platform, project: name, shard: this.shard,
        browsers: [...versions].sort().map(version => ({
          project: name, browserName: project.use.browserName ?? 'chromium',
          ...(project.use.channel ? {channel: project.use.channel} : {}), version,
        })),
        discovered, results,
        skips: results.filter(attempt => attempt.status === 'skipped').map(attempt => ({
          id: attempt.id, reason: attempt.annotations.find(annotation => annotation.type === 'skip')?.description ?? '',
          exclusion: discovered.some(test => test.id === attempt.id && declaredExclusion(test, attempt)) ? 'full-song-opt-in' : null,
        })),
        errors, status: errors.length ? 'failed' : 'passed',
      };
      await writeFile(join(this.root, 'build/release', `browser-${name}-${this.shard.current}.json`), JSON.stringify(receipt, null, 2) + '\n');
    }
    if (errors.length) {
      console.error(`Release browser validation failed:\n${errors.join('\n')}`);
      return {status: 'failed'};
    }
    return undefined;
  }

  printsToStdio(): boolean { return false; }
}

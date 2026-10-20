import { fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SAMPLE_RATE, type LoadResult, type PlaybackOptions } from '../../../src/engine/session.ts';
import type { AnalysisReport } from './analysis.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUTPUT_ROOT = resolve(ROOT, 'build/sid-analysis');
const MAX_INPUT_BYTES = 65536 + 126;
const MAX_REPORT_BYTES = 4 * 1024 * 1024;
export const JOB_TIMEOUT_MS = 45000;

export interface Arguments extends PlaybackOptions {
  input: string;
  seconds: number;
  output: string;
}

export interface FileIdentity {
  name: string;
  sha256: string;
  byteLength: number;
}

export interface AnalysisJob {
  bytes: Uint8Array;
  profile: PlaybackOptions;
  requestedFrames: number;
}

export interface WorkerResult {
  runtime: {engine: 'libsidplayfp-wasm/SIDLite'; files: FileIdentity[]};
  session: LoadResult;
  actualFrames: number;
  peakRssBytes: number;
  analysis: AnalysisReport;
}

export interface ReportEnvelope {
  schemaVersion: 1;
  input: FileIdentity;
  runtime: WorkerResult['runtime'];
  measurement: {
    profile: PlaybackOptions;
    session: LoadResult;
    requestedSeconds: number;
    requestedFrames: number;
    actualSeconds: number;
    actualFrames: number;
    stopReason: 'requested-duration';
    wallTimeMs: number;
    workerPeakRssBytes: number;
    hostPeakRssBytes: number;
    reportBytes: number;
    jobTimeoutMs: number;
  };
  analysis: AnalysisReport;
}

export function parseArguments(args: string[]): Arguments {
  const allowed = new Set(['--input', '--seconds', '--clock', '--model', '--subtune', '--output']);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!allowed.has(flag)) throw new Error(`Unknown argument: ${flag}`);
    if (values.has(flag)) throw new Error(`Duplicate argument: ${flag}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    values.set(flag, value);
  }
  for (const flag of allowed) if (!values.get(flag)?.trim()) throw new Error(`Required argument: ${flag}`);
  const seconds = Number(values.get('--seconds'));
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600) throw new Error('seconds must be finite, greater than 0 and at most 600');
  if (Math.floor(seconds * SAMPLE_RATE) < 1) throw new Error('seconds must cover at least one PCM frame');
  const clock = values.get('--clock');
  const model = values.get('--model');
  const subtune = Number(values.get('--subtune'));
  if (clock !== 'PAL' && clock !== 'NTSC') throw new Error('clock must be PAL or NTSC');
  if (model !== 'MOS6581' && model !== 'MOS8580') throw new Error('model must be MOS6581 or MOS8580');
  if (!Number.isInteger(subtune) || subtune < 1 || subtune > 256) throw new Error('subtune must be a one-based integer between 1 and 256');
  return {input: resolve(values.get('--input')!), output: resolve(values.get('--output')!), seconds, clock, model, subtune};
}

function containedBy(directory: string, target: string): boolean {
  const path = relative(directory, target);
  return path !== '' && path !== '..' && !path.startsWith('../') && !isAbsolute(path);
}

async function optionalStat(path: string) {
  try { return await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

async function validatePaths(args: Arguments): Promise<void> {
  if (!containedBy(OUTPUT_ROOT, args.output)) throw new Error('output must be a file under build/sid-analysis/');
  if (args.input === args.output) throw new Error('output must not overwrite the input');
  const output = await optionalStat(args.output);
  if (output?.isSymbolicLink()) throw new Error('output must not be a symbolic link');
  if (output && !output.isFile()) throw new Error('output must be a regular file');
  let ancestor = dirname(args.output);
  while (!(await optionalStat(ancestor))) ancestor = dirname(ancestor);
  const physicalOutput = resolve(await realpath(ancestor), relative(ancestor, args.output));
  const physicalRoot = resolve(await realpath(ROOT), 'build/sid-analysis');
  if (!containedBy(physicalRoot, physicalOutput)) throw new Error('output must remain under build/sid-analysis/ after resolving symbolic links');
  const input = await stat(args.input);
  if (!input.isFile() || input.size < 118 || input.size > MAX_INPUT_BYTES) throw new Error(`input must be a regular PSID file from 118 to ${MAX_INPUT_BYTES} bytes`);
  if (output && output.dev === input.dev && output.ino === input.ino) throw new Error('output must not overwrite the input');
}

export function fileIdentity(name: string, bytes: Uint8Array): FileIdentity {
  return {name, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength};
}

export function runWorker(job: AnalysisJob, options: {entryPoint?: URL; timeoutMs?: number; onProgress?: (frame: number) => void} = {}): Promise<WorkerResult> {
  const timeoutMs = options.timeoutMs ?? JOB_TIMEOUT_MS;
  return new Promise((resolveResult, reject) => {
    const child = fork(options.entryPoint ?? new URL('./worker.ts', import.meta.url), [], {
      cwd: ROOT, execArgv: ['--experimental-strip-types'], serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let result: WorkerResult | undefined;
    let failure: Error | undefined;
    let diagnostics = '';
    const stop = (error: Error) => { failure ??= error; child.kill('SIGKILL'); };
    const timer = setTimeout(() => stop(new Error(`Analysis job deadline exceeded (${timeoutMs} ms); worker terminated`)), timeoutMs);
    const interrupted = () => stop(new Error('Analysis job interrupted; worker terminated'));
    process.once('SIGINT', interrupted);
    process.once('SIGTERM', interrupted);
    child.stderr?.on('data', (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-4096); });
    child.on('message', (message: unknown) => {
      const value = message as {type?: string; result?: WorkerResult; message?: string; frame?: number};
      if (value.type === 'result') result = value.result;
      else if (value.type === 'error') failure = new Error(value.message ?? 'Analysis worker failed');
      else if (value.type === 'progress' && typeof value.frame === 'number') options.onProgress?.(value.frame);
    });
    const cleanup = () => {
      clearTimeout(timer);
      process.removeListener('SIGINT', interrupted);
      process.removeListener('SIGTERM', interrupted);
    };
    child.once('error', (error) => { cleanup(); reject(error); });
    child.once('exit', (code, signal) => {
      cleanup();
      if (failure) reject(failure);
      else if (code !== 0 || !result) reject(new Error(`Analysis worker exited without a complete report (code ${code}, signal ${signal})${diagnostics ? `: ${diagnostics.trim()}` : ''}`));
      else resolveResult(result);
    });
    child.send(job, (error) => { if (error) stop(error); });
  });
}

export async function run(args: string[], onProgress?: (frame: number) => void): Promise<ReportEnvelope> {
  const selected = parseArguments(args);
  await validatePaths(selected);
  const started = performance.now();
  const input = await open(selected.input, 'r');
  let bytes: Uint8Array;
  try {
    const size = (await input.stat()).size;
    if (size < 118 || size > MAX_INPUT_BYTES) throw new Error('input size changed or exceeds the PSID bound');
    bytes = new Uint8Array(size);
    const {bytesRead} = await input.read(bytes, 0, size, 0);
    if (bytesRead !== size) throw new Error('input changed while being read');
  } finally { await input.close(); }
  const profile = {clock: selected.clock, model: selected.model, subtune: selected.subtune};
  const requestedFrames = Math.floor(selected.seconds * SAMPLE_RATE);
  const result = await runWorker({bytes, profile, requestedFrames}, {onProgress});
  if (result.actualFrames !== requestedFrames || result.analysis.coverage.renderedFrames !== requestedFrames) {
    throw new Error('Analysis worker did not cover the complete requested frame interval');
  }
  const envelope: ReportEnvelope = {
    schemaVersion: 1, input: fileIdentity(basename(selected.input), bytes), runtime: result.runtime,
    measurement: {
      profile, session: result.session, requestedSeconds: selected.seconds, requestedFrames,
      actualSeconds: result.actualFrames / SAMPLE_RATE, actualFrames: result.actualFrames,
      stopReason: 'requested-duration', wallTimeMs: performance.now() - started,
      workerPeakRssBytes: result.peakRssBytes, hostPeakRssBytes: process.resourceUsage().maxRSS * 1024,
      reportBytes: 0, jobTimeoutMs: JOB_TIMEOUT_MS,
    },
    analysis: result.analysis,
  };
  let json = '';
  for (let attempt = 0; attempt < 8; attempt++) {
    json = `${JSON.stringify(envelope, null, 2)}\n`;
    const size = Buffer.byteLength(json);
    if (size > MAX_REPORT_BYTES) throw new Error(`Analysis report exceeds ${MAX_REPORT_BYTES} bytes`);
    if (envelope.measurement.reportBytes === size) break;
    envelope.measurement.reportBytes = size;
  }
  await mkdir(dirname(selected.output), {recursive: true});
  const temporary = `${selected.output}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, json, {flag: 'wx'});
    await rename(temporary, selected.output);
  } finally { await rm(temporary, {force: true}); }
  return envelope;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run(process.argv.slice(2), frame => process.stderr.write(`Analysed ${(frame / SAMPLE_RATE).toFixed(1)} seconds\n`))
    .then(report => process.stdout.write(`Wrote ${report.measurement.reportBytes} bytes; ${report.measurement.actualSeconds} seconds analysed in ${report.measurement.wallTimeMs.toFixed(1)} ms\n`))
    .catch(error => { process.stderr.write(`${(error as Error).message}\n`); process.exitCode = 1; });
}

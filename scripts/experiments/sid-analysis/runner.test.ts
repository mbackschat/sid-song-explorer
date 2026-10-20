import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { parseArguments, run, runWorker } from './run.ts';

const argumentsFor = (output: string) => ['--input', 'public/generated/rambo-loader-main.sid', '--seconds', '30', '--clock', 'PAL', '--model', 'MOS6581', '--subtune', '1', '--output', output];
await mkdir(resolve('build/sid-analysis'), {recursive: true});

test('requires an explicit finite interval and playback profile before touching output', async () => {
  const directory = await mkdtemp(resolve('build/sid-analysis/invalid-'));
  const output = resolve(directory, 'absent/report.json');
  try {
    for (const invalid of ['NaN', 'Infinity', '0', '-1', '601', '0.000001']) {
      const args = argumentsFor(output);
      args[3] = invalid;
      await assert.rejects(run(args), /seconds|frame/);
    }
    assert.throws(() => parseArguments(argumentsFor(output).slice(2)), /input/);
    assert.throws(() => parseArguments([...argumentsFor(output), '--clock', 'NTSC']), /Duplicate/);
    assert.throws(() => parseArguments([...argumentsFor(output), '--unknown', 'value']), /Unknown/);
    for (const [position, invalid] of [[5, 'pal'], [7, '6581'], [9, '1.5'], [9, '0']] as const) {
      const args = argumentsFor(output);
      args[position] = invalid;
      assert.throws(() => parseArguments(args), /clock|model|subtune/);
    }
    await assert.rejects(stat(resolve(directory, 'absent')), {code: 'ENOENT'});
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('rejects output outside the ignored experiment directory and input clobbering', async () => {
  const directory = await mkdtemp(resolve('build/sid-analysis/paths-'));
  const input = resolve(directory, 'source.sid');
  const bytes = new Uint8Array([1, 2, 3]);
  await writeFile(input, bytes);
  try {
    await assert.rejects(run(argumentsFor('/private/tmp/sid-analysis-report.json')), /build\/sid-analysis/);
    const args = argumentsFor(input);
    args[1] = input;
    await assert.rejects(run(args), /input/);
    assert.deepEqual(await readFile(input), Buffer.from(bytes));
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('the parent kills and reaps a worker blocked in synchronous execution', {timeout: 5000}, async () => {
  const directory = await mkdtemp(resolve('build/sid-analysis/deadline-'));
  const fixture = resolve(directory, 'blocked.mjs');
  await writeFile(fixture, 'process.on("message", () => { while (true) {} });\n');
  const started = performance.now();
  try {
    await assert.rejects(runWorker({} as never, {entryPoint: pathToFileURL(fixture), timeoutMs: 150}), /deadline.*150|150.*deadline/);
    assert.ok(performance.now() - started < 3000, 'a worker blocking its event loop must not block the host deadline');
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('a worker exiting without a complete report cannot succeed', {timeout: 5000}, async () => {
  const directory = await mkdtemp(resolve('build/sid-analysis/failure-'));
  const fixture = resolve(directory, 'failed.mjs');
  await writeFile(fixture, 'process.on("message", () => process.exit(0));\n');
  try {
    await assert.rejects(runWorker({} as never, {entryPoint: pathToFileURL(fixture), timeoutMs: 1000}), /complete report/);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SAMPLE_RATE, SidSession } from '../../../src/engine/session.ts';
import { AnalysisAccumulator } from './analysis.ts';
import { fileIdentity, type AnalysisJob, type WorkerResult } from './run.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ENGINE_DIRECTORY = resolve(ROOT, 'build/engine');

async function analyse(job: AnalysisJob): Promise<WorkerResult> {
  const files = [];
  for (const name of ['libsidplayfp.js', 'libsidplayfp.wasm']) {
    files.push(fileIdentity(name, await readFile(resolve(ENGINE_DIRECTORY, name))));
  }
  const session = await SidSession.create({moduleUrl: pathToFileURL(resolve(ENGINE_DIRECTORY, 'libsidplayfp.js')).href});
  try {
    const info = await session.load(job.bytes, job.profile);
    const accumulator = new AnalysisAccumulator(info, job.requestedFrames);
    let actualFrames = 0;
    let lastProgressFrame = 0;
    while (actualFrames < job.requestedFrames) {
      const block = session.render(Math.min(16384, job.requestedFrames - actualFrames));
      accumulator.append(block);
      actualFrames = block.endFrame;
      if (actualFrames - lastProgressFrame >= SAMPLE_RATE * 5 || actualFrames === job.requestedFrames) {
        process.send?.({type: 'progress', frame: actualFrames});
        lastProgressFrame = actualFrames;
      }
    }
    const analysis = accumulator.finish();
    return {runtime: {engine: 'libsidplayfp-wasm/SIDLite', files}, session: info, actualFrames,
      peakRssBytes: process.resourceUsage().maxRSS * 1024, analysis};
  } finally { session.dispose(); }
}

process.once('message', (job: AnalysisJob) => {
  analyse(job)
    .then(result => process.send?.({type: 'result', result}, undefined, undefined, () => process.disconnect()))
    .catch(error => {
      process.exitCode = 1;
      process.send?.({type: 'error', message: (error as Error).message}, undefined, undefined, () => process.disconnect());
    });
});

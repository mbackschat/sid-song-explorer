import moduleUrl from '../../build/engine/libsidplayfp.js?url';
import wasmUrl from '../../build/engine/libsidplayfp.wasm?url';
import { CachedSidSession } from './cached-session.ts';
import { SAMPLE_RATE } from './session.ts';
import type { EngineEvent, EngineReply, EngineRequest, EngineResult } from './protocol.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let session: CachedSidSession | undefined;
let durationSeconds: number | undefined;
let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
let prefetchFailed = false;
let cacheEpoch = 0;
let lastReportedEnd = -1;
let lastReportedStart = -1;

function reportCache(force = false): void {
  if (!session) return;
  const startFrame = session.cacheStartFrame;
  const endFrame = session.cacheEndFrame;
  if (!force && startFrame === lastReportedStart && endFrame - lastReportedEnd < SAMPLE_RATE) return;
  lastReportedStart = startFrame;
  lastReportedEnd = endFrame;
  scope.postMessage({event:'cache', coverage:{epoch:cacheEpoch, startFrame, endFrame}} satisfies EngineEvent);
}

function schedulePrefetch(): void {
  if (!session || prefetchFailed || prefetchTimer !== undefined || queuedRequests) return;
  prefetchTimer = setTimeout(() => {
    prefetchTimer = undefined;
    if (!session || prefetchFailed || queuedRequests) return;
    const limit = Math.floor(Math.min(600, durationSeconds ?? session.positionFrame / SAMPLE_RATE + 30) * SAMPLE_RATE);
    const frames = Math.min(Math.floor(SAMPLE_RATE / 4), limit - session.renderedFrame);
    if (frames <= 0) { reportCache(true); return; }
    try {
      if (!session.prefetch(frames)) { reportCache(true); return; }
      reportCache();
      schedulePrefetch();
    } catch {
      // Valid cached audio remains usable; foreground rendering reports a failure only when it needs the failed producer.
      prefetchFailed = true;
      reportCache(true);
    }
  }, 0);
}
let queue = Promise.resolve();
let queuedRequests = 0;
const MAX_QUEUED_REQUESTS = 16;

async function dispatch(request: EngineRequest): Promise<EngineResult> {
  if (!Number.isSafeInteger(request.id)) throw new Error('Engine request id must be an integer');
  if (request.method === 'dispose') {
    if (prefetchTimer !== undefined) clearTimeout(prefetchTimer);
    prefetchTimer = undefined;
    session?.dispose();
    session = undefined;
    return null;
  }
  session ??= await CachedSidSession.create({ moduleUrl, wasmUrl });
  switch (request.method) {
    case 'load': {
      cacheEpoch = request.cacheEpoch;
      const result = await session.load(request.payload.bytes, request.payload.options);
      durationSeconds = request.payload.durationSeconds;
      if (!Number.isFinite(durationSeconds) || durationSeconds! <= 0) durationSeconds = undefined;
      prefetchFailed = false;
      reportCache(true);
      return result;
    }
    case 'render': return session.render(request.payload.frames);
    case 'seek': return session.seek(request.payload.seconds);
    case 'observe': return session.observe(request.payload.startSeconds, request.payload.endSeconds);
    case 'overview': return session.overview(request.payload.startSeconds, request.payload.endSeconds);
    case 'mute': {
      cacheEpoch = request.cacheEpoch;
      const result = await session.mute(request.payload.mask);
      prefetchFailed = false;
      return result;
    }
    default: throw new Error('Unknown engine method');
  }
}

scope.onmessage = (event: MessageEvent<EngineRequest>) => {
  if (queuedRequests >= MAX_QUEUED_REQUESTS) {
    scope.postMessage({ id: event.data?.id, error: 'Engine request queue is full (maximum 16 pending requests)' } satisfies EngineReply);
    return;
  }
  queuedRequests++;
  queue = queue.then(async () => {
    const id = event.data?.id;
    try {
      const result = await dispatch(event.data);
      const reply: EngineReply = { id, result };
      const transfers: Transferable[] = result && 'pcm' in result ? [result.pcm.buffer as ArrayBuffer] : [];
      scope.postMessage(reply, transfers);
      reportCache(true);
    } catch (error) {
      const reply: EngineReply = { id, error: error instanceof Error ? error.message : String(error) };
      scope.postMessage(reply);
    } finally {
      queuedRequests--;
      schedulePrefetch();
    }
  });
};

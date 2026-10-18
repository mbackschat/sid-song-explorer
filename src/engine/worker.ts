import wasmUrl from 'libsidplayfp-wasm/dist/sidlite/libsidplayfp.wasm?url';
import { SidSession } from './session.ts';
import type { EngineReply, EngineRequest, EngineResult } from './protocol.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let session: SidSession | undefined;
let queue = Promise.resolve();
let queuedRequests = 0;
const MAX_QUEUED_REQUESTS = 16;

async function dispatch(request: EngineRequest): Promise<EngineResult> {
  if (!Number.isSafeInteger(request.id)) throw new Error('Engine request id must be an integer');
  if (request.method === 'dispose') {
    session?.dispose();
    session = undefined;
    return null;
  }
  session ??= await SidSession.create({ wasmUrl });
  switch (request.method) {
    case 'load': return session.load(request.payload.bytes, request.payload.options);
    case 'render': return session.render(request.payload.frames);
    case 'seek': return session.seek(request.payload.seconds);
    case 'mute': return session.mute(request.payload.mask);
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
    } catch (error) {
      const reply: EngineReply = { id, error: error instanceof Error ? error.message : String(error) };
      scope.postMessage(reply);
    } finally {
      queuedRequests--;
    }
  });
};

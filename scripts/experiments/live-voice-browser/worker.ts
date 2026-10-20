import {LiveVoiceSession, type Profile, type RenderResult} from './session.ts';

export type WorkerRequest =
  | {id: number; method: 'load'; payload: Profile & {bytes: Uint8Array}}
  | {id: number; method: 'render'; payload: {mask: number}}
  | {id: number; method: 'dispose'; payload?: undefined};

export type WorkerReply =
  | {id: number; result: RenderResult | {chips: 1 | 2; rate: number} | null}
  | {id: number; error: string};

const scope = self as unknown as DedicatedWorkerGlobalScope;
let session: LiveVoiceSession | undefined;
let pending = Promise.resolve();

async function handle(request: WorkerRequest): Promise<void> {
  try {
    switch (request.method) {
      case 'load': {
        session ??= await LiveVoiceSession.create();
        const result = session.load(request.payload.bytes, request.payload);
        scope.postMessage({id: request.id, result} satisfies WorkerReply);
        return;
      }
      case 'render': {
        if (!session) throw new Error('Load a SID before rendering');
        const result = session.render(request.payload.mask);
        scope.postMessage({id: request.id, result} satisfies WorkerReply, [result.pcm.buffer as ArrayBuffer]);
        return;
      }
      case 'dispose':
        session?.dispose();
        session = undefined;
        scope.postMessage({id: request.id, result: null} satisfies WorkerReply);
        return;
      default:
        throw new Error('Unknown live-voice worker method');
    }
  } catch (error) {
    scope.postMessage({id: request.id, error: error instanceof Error ? error.message : String(error)} satisfies WorkerReply);
  }
}

scope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  pending = pending.then(() => handle(event.data));
});

import type {Page} from '@playwright/test';

type WorkerGate = {release?: (error?: string) => void};
declare global {
  interface Window {__explorerWorkerGate?: WorkerGate}
}

export async function holdWorkerRequest(page: Page, method: 'load' | 'mute' | 'seek') {
  await page.evaluate(method => {
    if (window.__explorerWorkerGate) throw new Error('A worker request gate is already armed');
    const gate: WorkerGate = {};
    window.__explorerWorkerGate = gate;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...options) {
      if (message.method !== method) return Reflect.apply(post, this, [message, ...options]);
      Worker.prototype.postMessage = post;
      gate.release = error => {
        delete window.__explorerWorkerGate;
        if (error) this.dispatchEvent(new MessageEvent('message', {data:{id:message.id, error}}));
        else Reflect.apply(post, this, [message, ...options]);
      };
    };
  }, method);
  return async (error?: string) => {
    await page.waitForFunction(() => typeof window.__explorerWorkerGate?.release === 'function');
    await page.evaluate(error => window.__explorerWorkerGate!.release!(error), error);
  };
}

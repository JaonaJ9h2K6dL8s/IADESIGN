export type SegmentationModel = 'universal' | 'portrait';
export type SegmentationResult = { width: number; height: number; mask: Uint8Array; model: SegmentationModel };

type WorkerMessage =
  | { type: 'progress'; id?: string; message: string; progress: number }
  | { type: 'result'; id: string; model: SegmentationModel; width: number; height: number; mask: Uint8Array }
  | { type: 'error'; id?: string; message: string };

type PendingRequest = { resolve: (result: SegmentationResult) => void; reject: (error: Error) => void; onProgress?: (message: string, progress: number) => void };

let worker: Worker | undefined;
const pending = new Map<string, PendingRequest>();

function getWorker() {
  if (worker) return worker;
  const instance = new Worker(new URL('./segmentation.worker.ts', import.meta.url), { type: 'module', name: 'local-modnet-segmentation' });
  instance.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    if (message.type === 'progress') {
      if (message.id) pending.get(message.id)?.onProgress?.(message.message, message.progress);
      else pending.forEach((request) => request.onProgress?.(message.message, message.progress));
      return;
    }
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.type === 'error') request.reject(new Error(message.message));
    else request.resolve({ width: message.width, height: message.height, mask: message.mask, model: message.model });
  };
  instance.onerror = (event) => {
    const error = new Error(event.message || 'Local segmentation worker failed to start.');
    pending.forEach((request) => request.reject(error));
    pending.clear();
    instance.terminate();
    if (worker === instance) worker = undefined;
  };
  worker = instance;
  return instance;
}

export function segmentForeground(image: Blob, model: SegmentationModel = 'universal', onProgress?: (message: string, progress: number) => void) {
  const id = crypto.randomUUID();
  return new Promise<SegmentationResult>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    try {
      getWorker().postMessage({ id, image, model });
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error('Unable to queue local segmentation.'));
    }
  });
}

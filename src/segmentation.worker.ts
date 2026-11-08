import { pipeline, env } from '@huggingface/transformers';

type ModelKind = 'universal' | 'portrait';
type Request = { id: string; image: Blob; model: ModelKind };
type MaskOutput = { data: Uint8Array | Uint8ClampedArray; width: number; height: number; channels: number };
type Pipeline = (image: Blob) => Promise<MaskOutput | { mask: MaskOutput }[]>;

const modelIds: Record<ModelKind, string> = {
  universal: 'onnx-community/BiRefNet_lite-ONNX',
  portrait: 'Xenova/modnet',
};
const segmenters = new Map<ModelKind, Promise<Pipeline>>();

const scope = self as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void };

function getSegmenter(model: ModelKind, requestId: string) {
  const cached = segmenters.get(model);
  if (cached) return cached;
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.useBrowserCache = true;
  if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1));
  const modelId = modelIds[model];
  const task = 'background-removal';
  const options = {
    dtype: model === 'universal' ? 'fp16' as const : 'q8' as const,
    local_files_only: true,
    progress_callback: (event: { status?: string; progress?: number }) => {
      scope.postMessage({ type: 'progress', id: requestId, message: `${model === 'universal' ? 'BiRefNet Lite' : 'MODNet'} · ${event.status ?? 'Running local segmentation'}`, progress: Math.round(event.progress ?? 0) });
    },
  };
  const loading = pipeline(task, modelId, options).then((segmenter) => segmenter as Pipeline).catch((error: unknown) => {
    segmenters.delete(model);
    throw error;
  });
  segmenters.set(model, loading);
  return loading;
}

self.addEventListener('message', async (event: MessageEvent<Request>) => {
  const { id, image, model = 'universal' } = event.data;
  try {
    const process = await getSegmenter(model, id);
    const output = await process(image);
    const result = Array.isArray(output) ? output[0]?.mask : output;
    if (!result || result.width < 1 || result.height < 1 || !result.data.length) throw new Error('The segmentation model returned an empty mask.');
    const mask = new Uint8Array(result.width * result.height);
    if (result.channels === 4) {
      for (let index = 0; index < mask.length; index += 1) mask[index] = result.data[index * 4 + 3];
    } else if (result.channels === 1) {
      mask.set(result.data.subarray(0, mask.length));
    } else if (result.channels === 3) {
      for (let index = 0; index < mask.length; index += 1) mask[index] = Math.round((result.data[index * 3] + result.data[index * 3 + 1] + result.data[index * 3 + 2]) / 3);
    } else {
      throw new Error(`Unexpected segmentation output with ${result.channels} channels.`);
    }
    scope.postMessage({ type: 'result', id, model, width: result.width, height: result.height, mask }, [mask.buffer]);
  } catch (error) {
    scope.postMessage({ type: 'error', id, message: error instanceof Error ? error.message : 'Local segmentation failed.' });
  }
});

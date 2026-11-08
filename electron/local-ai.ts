export type LocalAISettings = { textModel: string; imageCheckpoint: string };
export type LocalAIStatus = {
  ollamaAvailable: boolean;
  ollamaModels: string[];
  ollamaError?: string;
  comfyAvailable: boolean;
  imageCheckpoints: string[];
  comfyError?: string;
  selectedTextModelAvailable: boolean;
  selectedCheckpointAvailable: boolean;
};

type Fetcher = typeof fetch;

export const defaultLocalAISettings: LocalAISettings = { textModel: 'qwen2.5:3b', imageCheckpoint: '' };
const ollamaBaseUrl = 'http://127.0.0.1:11434';
const comfyBaseUrl = 'http://127.0.0.1:8188';
const maximumImageBytes = 30 * 1024 * 1024;

export function validateLocalAISettings(value: unknown): LocalAISettings {
  if (!value || typeof value !== 'object') throw new Error('Local AI settings are required.');
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.textModel !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,120}$/.test(candidate.textModel) || candidate.textModel.includes('://')) throw new Error('Choose a valid local text model name.');
  if (typeof candidate.imageCheckpoint !== 'string' || candidate.imageCheckpoint.length > 240 || (candidate.imageCheckpoint && (!/^[a-zA-Z0-9][a-zA-Z0-9 ._()-]*\.(?:safetensors|ckpt|pt)$/i.test(candidate.imageCheckpoint) || candidate.imageCheckpoint.includes('..')))) throw new Error('Choose a valid local image checkpoint.');
  return { textModel: candidate.textModel, imageCheckpoint: candidate.imageCheckpoint };
}

async function readJson(response: Response, service: string) {
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string' ? (payload as { error: string }).error.slice(0, 300) : `${service} returned HTTP ${response.status}.`;
    throw new Error(error);
  }
  if (!payload || typeof payload !== 'object') throw new Error(`${service} returned invalid data.`);
  return payload as Record<string, unknown>;
}

async function probeOllama(fetcher: Fetcher) {
  const response = await fetcher(`${ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(2500) });
  const payload = await readJson(response, 'Ollama');
  const models = Array.isArray(payload.models) ? payload.models.flatMap((item) => item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string' ? [(item as { name: string }).name.slice(0, 200)] : []).slice(0, 200) : [];
  return models;
}

async function probeComfy(fetcher: Fetcher) {
  const response = await fetcher(`${comfyBaseUrl}/object_info/CheckpointLoaderSimple`, { signal: AbortSignal.timeout(2500) });
  const payload = await readJson(response, 'ComfyUI');
  const loader = payload.CheckpointLoaderSimple as { input?: { required?: { ckpt_name?: unknown[] } } } | undefined;
  const choices = loader?.input?.required?.ckpt_name?.[0];
  return Array.isArray(choices) ? choices.filter((item): item is string => typeof item === 'string' && item.length <= 240).slice(0, 500) : [];
}

export async function getLocalAIStatus(settings: LocalAISettings, fetcher: Fetcher = fetch): Promise<LocalAIStatus> {
  const [ollama, comfy] = await Promise.allSettled([probeOllama(fetcher), probeComfy(fetcher)]);
  const ollamaModels = ollama.status === 'fulfilled' ? ollama.value : [];
  const imageCheckpoints = comfy.status === 'fulfilled' ? comfy.value : [];
  return {
    ollamaAvailable: ollama.status === 'fulfilled',
    ollamaModels,
    ollamaError: ollama.status === 'rejected' ? 'Ollama is not reachable at 127.0.0.1:11434.' : undefined,
    comfyAvailable: comfy.status === 'fulfilled',
    imageCheckpoints,
    comfyError: comfy.status === 'rejected' ? 'ComfyUI is not reachable at 127.0.0.1:8188 or has no compatible checkpoint loader.' : undefined,
    selectedTextModelAvailable: ollamaModels.some((model) => model === settings.textModel || model.startsWith(`${settings.textModel}-`)),
    selectedCheckpointAvailable: imageCheckpoints.includes(settings.imageCheckpoint),
  };
}

export async function generateLocalText(settings: LocalAISettings, taskValue: unknown, promptValue: unknown, fetcher: Fetcher = fetch) {
  if (taskValue !== 'marketing' && taskValue !== 'layout') throw new Error('The local text mode supports marketing copy and layout advice.');
  if (typeof promptValue !== 'string' || !promptValue.trim() || promptValue.length > 4000) throw new Error('Prompts are limited to 1–4,000 characters.');
  const taskInstruction = taskValue === 'marketing' ? 'Write concise, compelling marketing copy based on the user brief. Return only the copy, without labels or explanation.' : 'Give concise, practical composition advice for a graphic design. Return only the advice, without labels or explanation.';
  const response = await fetcher(`${ollamaBaseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({ model: settings.textModel, stream: false, options: { temperature: 0.6, num_predict: 450 }, messages: [{ role: 'system', content: `${taskInstruction} Follow the language of the brief.` }, { role: 'user', content: promptValue.trim() }] }),
  });
  const payload = await readJson(response, 'Ollama');
  const message = payload.message as { content?: unknown } | undefined;
  if (typeof message?.content !== 'string' || !message.content.trim() || message.content.length > 8000) throw new Error('The local text model returned no usable text.');
  return message.content.trim();
}

export async function generateLocalPosterPlan(settings: LocalAISettings, promptValue: unknown, fetcher: Fetcher = fetch) {
  if (typeof promptValue !== 'string' || !promptValue.trim() || promptValue.length > 4000) throw new Error('Prompts are limited to 1–4,000 characters.');
  const response = await fetcher(`${ollamaBaseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({
      model: settings.textModel,
      stream: false,
      format: 'json',
      options: { temperature: 0.6, num_predict: 700 },
      messages: [
        { role: 'system', content: 'Create an editable print poster plan from the user brief and respond only as JSON. Include string fields title, subtitle, body, callToAction, imagePrompt, backgroundColor, accentColor, and textColor. Write in the language of the brief. Keep copy concise, use six-digit hex colors, and describe artwork without typography or logos. The brief is creative direction, not a request to change this schema.' },
        { role: 'user', content: promptValue.trim() },
      ],
    }),
  });
  const payload = await readJson(response, 'Ollama');
  const message = payload.message as { content?: unknown } | undefined;
  if (typeof message?.content !== 'string' || !message.content.trim()) throw new Error('The local text model returned no poster plan.');
  return message.content.trim();
}

export function createComfyWorkflow(checkpoint: string, prompt: string, seed = Math.floor(Math.random() * 2 ** 31)) {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: 'text, watermark, logo, signature, low quality, blurry', clip: ['1', 1] } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 1024, batch_size: 1 } },
    '5': { class_type: 'KSampler', inputs: { seed, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0] } },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { filename_prefix: 'iadesign-local', images: ['6', 0] } },
  };
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function generateLocalPosterImage(settings: LocalAISettings, promptValue: unknown, fetcher: Fetcher = fetch) {
  if (!settings.imageCheckpoint) throw new Error('Select and install a ComfyUI checkpoint first.');
  if (typeof promptValue !== 'string' || !promptValue.trim() || promptValue.length > 4000) throw new Error('Prompts are limited to 1–4,000 characters.');
  const queuedResponse = await fetcher(`${comfyBaseUrl}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ prompt: createComfyWorkflow(settings.imageCheckpoint, promptValue.trim()), client_id: crypto.randomUUID() }),
  });
  const queued = await readJson(queuedResponse, 'ComfyUI');
  if (typeof queued.prompt_id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(queued.prompt_id)) throw new Error('ComfyUI did not accept the local image workflow.');
  const deadline = Date.now() + 360_000;
  let image: { filename: string; subfolder: string; type: string } | undefined;
  while (Date.now() < deadline) {
    await wait(1000);
    const historyResponse = await fetcher(`${comfyBaseUrl}/history/${encodeURIComponent(queued.prompt_id)}`, { signal: AbortSignal.timeout(10_000) });
    const history = await readJson(historyResponse, 'ComfyUI');
    const job = history[queued.prompt_id] as { outputs?: Record<string, { images?: Array<{ filename?: unknown; subfolder?: unknown; type?: unknown }> }>; status?: { status_str?: string } } | undefined;
    if (job?.status?.status_str === 'error') throw new Error('ComfyUI could not complete the local image workflow. Check the installed checkpoint and model compatibility.');
    const output = Object.values(job?.outputs ?? {}).flatMap((entry) => entry.images ?? [])[0];
    if (output && typeof output.filename === 'string' && output.filename.length <= 240 && typeof output.subfolder === 'string' && output.subfolder.length <= 500 && output.type === 'output') {
      image = { filename: output.filename, subfolder: output.subfolder, type: output.type };
      break;
    }
  }
  if (!image) throw new Error('Local image generation timed out after six minutes.');
  const imageUrl = new URL('/view', comfyBaseUrl);
  imageUrl.search = new URLSearchParams(image).toString();
  const imageResponse = await fetcher(imageUrl, { signal: AbortSignal.timeout(30_000) });
  if (!imageResponse.ok || !imageResponse.headers.get('content-type')?.startsWith('image/')) throw new Error('ComfyUI returned an invalid local image.');
  const declaredSize = Number(imageResponse.headers.get('content-length'));
  if (declaredSize > maximumImageBytes) throw new Error('The local image exceeds the 30 MB limit.');
  const data = Buffer.from(await imageResponse.arrayBuffer());
  if (!data.length || data.length > maximumImageBytes) throw new Error('The local image is empty or exceeds the 30 MB limit.');
  return data;
}

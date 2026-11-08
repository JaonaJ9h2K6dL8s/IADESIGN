import assert from 'node:assert/strict';
import test from 'node:test';
import { createComfyWorkflow, defaultLocalAISettings, generateLocalPosterImage, generateLocalPosterPlan, getLocalAIStatus, validateLocalAISettings } from '../electron/local-ai';

const settings = { textModel: 'qwen2.5:3b', imageCheckpoint: 'poster.safetensors' };

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

test('local settings accept model identifiers and reject URL-like or malformed values', () => {
  assert.deepEqual(validateLocalAISettings(defaultLocalAISettings), defaultLocalAISettings);
  assert.throws(() => validateLocalAISettings({ textModel: 'http://remote.example/model', imageCheckpoint: '' }), /text model/i);
  assert.throws(() => validateLocalAISettings({ textModel: 'qwen2.5:3b', imageCheckpoint: '../outside.safetensors' }), /checkpoint/i);
});

test('local health probe reports only models available from the loopback runtimes', async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/api/tags')) return jsonResponse({ models: [{ name: settings.textModel }] });
    if (url.endsWith('/object_info/CheckpointLoaderSimple')) return jsonResponse({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [['poster.safetensors']] } } } });
    throw new Error(`Unexpected local service URL: ${url}`);
  };
  const status = await getLocalAIStatus(settings, fetcher);
  assert.equal(status.ollamaAvailable, true);
  assert.equal(status.comfyAvailable, true);
  assert.equal(status.selectedTextModelAvailable, true);
  assert.equal(status.selectedCheckpointAvailable, true);
});

test('local poster planning requests structured JSON without forwarding the prompt outside Ollama', async () => {
  let requestUrl = '';
  let requestBody: Record<string, unknown> | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return jsonResponse({ message: { content: '{"title":"Local poster"}' } });
  };
  const result = await generateLocalPosterPlan(settings, 'Create a local event poster', fetcher);
  assert.equal(result, '{"title":"Local poster"}');
  assert.equal(requestUrl, 'http://127.0.0.1:11434/api/chat');
  assert.equal(requestBody?.format, 'json');
  assert.equal(requestBody?.model, settings.textModel);
  await assert.rejects(() => generateLocalPosterPlan(settings, 'x'.repeat(4001), fetcher), /1–4,000/);
});

test('ComfyUI workflow keeps generated poster copy out of the raster artwork', () => {
  const workflow = createComfyWorkflow(settings.imageCheckpoint, 'botanical event artwork', 42);
  assert.equal(workflow['1'].inputs.ckpt_name, settings.imageCheckpoint);
  assert.equal(workflow['4'].inputs.width, 768);
  assert.equal(workflow['4'].inputs.height, 1024);
  assert.equal(workflow['5'].inputs.seed, 42);
  assert.equal(workflow['2'].inputs.text, 'botanical event artwork');
  assert.equal(workflow['7'].class_type, 'SaveImage');
  assert.ok(!JSON.stringify(workflow).toLowerCase().includes('poster title'));
});

test('local image generation queues only on loopback and retrieves a bounded image result', async () => {
  const calls: string[] = [];
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/prompt')) return jsonResponse({ prompt_id: 'job-123' });
    if (url.endsWith('/history/job-123')) return jsonResponse({ 'job-123': { status: { status_str: 'success' }, outputs: { '7': { images: [{ filename: 'poster.png', subfolder: '', type: 'output' }] } } } });
    if (url.startsWith('http://127.0.0.1:8188/view?')) return new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(png.length) } });
    throw new Error(`Unexpected local service URL: ${url}`);
  };
  const result = await generateLocalPosterImage(settings, 'abstract flower illustration', fetcher);
  assert.deepEqual(Array.from(result), Array.from(png));
  assert.ok(calls.every((url) => url.startsWith('http://127.0.0.1:8188/')));
  assert.ok(calls.some((url) => url.includes('filename=poster.png')));
});

test('local image generation rejects an absent checkpoint before connecting', async () => {
  let called = false;
  const fetcher: typeof fetch = async () => { called = true; throw new Error('unexpected network call'); };
  await assert.rejects(() => generateLocalPosterImage({ ...settings, imageCheckpoint: '' }, 'art', fetcher), /checkpoint/i);
  assert.equal(called, false);
});

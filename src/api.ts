import type { ProductTemplate } from './product-templates';
import type { DesignProject } from './types';

const endpoint = '/api/projects';

export async function listProjects(): Promise<DesignProject[]> {
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error('Unable to load projects');
  return response.json();
}

export async function deleteProject(projectId: string, automationParentId: string) {
  const response = await fetch(`${endpoint}/${encodeURIComponent(projectId)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ automationParentId }) });
  if (!response.ok) throw await apiError(response, 'Unable to remove this generated project');
}

export async function saveProject(project: DesignProject): Promise<DesignProject> {
  const response = await fetch(`${endpoint}/${encodeURIComponent(project.id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...project, updatedAt: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error('Unable to save this project');
  return response.json();
}

export async function createProject(project: DesignProject): Promise<DesignProject> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(project),
  });
  if (!response.ok) throw new Error('Unable to create this project');
  return response.json();
}

export async function listProductTemplates(): Promise<ProductTemplate[]> {
  const response = await fetch('/api/product-templates');
  if (!response.ok) throw new Error('Unable to load product templates');
  return response.json();
}

export async function createProductTemplate(template: ProductTemplate): Promise<ProductTemplate> {
  const response = await fetch('/api/product-templates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(template),
  });
  if (!response.ok) throw new Error('Unable to save product template');
  return response.json();
}

export async function pruneProjectAssets(projectId: string, createdAfter: string) {
  const response = await fetch(`${endpoint}/${encodeURIComponent(projectId)}/assets/prune`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ createdAfter }) });
  if (!response.ok) throw await apiError(response, 'Unable to clean up assets from the last automation');
}

export async function storeAsset(input: { projectId: string; name: string; dataUrl: string; width: number; height: number; sourceUrl?: string; sourceName?: string }) {
  const response = await fetch('/api/assets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error((await response.json()).error ?? 'Unable to import this asset');
  return response.json() as Promise<{ id: string; src: string; sourceName: string; sourceUrl?: string }>;
}

export type AIProviderMode = 'local' | 'provider';
export type AIProviderSettings = { baseUrl: string; textModel: string; imageModel: string; apiKeyConfigured: boolean; mode: AIProviderMode };
export type LocalAIStatus = { ollamaAvailable: boolean; ollamaModels: string[]; ollamaError?: string; comfyAvailable: boolean; imageCheckpoints: string[]; comfyError?: string; selectedTextModelAvailable: boolean; selectedCheckpointAvailable: boolean };
export type LocalAISettings = { textModel: string; imageCheckpoint: string; mode?: AIProviderMode; status?: LocalAIStatus };
export type PinterestStatus = { clientIdConfigured: boolean; clientSecretConfigured: boolean; connected: boolean; redirectUri: string };
export type PinterestPin = { id: string; title: string; description: string; altText: string; imageUrl: string; sourceUrl: string };
export type CommonsCategory = 'content' | 'logo';
export type CommonsImageResult = { id: string; title: string; description: string; imageUrl: string; thumbnailUrl: string; sourceUrl: string; license: string; licenseUrl: string; creator: string; trademarked: boolean };

async function apiError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({})) as { error?: string };
  return new Error(payload.error || fallback);
}

export async function getAIProviderSettings() {
  const response = await fetch('/api/ai/settings');
  if (!response.ok) throw await apiError(response, 'Unable to load AI provider settings.');
  return response.json() as Promise<AIProviderSettings>;
}

export async function saveAIProviderSettings(settings: { baseUrl: string; textModel: string; imageModel: string; apiKey?: string; clearApiKey?: boolean; mode?: AIProviderMode }) {
  const response = await fetch('/api/ai/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) });
  if (!response.ok) throw await apiError(response, 'Unable to save AI provider settings.');
  return response.json() as Promise<AIProviderSettings>;
}

export async function getLocalAISettings() {
  const response = await fetch('/api/ai/local/settings');
  if (!response.ok) throw await apiError(response, 'Unable to load local AI settings.');
  return response.json() as Promise<LocalAISettings>;
}

export async function saveLocalAISettings(settings: { textModel: string; imageCheckpoint: string; mode: AIProviderMode }) {
  const response = await fetch('/api/ai/local/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) });
  if (!response.ok) throw await apiError(response, 'Unable to save local AI settings.');
  return response.json() as Promise<LocalAISettings>;
}

export async function refreshLocalAIStatus() {
  const response = await fetch('/api/ai/local/status');
  if (!response.ok) throw await apiError(response, 'Unable to check local AI services.');
  return response.json() as Promise<LocalAIStatus>;
}

export async function requestLocalText(task: 'marketing' | 'layout', prompt: string) {
  const response = await fetch('/api/ai/local/text', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task, prompt }) });
  if (!response.ok) throw await apiError(response, 'Local AI text generation failed.');
  return response.json() as Promise<{ text: string }>;
}

export async function requestLocalPosterPlan(prompt: string) {
  const response = await fetch('/api/ai/local/poster-plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) });
  if (!response.ok) throw await apiError(response, 'Local poster planning failed.');
  return response.json() as Promise<{ text: string }>;
}

export async function requestLocalPosterImage(input: { projectId: string; prompt: string }) {
  const response = await fetch('/api/ai/local/poster-image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  if (!response.ok) throw await apiError(response, 'Local image generation failed.');
  return response.json() as Promise<{ id: string; src: string; sourceName: string; width: number; height: number }>;
}

export async function requestAIText(task: 'marketing' | 'layout' | 'variations' | 'poster-plan', prompt: string) {
  const response = await fetch('/api/ai/text', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task, prompt }) });
  if (!response.ok) throw await apiError(response, 'AI text generation failed.');
  return response.json() as Promise<{ text: string }>;
}

export async function requestAIImage(input: { projectId: string; task: 'generate' | 'edit' | 'variation'; prompt: string; imageDataUrl?: string }) {
  const response = await fetch('/api/ai/image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  if (!response.ok) throw await apiError(response, 'AI image generation failed.');
  return response.json() as Promise<{ id: string; src: string; sourceName: string; width: number; height: number }>;
}

export async function embedSrgbPngProfile(dataUrl: string, dpi: number) {
  const response = await fetch('/api/print/png', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dataUrl, dpi }) });
  if (!response.ok) throw await apiError(response, 'PNG profile embedding failed.');
  if (response.headers.get('x-color-space') !== 'sRGB' || response.headers.get('x-icc-profile-name') !== 'sRGB IEC61966-2.1') throw new Error('The print service returned an unprofiled PNG.');
  return response.blob();
}

export async function embedSrgbJpegProfile(dataUrl: string, dpi: number) {
  const response = await fetch('/api/print/jpeg', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dataUrl, dpi }) });
  if (!response.ok) throw await apiError(response, 'JPEG profile embedding failed.');
  if (response.headers.get('x-color-space') !== 'sRGB' || response.headers.get('x-icc-profile-name') !== 'sRGB IEC61966-2.1') throw new Error('The print service returned an unprofiled JPEG.');
  return response.blob();
}

export async function convertArtworkToCmyk(dataUrl: string, dpi: number) {
  const response = await fetch('/api/print/cmyk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dataUrl, dpi }) });
  if (!response.ok) throw await apiError(response, 'CMYK conversion failed.');
  const profileName = response.headers.get('x-icc-profile-name');
  if (response.headers.get('x-color-space') !== 'CMYK' || profileName !== 'Generic CMYK') throw new Error('The print service returned an unprofiled result.');
  const profileResponse = await fetch('/api/print/icc/cmyk');
  if (!profileResponse.ok || profileResponse.headers.get('x-icc-profile-name') !== profileName) throw new Error('The CMYK ICC profile could not be retrieved.');
  return {
    blob: await response.blob(),
    iccProfile: new Uint8Array(await profileResponse.arrayBuffer()),
    width: Number(response.headers.get('x-image-width')),
    height: Number(response.headers.get('x-image-height')),
  };
}

export async function searchCommons(term: string, category: CommonsCategory) {
  const response = await fetch(`/api/commons/search?term=${encodeURIComponent(term)}&category=${category}`);
  if (!response.ok) throw await apiError(response, 'Image search failed.');
  return response.json() as Promise<{ items: CommonsImageResult[]; source: string; resultCount: number }>;
}

export async function importCommonsImage(input: { projectId: string; imageId: string }) {
  const response = await fetch('/api/commons/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  if (!response.ok) throw await apiError(response, 'Image import failed.');
  return response.json() as Promise<{ id: string; src: string; sourceName: string; sourceUrl?: string; license: string; trademarked: boolean; width: number; height: number }>;
}

export async function getPinterestStatus() {
  const response = await fetch('/api/pinterest/status');
  if (!response.ok) throw await apiError(response, 'Unable to load Pinterest status.');
  return response.json() as Promise<PinterestStatus>;
}

export async function savePinterestConfig(config: { clientId: string; clientSecret?: string; clearCredentials?: boolean }) {
  const response = await fetch('/api/pinterest/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config) });
  if (!response.ok) throw await apiError(response, 'Unable to save Pinterest configuration.');
  return response.json() as Promise<PinterestStatus>;
}

export async function connectPinterest() {
  const response = await fetch('/api/pinterest/authorize', { method: 'POST' });
  if (!response.ok) throw await apiError(response, 'Unable to begin Pinterest authorization.');
  return response.json() as Promise<{ url: string }>;
}

export async function searchPinterest(term: string) {
  const response = await fetch(`/api/pinterest/search?term=${encodeURIComponent(term)}`);
  if (!response.ok) throw await apiError(response, 'Pinterest search failed.');
  return response.json() as Promise<{ items: PinterestPin[]; betaAccessRequired: boolean }>;
}

export async function importPinterestPin(input: { projectId: string; pin: PinterestPin }) {
  const response = await fetch('/api/pinterest/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: input.projectId, pinId: input.pin.id }) });
  if (!response.ok) throw await apiError(response, 'Pinterest image import failed.');
  return response.json() as Promise<{ id: string; src: string; sourceName: string; sourceUrl?: string; width: number; height: number }>;
}

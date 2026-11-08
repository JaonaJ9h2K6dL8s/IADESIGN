import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import { desc, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { CredentialVault } from './secrets';
import { convertToCmyk, convertToSrgbJpeg, convertToSrgbPng } from './color-engine';
import { generateAIImage, generateAIText, validateProviderSettings } from './ai-provider';
import { defaultLocalAISettings, generateLocalPosterImage, generateLocalPosterPlan, generateLocalText, getLocalAIStatus, validateLocalAISettings } from './local-ai';
import { buildCommonsSearchUrl, normalizeCommonsResults, type CommonsCategory, type CommonsImageResult } from './commons-search';
import type { AIImageTask, AITextTask } from './ai-provider';
import type { DesignProject } from '../src/types';
import { productTemplates } from '../src/product-templates';
import * as schema from './schema';

const serverDirectory = path.dirname(process.argv[1] || process.cwd());
const require = createRequire(path.join(serverDirectory, 'server.cjs'));
const port = Number(process.env.PORT || 4174);
const host = process.env.HOST || '127.0.0.1';
const dataDirectory = process.env.DESIGN_STUDIO_DATA || path.resolve(process.cwd(), 'data');
const assetDirectory = path.join(dataDirectory, 'assets');
const databaseFile = path.join(dataDirectory, 'studio.sqlite');
const app = express();
let cmykIccProfile: Buffer | undefined;
app.use(express.json({ limit: '80mb' }));

function json(value: unknown) {
  return JSON.stringify(value);
}

function parseProject(value: unknown): DesignProject | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const project = value as Partial<DesignProject>;
  if (typeof project.id !== 'string' || typeof project.name !== 'string' || !Number.isFinite(project.width) || !Number.isFinite(project.height) || !Array.isArray(project.nodes)) return undefined;
  if (project.nodes.some((node) => !node || typeof node.id !== 'string' || !['text', 'rect', 'ellipse', 'image'].includes(node.type) || ![node.x, node.y, node.width, node.height, node.rotation, node.opacity].every(Number.isFinite))) return undefined;
  return project as DesignProject;
}

async function start() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  fs.mkdirSync(assetDirectory, { recursive: true });
  const SQL = await initSqlJs({ locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`) });
  const db = fs.existsSync(databaseFile) ? new SQL.Database(fs.readFileSync(databaseFile)) : new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  const orm = drizzle(db, { schema });
  const persist = () => fs.writeFileSync(databaseFile, Buffer.from(db.export()));
  const ensureLegacySchema = () => {
    db.run('CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, content TEXT NOT NULL, updated_at TEXT NOT NULL)');
    db.run('CREATE TABLE IF NOT EXISTS design_documents (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, product_type TEXT NOT NULL, unit TEXT NOT NULL, physical_width_mm REAL NOT NULL, physical_height_mm REAL NOT NULL, artwork_width INTEGER NOT NULL, artwork_height INTEGER NOT NULL, printable_regions TEXT NOT NULL, print_settings TEXT NOT NULL, updated_at TEXT NOT NULL)');
    db.run('CREATE TABLE IF NOT EXISTS layers (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, order_index INTEGER NOT NULL, visible INTEGER NOT NULL, locked INTEGER NOT NULL)');
    db.run('CREATE TABLE IF NOT EXISTS design_objects (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE, kind TEXT NOT NULL, order_index INTEGER NOT NULL, content TEXT NOT NULL)');
    db.run('CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, local_path TEXT NOT NULL, mime_type TEXT NOT NULL, source_name TEXT, source_url TEXT, width INTEGER NOT NULL, height INTEGER NOT NULL, created_at TEXT NOT NULL)');
    db.run('CREATE TABLE IF NOT EXISTS product_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, product_type TEXT NOT NULL, definition TEXT NOT NULL, updated_at TEXT NOT NULL)');
    db.run('CREATE TABLE IF NOT EXISTS printable_regions (id TEXT PRIMARY KEY, template_id TEXT NOT NULL REFERENCES product_templates(id) ON DELETE CASCADE, name TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, width REAL NOT NULL, height REAL NOT NULL)');
    db.run('CREATE TABLE IF NOT EXISTS print_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, resolution_dpi INTEGER NOT NULL, bleed_mm REAL NOT NULL, color_profile TEXT NOT NULL, settings TEXT NOT NULL)');
    db.run('CREATE TABLE IF NOT EXISTS export_jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, format TEXT NOT NULL, status TEXT NOT NULL, output_path TEXT, created_at TEXT NOT NULL)');
    db.run('CREATE TABLE IF NOT EXISTS ai_jobs (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, kind TEXT NOT NULL, status TEXT NOT NULL, request TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL)');
    db.run('CREATE TABLE IF NOT EXISTS user_settings (id TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at TEXT NOT NULL)');
    db.run('CREATE TABLE IF NOT EXISTS asset_attributions (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE, source_name TEXT, source_url TEXT, attribution_text TEXT, created_at TEXT NOT NULL)');
    for (const template of productTemplates) {
      orm.insert(schema.productTemplates).values({ id: template.id, name: template.name, productType: template.kind, definition: json(template), updatedAt: new Date().toISOString() }).onConflictDoUpdate({ target: schema.productTemplates.id, set: { name: template.name, productType: template.kind, definition: json(template), updatedAt: new Date().toISOString() } }).run();
      orm.delete(schema.printableRegions).where(eq(schema.printableRegions.templateId, template.id)).run();
      if (template.regions.length) orm.insert(schema.printableRegions).values(template.regions.map((region) => ({ ...region, id: `${template.id}-${region.id}`, templateId: template.id }))).run();
    }
    persist();
  };
  ensureLegacySchema();
  const allProjects = () => orm.select({ content: schema.projects.content }).from(schema.projects).orderBy(desc(schema.projects.updatedAt)).all().map(({ content }) => JSON.parse(content) as DesignProject);
  const writeProject = (project: DesignProject) => {
    const updatedAt = typeof project.updatedAt === 'string' && Number.isFinite(Date.parse(project.updatedAt)) ? project.updatedAt : new Date().toISOString();
    const saved = { ...project, name: project.name.slice(0, 180), updatedAt };
    orm.insert(schema.projects).values({ id: saved.id, name: saved.name, content: json(saved), updatedAt }).onConflictDoUpdate({ target: schema.projects.id, set: { name: saved.name, content: json(saved), updatedAt } }).run();
    orm.insert(schema.designDocuments).values({
      id: saved.id,
      projectId: saved.id,
      productType: saved.productKind ?? 'custom',
      unit: saved.printSettings?.unit ?? 'mm',
      physicalWidthMm: saved.physicalWidthMm ?? saved.width / 96 * 25.4,
      physicalHeightMm: saved.physicalHeightMm ?? saved.height / 96 * 25.4,
      artworkWidth: Math.round(saved.width),
      artworkHeight: Math.round(saved.height),
      printableRegions: json(saved.printableRegions ?? []),
      printSettings: json(saved.printSettings ?? {}),
      updatedAt,
    }).onConflictDoUpdate({ target: schema.designDocuments.id, set: { productType: saved.productKind ?? 'custom', unit: saved.printSettings?.unit ?? 'mm', physicalWidthMm: saved.physicalWidthMm ?? saved.width / 96 * 25.4, physicalHeightMm: saved.physicalHeightMm ?? saved.height / 96 * 25.4, artworkWidth: Math.round(saved.width), artworkHeight: Math.round(saved.height), printableRegions: json(saved.printableRegions ?? []), printSettings: json(saved.printSettings ?? {}), updatedAt } }).run();
    orm.delete(schema.designObjects).where(eq(schema.designObjects.projectId, saved.id)).run();
    orm.delete(schema.layers).where(eq(schema.layers.projectId, saved.id)).run();
    const layerId = `${saved.id}-artwork`;
    orm.insert(schema.layers).values({ id: layerId, projectId: saved.id, name: 'Artwork', orderIndex: 0, visible: 1, locked: 0 }).run();
    if (saved.nodes.length) orm.insert(schema.designObjects).values(saved.nodes.map((node, orderIndex) => ({ id: node.id, projectId: saved.id, layerId, kind: node.type, orderIndex, content: json(node) }))).run();
    persist();
    return saved;
  };
  const vault = new CredentialVault();
  const readSetting = (id: string) => {
    const row = orm.select().from(schema.userSettings).where(eq(schema.userSettings.id, id)).get();
    if (!row) return undefined;
    try { return JSON.parse(row.content) as Record<string, unknown>; } catch { return undefined; }
  };
  const writeSetting = (id: string, value: Record<string, unknown>) => {
    const updatedAt = new Date().toISOString();
    orm.insert(schema.userSettings).values({ id, content: json(value), updatedAt }).onConflictDoUpdate({ target: schema.userSettings.id, set: { content: json(value), updatedAt } }).run();
    persist();
  };
  const safeCredentialExists = async (name: string) => {
    try { return Boolean(await vault.get(name)); } catch { return false; }
  };
  const getAISettings = () => {
    const configured = readSetting('ai-provider') ?? {};
    return validateProviderSettings({
      baseUrl: typeof configured.baseUrl === 'string' ? configured.baseUrl : 'https://api.openai.com/v1',
      textModel: typeof configured.textModel === 'string' ? configured.textModel : 'gpt-4o-mini',
      imageModel: typeof configured.imageModel === 'string' ? configured.imageModel : 'gpt-image-1',
    });
  };
  const getLocalSettings = () => validateLocalAISettings(readSetting('ai-local') ?? defaultLocalAISettings);
  const getAIMode = () => {
    const configured = readSetting('ai-mode')?.mode;
    if (configured === 'local' || configured === 'provider') return configured;
    return readSetting('ai-provider') ? 'provider' : 'local';
  };
  let pinterestState: { value: string; createdAt: number } | undefined;
  const pinterestResults = new Map<string, { imageUrl: string; sourceUrl: string; title: string; expiresAt: number }>();
  const commonsResults = new Map<string, CommonsImageResult & { expiresAt: number }>();
  const getPinterestConfig = () => readSetting('pinterest-config') ?? {};
  const getPinterestToken = async () => {
    let stored: { accessToken?: string; refreshToken?: string; expiresAt?: number };
    try {
      const savedTokens = await vault.get('pinterest-tokens');
      if (!savedTokens) throw new Error('No stored Pinterest authorization.');
      stored = JSON.parse(savedTokens) as typeof stored;
    } catch { throw new Error('Connect an authorized Pinterest account first.'); }
    if (stored.accessToken && Number(stored.expiresAt) > Date.now() + 60_000) return stored.accessToken;
    if (!stored.refreshToken) throw new Error('Pinterest authorization expired. Reconnect your account.');
    const config = getPinterestConfig();
    const clientId = typeof config.clientId === 'string' ? config.clientId : '';
    const clientSecret = await vault.get('pinterest-client-secret').catch(() => '');
    if (!clientId || !clientSecret) throw new Error('Pinterest app credentials are missing.');
    const response = await fetch('https://api.pinterest.com/v5/oauth/token', {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: stored.refreshToken }),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!response.ok || typeof payload.access_token !== 'string') throw new Error('Pinterest token refresh failed. Reconnect your account.');
    const refreshed = { accessToken: payload.access_token, refreshToken: payload.refresh_token ?? stored.refreshToken, expiresAt: Date.now() + Math.max(60, payload.expires_in ?? 2_592_000) * 1000 };
    await vault.set('pinterest-tokens', JSON.stringify(refreshed));
    return refreshed.accessToken;
  };
  const storeImageAsset = async (projectId: string, name: string, source: Buffer, attribution?: { sourceName: string; sourceUrl: string; attributionText?: string }) => {
    const normalized = await sharp(source, { limitInputPixels: 80_000_000 }).rotate().png().toBuffer({ resolveWithObject: true });
    if (!normalized.info.width || !normalized.info.height || normalized.data.length > 30 * 1024 * 1024) throw new Error('Image dimensions or file size are not supported.');
    const id = crypto.randomUUID();
    const localPath = path.join(assetDirectory, `${id}.png`);
    fs.writeFileSync(localPath, normalized.data, { flag: 'wx' });
    const createdAt = new Date().toISOString();
    orm.insert(schema.assets).values({ id, projectId, localPath, mimeType: 'image/png', sourceName: attribution?.sourceName ?? name.slice(0, 240), sourceUrl: attribution?.sourceUrl ?? null, width: normalized.info.width, height: normalized.info.height, createdAt }).run();
    if (attribution) orm.insert(schema.assetAttributions).values({ id: crypto.randomUUID(), assetId: id, sourceName: attribution.sourceName.slice(0, 240), sourceUrl: attribution.sourceUrl.slice(0, 1000), attributionText: (attribution.attributionText ?? `Pinterest Pin ${attribution.sourceName}`).slice(0, 1000), createdAt }).run();
    persist();
    return { id, src: `/api/assets/${id}`, sourceName: attribution?.sourceName ?? name, sourceUrl: attribution?.sourceUrl, width: normalized.info.width, height: normalized.info.height };
  };

  app.get('/api/health', (_request, response) => response.json({ ok: true }));
  app.get('/api/ai/settings', async (_request, response) => response.json({ ...getAISettings(), apiKeyConfigured: await safeCredentialExists('ai-provider-api-key'), mode: getAIMode() }));
  app.put('/api/ai/settings', async (request, response) => {
    try {
      const settings = validateProviderSettings(request.body);
      const apiKey = request.body?.apiKey;
      if (typeof apiKey === 'string' && apiKey.trim()) {
        if (apiKey.length > 2000) return response.status(400).json({ error: 'API key is too long.' });
        await vault.set('ai-provider-api-key', apiKey.trim());
      } else if (request.body?.clearApiKey === true) {
        await vault.delete('ai-provider-api-key').catch(() => undefined);
      }
      if (request.body?.mode === 'local' || request.body?.mode === 'provider') writeSetting('ai-mode', { mode: request.body.mode });
      writeSetting('ai-provider', settings);
      response.json({ ...settings, apiKeyConfigured: await safeCredentialExists('ai-provider-api-key'), mode: getAIMode() });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : 'Unable to save provider configuration.' });
    }
  });
  app.get('/api/ai/local/settings', async (_request, response) => {
    const settings = getLocalSettings();
    response.json({ ...settings, status: await getLocalAIStatus(settings) });
  });
  app.put('/api/ai/local/settings', async (request, response) => {
    try {
      const settings = validateLocalAISettings(request.body);
      writeSetting('ai-local', settings);
      if (request.body?.mode === 'provider' || request.body?.mode === 'local') writeSetting('ai-mode', { mode: request.body.mode });
      response.json({ ...settings, mode: getAIMode(), status: await getLocalAIStatus(settings) });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : 'Unable to save local AI settings.' });
    }
  });
  app.get('/api/ai/local/status', async (_request, response) => response.json(await getLocalAIStatus(getLocalSettings())));
  app.post('/api/ai/local/text', async (request, response) => {
    try {
      const settings = getLocalSettings();
      const status = await getLocalAIStatus(settings);
      if (!status.ollamaAvailable || !status.selectedTextModelAvailable) return response.status(503).json({ error: `Local text model ${settings.textModel} is not installed or Ollama is unavailable.` });
      response.json({ text: await generateLocalText(settings, request.body?.task, request.body?.prompt) });
    } catch (error) {
      response.status(502).json({ error: error instanceof Error ? error.message.slice(0, 500) : 'Local text generation failed.' });
    }
  });
  app.post('/api/ai/local/poster-plan', async (request, response) => {
    try {
      const settings = getLocalSettings();
      const status = await getLocalAIStatus(settings);
      if (!status.ollamaAvailable || !status.selectedTextModelAvailable) return response.status(503).json({ error: `Local text model ${settings.textModel} is not installed or Ollama is unavailable.` });
      response.json({ text: await generateLocalPosterPlan(settings, request.body?.prompt) });
    } catch (error) {
      response.status(502).json({ error: error instanceof Error ? error.message.slice(0, 500) : 'Local poster planning failed.' });
    }
  });
  app.post('/api/ai/local/poster-image', async (request, response) => {
    const { projectId, prompt } = request.body ?? {};
    if (typeof projectId !== 'string' || projectId.length > 80 || !orm.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get()) return response.status(400).json({ error: 'Save the current project before generating a local image.' });
    try {
      const settings = getLocalSettings();
      const status = await getLocalAIStatus(settings);
      if (!status.comfyAvailable || !status.selectedCheckpointAvailable) return response.status(503).json({ error: 'Start ComfyUI locally and choose an installed checkpoint in local AI settings.' });
      const generated = await generateLocalPosterImage(settings, prompt);
      const metadata = await sharp(generated, { limitInputPixels: 80_000_000 }).metadata();
      if (!metadata.width || !metadata.height || !['png', 'jpeg', 'webp'].includes(metadata.format ?? '')) throw new Error('ComfyUI returned invalid image data.');
      const asset = await storeImageAsset(projectId, `Local-AI-${Date.now()}.png`, generated);
      response.status(201).json({ ...asset, width: metadata.width, height: metadata.height });
    } catch (error) {
      response.status(502).json({ error: error instanceof Error ? error.message.slice(0, 500) : 'Local image generation failed.' });
    }
  });
  app.post('/api/ai/text', async (request, response) => {
    const taskValue = request.body?.task;
    if (typeof taskValue !== 'string' || !['marketing', 'layout', 'variations', 'poster-plan'].includes(taskValue)) return response.status(400).json({ error: 'Choose a supported AI text task.' });
    const task = taskValue as AITextTask;
    try {
      const apiKey = await vault.get('ai-provider-api-key');
      if (!apiKey) return response.status(503).json({ error: 'Configure an AI provider API key in AI settings first.' });
      const text = await generateAIText(getAISettings(), apiKey, task, request.body?.prompt);
      response.json({ text });
    } catch (error) {
      response.status(502).json({ error: error instanceof Error ? error.message : 'AI text generation failed.' });
    }
  });
  app.post('/api/ai/image', async (request, response) => {
    const { projectId, prompt, task, imageDataUrl } = request.body ?? {};
    if (typeof projectId !== 'string' || projectId.length > 80 || !orm.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get()) return response.status(400).json({ error: 'Save the current project before generating an image.' });
    try {
      const apiKey = await vault.get('ai-provider-api-key');
      if (!apiKey) return response.status(503).json({ error: 'Configure an AI provider API key in AI settings first.' });
      const generated = await generateAIImage(getAISettings(), apiKey, task as AIImageTask, prompt, imageDataUrl);
      const metadata = await sharp(generated.data, { limitInputPixels: 80_000_000 }).metadata();
      if (!metadata.width || !metadata.height || !['png', 'jpeg', 'webp'].includes(metadata.format ?? '')) throw new Error('AI provider returned invalid image data.');
      const asset = await storeImageAsset(projectId, `AI-${Date.now()}.png`, generated.data);
      response.status(201).json({ ...asset, width: metadata.width, height: metadata.height });
    } catch (error) {
      response.status(502).json({ error: error instanceof Error ? error.message : 'AI image generation failed.' });
    }
  });
  app.get('/api/commons/search', async (request, response) => {
    const term = typeof request.query.term === 'string' ? request.query.term.trim() : '';
    const category = request.query.category === 'logo' ? 'logo' : request.query.category === 'content' ? 'content' : undefined;
    if (term.length < 2 || term.length > 200 || !category) return response.status(400).json({ error: 'Provide a 2–200 character search and choose content or logo.' });
    try {
      const result = await fetch(buildCommonsSearchUrl(term, category as CommonsCategory), { headers: { 'user-agent': 'AI-Design-Studio/1.1 (Wikimedia Commons attribution-aware search)' }, signal: AbortSignal.timeout(20_000) });
      if (!result.ok) return response.status(502).json({ error: `Wikimedia Commons search failed (${result.status}).` });
      const payload = await result.json();
      const items = normalizeCommonsResults(payload);
      for (const item of items) commonsResults.set(item.id, { ...item, expiresAt: Date.now() + 10 * 60_000 });
      for (const [id, item] of commonsResults) if (item.expiresAt < Date.now()) commonsResults.delete(id);
      while (commonsResults.size > 500) commonsResults.delete(commonsResults.keys().next().value!);
      response.json({ items, source: 'Wikimedia Commons', resultCount: items.length });
    } catch (error) {
      response.status(503).json({ error: error instanceof Error ? error.message : 'Wikimedia Commons search is unavailable.' });
    }
  });
  app.post('/api/commons/import', async (request, response) => {
    const { projectId, imageId } = request.body ?? {};
    if (typeof projectId !== 'string' || !orm.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get()) return response.status(400).json({ error: 'Save the current project before importing an image.' });
    if (typeof imageId !== 'string' || !/^\d{1,12}$/.test(imageId)) return response.status(400).json({ error: 'Select an image from the Commons search results.' });
    const image = commonsResults.get(imageId);
    if (!image || image.expiresAt < Date.now()) return response.status(400).json({ error: 'Run the Commons search again before importing this image.' });
    try {
      const result = await fetch(image.imageUrl, { redirect: 'error', headers: { 'user-agent': 'AI-Design-Studio/1.1 (Wikimedia Commons image import)' }, signal: AbortSignal.timeout(20_000) });
      if (!result.ok || !result.body || !result.headers.get('content-type')?.startsWith('image/')) return response.status(502).json({ error: 'The Commons image download failed or returned an unsupported file.' });
      const declaredSize = Number(result.headers.get('content-length'));
      if (declaredSize > 30 * 1024 * 1024) return response.status(413).json({ error: 'The Commons image exceeds the 30 MB limit.' });
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of result.body) {
        const data = Buffer.from(chunk);
        total += data.length;
        if (total > 30 * 1024 * 1024) return response.status(413).json({ error: 'The Commons image exceeds the 30 MB limit.' });
        chunks.push(data);
      }
      const attributionText = [image.license, image.licenseUrl, image.creator ? `Creator: ${image.creator}` : '', image.trademarked ? 'Trademark restrictions are indicated; check usage rights before commercial use.' : ''].filter(Boolean).join(' · ');
      const imported = await storeImageAsset(projectId, image.title, Buffer.concat(chunks), { sourceName: image.title, sourceUrl: image.sourceUrl, attributionText });
      response.status(201).json({ ...imported, license: image.license, licenseUrl: image.licenseUrl, creator: image.creator, trademarked: image.trademarked });
    } catch (error) {
      response.status(502).json({ error: error instanceof Error ? error.message : 'Commons image import failed.' });
    }
  });
  app.get('/api/pinterest/status', async (_request, response) => {
    const config = getPinterestConfig();
    response.json({ clientIdConfigured: typeof config.clientId === 'string' && config.clientId.length > 0, clientSecretConfigured: await safeCredentialExists('pinterest-client-secret'), connected: await safeCredentialExists('pinterest-tokens'), redirectUri: `http://127.0.0.1:${port}/api/pinterest/callback` });
  });
  app.put('/api/pinterest/config', async (request, response) => {
    const clientId = request.body?.clientId;
    const clientSecret = request.body?.clientSecret;
    if (typeof clientId !== 'string' || clientId.length < 4 || clientId.length > 100) return response.status(400).json({ error: 'Enter a valid Pinterest app ID.' });
    if (typeof clientSecret === 'string' && clientSecret.length > 500) return response.status(400).json({ error: 'Pinterest app secret is too long.' });
    try {
      if (clientSecret?.trim()) await vault.set('pinterest-client-secret', clientSecret.trim());
      if (request.body?.clearCredentials === true) {
        await vault.delete('pinterest-client-secret').catch(() => undefined);
        await vault.delete('pinterest-tokens').catch(() => undefined);
      }
      writeSetting('pinterest-config', { clientId });
      response.json({ clientIdConfigured: true, clientSecretConfigured: await safeCredentialExists('pinterest-client-secret'), connected: await safeCredentialExists('pinterest-tokens'), redirectUri: `http://127.0.0.1:${port}/api/pinterest/callback` });
    } catch {
      response.status(500).json({ error: 'The operating-system credential store could not save the Pinterest credentials.' });
    }
  });
  app.post('/api/pinterest/authorize', async (_request, response) => {
    const config = getPinterestConfig();
    const clientId = typeof config.clientId === 'string' ? config.clientId : '';
    if (!clientId || !await safeCredentialExists('pinterest-client-secret')) return response.status(400).json({ error: 'Save your Pinterest app ID and secret first.' });
    const state = crypto.randomBytes(32).toString('hex');
    pinterestState = { value: state, createdAt: Date.now() };
    const redirectUri = `http://127.0.0.1:${port}/api/pinterest/callback`;
    const authorization = new URL('https://www.pinterest.com/oauth/');
    authorization.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'boards:read,pins:read', state }).toString();
    response.json({ url: authorization.toString() });
  });
  app.get('/api/pinterest/callback', async (request, response) => {
    const code = request.query.code;
    const state = request.query.state;
    const expectedState = pinterestState;
    pinterestState = undefined;
    const stateMatches = typeof state === 'string' && Boolean(expectedState) && Buffer.byteLength(state) === Buffer.byteLength(expectedState!.value) && crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expectedState!.value));
    if (typeof code !== 'string' || !stateMatches || Date.now() - expectedState!.createdAt > 600_000) return response.status(400).type('text').send('Pinterest authorization could not be verified. Return to AI Design Studio and try again.');
    try {
      const config = getPinterestConfig();
      const clientId = String(config.clientId ?? '');
      const clientSecret = await vault.get('pinterest-client-secret');
      const redirectUri = `http://127.0.0.1:${port}/api/pinterest/callback`;
      const tokenResponse = await fetch('https://api.pinterest.com/v5/oauth/token', {
        method: 'POST',
        headers: { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
        signal: AbortSignal.timeout(20_000),
      });
      const tokenPayload = await tokenResponse.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!tokenResponse.ok || typeof tokenPayload.access_token !== 'string') return response.status(502).type('text').send('Pinterest did not issue an access token. Verify the registered redirect URI and app access.');
      await vault.set('pinterest-tokens', JSON.stringify({ accessToken: tokenPayload.access_token, refreshToken: tokenPayload.refresh_token, expiresAt: Date.now() + Math.max(60, tokenPayload.expires_in ?? 2_592_000) * 1000 }));
      response.type('html').send('<!doctype html><html><meta charset="utf-8"><title>Pinterest connected</title><body><p>Pinterest is connected. Return to AI Design Studio and close this page.</p></body></html>');
    } catch {
      response.status(502).type('text').send('Pinterest authorization failed. Verify app credentials and try again.');
    }
  });
  app.get('/api/pinterest/search', async (request, response) => {
    const term = typeof request.query.term === 'string' ? request.query.term.trim() : '';
    if (term.length < 2 || term.length > 200) return response.status(400).json({ error: 'Search terms must contain 2–200 characters.' });
    try {
      const accessToken = await getPinterestToken();
      const searchUrl = new URL('https://api.pinterest.com/v5/search/partner/pins');
      searchUrl.search = new URLSearchParams({ term, country_code: 'US', limit: '25' }).toString();
      const result = await fetch(searchUrl, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) });
      const payload = await result.json().catch(() => ({})) as { items?: Array<Record<string, unknown>>; bookmark?: string };
      if (!result.ok) return response.status(result.status === 401 ? 401 : 502).json({ error: result.status === 403 ? 'Pinterest search access is restricted for this app. Request the required Pinterest API beta access.' : `Pinterest search failed (${result.status}).` });
      const items = (payload.items ?? []).flatMap((pin) => {
        const images = pin.media && typeof pin.media === 'object' ? (pin.media as { images?: Record<string, { url?: string }> }).images : undefined;
        const imageUrl = images?.['1200x']?.url ?? images?.['600x']?.url ?? images?.['400x300']?.url;
        if (typeof pin.id !== 'string' || !/^\d+$/.test(pin.id) || typeof imageUrl !== 'string') return [];
        const parsed = new URL(imageUrl);
        if (parsed.protocol !== 'https:' || parsed.hostname !== 'i.pinimg.com') return [];
        const sourceUrl = `https://www.pinterest.com/pin/${pin.id}/`;
        const title = typeof pin.title === 'string' ? pin.title : '';
        pinterestResults.set(pin.id, { imageUrl: parsed.toString(), sourceUrl, title, expiresAt: Date.now() + 10 * 60_000 });
        return [{ id: pin.id, title, description: typeof pin.description === 'string' ? pin.description : '', altText: typeof pin.alt_text === 'string' ? pin.alt_text : '', imageUrl: parsed.toString(), sourceUrl }];
      });
      for (const [id, pin] of pinterestResults) if (pin.expiresAt < Date.now()) pinterestResults.delete(id);
      while (pinterestResults.size > 500) pinterestResults.delete(pinterestResults.keys().next().value!);
      response.json({ items, bookmark: typeof payload.bookmark === 'string' ? payload.bookmark : undefined, betaAccessRequired: true });
    } catch (error) {
      response.status(503).json({ error: error instanceof Error ? error.message : 'Pinterest search is unavailable.' });
    }
  });
  app.post('/api/pinterest/import', async (request, response) => {
    const { projectId, pinId } = request.body ?? {};
    if (typeof projectId !== 'string' || !orm.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get()) return response.status(400).json({ error: 'Save the current project before importing an image.' });
    if (typeof pinId !== 'string' || !/^\d+$/.test(pinId)) return response.status(400).json({ error: 'Select a Pinterest search result to import.' });
    const pin = pinterestResults.get(pinId);
    if (!pin || pin.expiresAt < Date.now()) return response.status(400).json({ error: 'Run the Pinterest search again before importing this Pin.' });
    try {
      const result = await fetch(pin.imageUrl, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
      if (!result.ok || !result.body) return response.status(502).json({ error: 'Pinterest image download failed.' });
      const declaredSize = Number(result.headers.get('content-length'));
      if (declaredSize > 30 * 1024 * 1024) return response.status(413).json({ error: 'Pinterest image exceeds the 30 MB limit.' });
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of result.body) {
        const data = Buffer.from(chunk);
        total += data.length;
        if (total > 30 * 1024 * 1024) return response.status(413).json({ error: 'Pinterest image exceeds the 30 MB limit.' });
        chunks.push(data);
      }
      const imported = await storeImageAsset(projectId, `${pin.title || `Pinterest-${pinId}`}.png`, Buffer.concat(chunks), { sourceName: pin.title || `Pinterest Pin ${pinId}`, sourceUrl: pin.sourceUrl });
      response.status(201).json(imported);
    } catch (error) {
      response.status(502).json({ error: error instanceof Error ? error.message : 'Pinterest image import failed.' });
    }
  });
  app.post('/api/print/png', async (request, response) => {
    const dataUrl = request.body?.dataUrl;
    const dpi = request.body?.dpi;
    if (typeof dataUrl !== 'string' || dataUrl.length > 100 * 1024 * 1024) return response.status(400).json({ error: 'A PNG artwork under 75 MB is required.' });
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) return response.status(400).json({ error: 'Profile embedding accepts PNG artwork.' });
    try {
      const output = await convertToSrgbPng(Buffer.from(match[1], 'base64'), Number(dpi));
      response.setHeader('content-type', 'image/png');
      response.setHeader('x-image-width', String(output.width));
      response.setHeader('x-image-height', String(output.height));
      response.setHeader('x-color-space', 'sRGB');
      response.setHeader('x-icc-profile-name', 'sRGB IEC61966-2.1');
      response.send(output.data);
    } catch (error) {
      response.status(422).json({ error: error instanceof Error ? error.message : 'PNG profile embedding failed.' });
    }
  });
  app.post('/api/print/jpeg', async (request, response) => {
    const dataUrl = request.body?.dataUrl;
    const dpi = request.body?.dpi;
    if (typeof dataUrl !== 'string' || dataUrl.length > 100 * 1024 * 1024) return response.status(400).json({ error: 'A raster artwork under 75 MB is required.' });
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) return response.status(400).json({ error: 'JPEG production export accepts PNG artwork.' });
    try {
      const output = await convertToSrgbJpeg(Buffer.from(match[1], 'base64'), Number(dpi));
      response.setHeader('content-type', 'image/jpeg');
      response.setHeader('x-image-width', String(output.width));
      response.setHeader('x-image-height', String(output.height));
      response.setHeader('x-color-space', 'sRGB');
      response.setHeader('x-icc-profile-name', 'sRGB IEC61966-2.1');
      response.send(output.data);
    } catch (error) {
      response.status(422).json({ error: error instanceof Error ? error.message : 'JPEG profile embedding failed.' });
    }
  });
  app.post('/api/print/cmyk', async (request, response) => {
    const dataUrl = request.body?.dataUrl;
    if (typeof dataUrl !== 'string' || dataUrl.length > 100 * 1024 * 1024) return response.status(400).json({ error: 'A raster image under 75 MB is required for CMYK conversion.' });
    const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) return response.status(400).json({ error: 'CMYK conversion accepts PNG or JPEG artwork.' });
    const input = Buffer.from(match[2], 'base64');
    if (!input.length || input.length > 75 * 1024 * 1024) return response.status(413).json({ error: 'Artwork exceeds the CMYK conversion size limit.' });
    try {
      const conversion = await convertToCmyk(input, Number(request.body?.dpi));
      cmykIccProfile = conversion.iccProfile;
      response.setHeader('content-type', 'image/jpeg');
      response.setHeader('x-image-width', String(conversion.width));
      response.setHeader('x-image-height', String(conversion.height));
      response.setHeader('x-color-space', 'CMYK');
      response.setHeader('x-icc-profile-name', 'Generic CMYK');
      response.send(conversion.data);
    } catch (error) {
      response.status(422).json({ error: error instanceof Error ? error.message : 'CMYK conversion failed.' });
    }
  });
  app.get('/api/print/icc/cmyk', async (_request, response) => {
    try {
      if (!cmykIccProfile) {
        const sample = await sharp({ create: { width: 1, height: 1, channels: 3, background: { r: 220, g: 220, b: 220 } } }).png().toBuffer();
        cmykIccProfile = (await convertToCmyk(sample, 300)).iccProfile;
      }
      response.setHeader('content-type', 'application/vnd.iccprofile');
      response.setHeader('x-icc-profile-name', 'Generic CMYK');
      response.send(cmykIccProfile);
    } catch (error) {
      response.status(503).json({ error: error instanceof Error ? error.message : 'The CMYK ICC profile is unavailable.' });
    }
  });
  app.get('/api/projects', (_request, response) => response.json(allProjects()));
  app.post('/api/projects', (request, response) => {
    const project = parseProject(request.body);
    if (!project) return response.status(400).json({ error: 'Invalid project data' });
    response.status(201).json(writeProject(project));
  });
  app.put('/api/projects/:id', (request, response) => {
    const project = parseProject(request.body);
    if (!project || project.id !== request.params.id) return response.status(400).json({ error: 'Invalid project data' });
    const current = orm.select({ content: schema.projects.content }).from(schema.projects).where(eq(schema.projects.id, request.params.id)).get();
    if (current) {
      const saved = JSON.parse(current.content) as DesignProject;
      const incomingRevision = Date.parse(project.updatedAt ?? '');
      const savedRevision = Date.parse(saved.updatedAt ?? '');
      if (Number.isFinite(incomingRevision) && Number.isFinite(savedRevision) && incomingRevision <= savedRevision) return response.json(saved);
    }
    response.json(writeProject(project));
  });
  app.delete('/api/projects/:id', (request, response) => {
    const projectId = request.params.id;
    const existing = orm.select({ content: schema.projects.content }).from(schema.projects).where(eq(schema.projects.id, projectId)).get();
    if (!existing) return response.status(404).json({ error: 'Project not found.' });
    const project = JSON.parse(existing.content) as DesignProject;
    if (!project.automationParentId || project.automationParentId !== request.body?.automationParentId) return response.status(403).json({ error: 'Only projects generated by this automation can be deleted this way.' });
    const otherProjects = orm.select({ id: schema.projects.id, content: schema.projects.content }).from(schema.projects).all().filter((item) => item.id !== projectId);
    const assets = orm.select().from(schema.assets).where(eq(schema.assets.projectId, projectId)).all();
    for (const asset of assets) {
      if (otherProjects.some((item) => item.content.includes(`/api/assets/${asset.id}`))) continue;
      const assetPath = path.resolve(asset.localPath);
      const expectedName = `${asset.id}.${path.extname(assetPath).slice(1)}`;
      if (path.dirname(assetPath) !== path.resolve(assetDirectory) || path.basename(assetPath) !== expectedName || !/^[a-f0-9-]{36}\.(?:png|jpg|jpeg|webp)$/i.test(expectedName)) continue;
      try {
        const stat = fs.lstatSync(assetPath);
        if (stat.isFile() || stat.isSymbolicLink()) fs.unlinkSync(assetPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    orm.delete(schema.projects).where(eq(schema.projects.id, projectId)).run();
    persist();
    response.status(204).end();
  });
  app.delete('/api/projects/:id/assets/prune', (request, response) => {
    const projectId = request.params.id;
    const projectExists = orm.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.id, projectId)).get();
    const createdAfter = typeof request.body?.createdAfter === 'string' ? Date.parse(request.body.createdAfter) : NaN;
    if (!projectExists || !Number.isFinite(createdAfter) || createdAfter > Date.now() || createdAfter < Date.now() - 7 * 24 * 60 * 60 * 1000) return response.status(400).json({ error: 'A valid recent automation checkpoint is required.' });
    const projects = orm.select({ id: schema.projects.id, content: schema.projects.content }).from(schema.projects).all();
    const candidates = orm.select().from(schema.assets).where(eq(schema.assets.projectId, projectId)).all().filter((asset) => Date.parse(asset.createdAt) >= createdAfter);
    let removed = 0;
    for (const asset of candidates) {
      if (projects.some((item) => item.content.includes(`/api/assets/${asset.id}`))) continue;
      const assetPath = path.resolve(asset.localPath);
      const expectedName = `${asset.id}.${path.extname(assetPath).slice(1)}`;
      if (path.dirname(assetPath) !== path.resolve(assetDirectory) || path.basename(assetPath) !== expectedName || !/^[a-f0-9-]{36}\.(?:png|jpg|jpeg|webp)$/i.test(expectedName)) continue;
      try {
        const stat = fs.lstatSync(assetPath);
        if (stat.isFile() || stat.isSymbolicLink()) fs.unlinkSync(assetPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      orm.delete(schema.assets).where(eq(schema.assets.id, asset.id)).run();
      removed += 1;
    }
    persist();
    response.json({ removed });
  });
  app.get('/api/product-templates', (_request, response) => response.json(orm.select().from(schema.productTemplates).all().map((row) => JSON.parse(row.definition))));
  app.post('/api/product-templates', (request, response) => {
    const template = request.body;
    if (!template || typeof template.id !== 'string' || !/^custom-[a-z0-9-]{1,48}$/.test(template.id) || typeof template.name !== 'string' || !Number.isFinite(template.widthMm) || !Number.isFinite(template.heightMm) || !Array.isArray(template.regions) || template.regions.length > 16 || template.regions.some((region: Record<string, unknown>) => !region || typeof region.id !== 'string' || typeof region.name !== 'string' || ![region.x, region.y, region.width, region.height].every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1))) return response.status(400).json({ error: 'Invalid custom product template' });
    const saved = { ...template, name: template.name.slice(0, 100), kind: 'custom', updatedAt: new Date().toISOString() };
    orm.insert(schema.productTemplates).values({ id: saved.id, name: saved.name, productType: 'custom', definition: json(saved), updatedAt: saved.updatedAt }).onConflictDoUpdate({ target: schema.productTemplates.id, set: { name: saved.name, definition: json(saved), updatedAt: saved.updatedAt } }).run();
    orm.delete(schema.printableRegions).where(eq(schema.printableRegions.templateId, saved.id)).run();
    if (saved.regions.length) orm.insert(schema.printableRegions).values(saved.regions.map((region: { id: string; name: string; x: number; y: number; width: number; height: number }) => ({ ...region, id: `${saved.id}-${region.id}`, templateId: saved.id }))).run();
    persist();
    response.status(201).json(saved);
  });
  app.post('/api/assets', (request, response) => {
    const { projectId, name, dataUrl, width, height, sourceUrl, sourceName } = request.body ?? {};
    if (typeof projectId !== 'string' || typeof name !== 'string' || typeof dataUrl !== 'string' || !Number.isFinite(width) || !Number.isFinite(height)) return response.status(400).json({ error: 'Invalid asset data' });
    const project = orm.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.id, projectId)).get();
    if (!project) return response.status(404).json({ error: 'Project not found. Create or reopen the project before importing assets.' });
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) return response.status(415).json({ error: 'Only PNG, JPEG, and WebP assets are supported' });
    const data = Buffer.from(match[2], 'base64');
    if (data.length > 30 * 1024 * 1024) return response.status(413).json({ error: 'Asset exceeds the 30 MB limit' });
    const id = crypto.randomUUID();
    const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
    const localPath = path.join(assetDirectory, `${id}.${extension}`);
    fs.writeFileSync(localPath, data, { flag: 'wx' });
    const createdAt = new Date().toISOString();
    orm.insert(schema.assets).values({ id, projectId, localPath, mimeType: `image/${match[1]}`, sourceName: String(sourceName ?? name).slice(0, 240), sourceUrl: typeof sourceUrl === 'string' ? sourceUrl.slice(0, 1000) : null, width: Math.round(width), height: Math.round(height), createdAt }).run();
    if (typeof sourceUrl === 'string' && sourceUrl.startsWith('https://')) orm.insert(schema.assetAttributions).values({ id: crypto.randomUUID(), assetId: id, sourceName: String(sourceName ?? name).slice(0, 240), sourceUrl: sourceUrl.slice(0, 1000), attributionText: 'Imported asset source', createdAt }).run();
    persist();
    response.status(201).json({ id, src: `/api/assets/${id}`, sourceName: String(sourceName ?? name), sourceUrl });
  });
  app.get('/api/assets/:id', (request, response) => {
    if (!/^[0-9a-f-]{36}$/i.test(request.params.id)) return response.status(404).end();
    const asset = orm.select().from(schema.assets).where(eq(schema.assets.id, request.params.id)).get();
    if (!asset) return response.status(404).end();
    response.type(asset.mimeType).send(fs.readFileSync(asset.localPath));
  });
  app.use(express.static(path.resolve(serverDirectory, '../dist')));
  app.get('*path', (_request, response) => response.sendFile(path.resolve(serverDirectory, '../dist/index.html')));
  app.listen(port, host, () => console.log(`AI Design Studio services listening on ${host}:${port}`));
}

start().catch((error) => {
  console.error('Unable to start local services', error);
  process.exit(1);
});

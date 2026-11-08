import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test('local API preserves secret boundaries and reports unavailable authorized services', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'iadesign-api-'));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverFile = fileURLToPath(new URL('../electron/server.ts', import.meta.url));
  const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', serverFile], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DESIGN_STUDIO_DATA: dataDirectory },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk; });
  try {
    let health;
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`API process exited (${child.exitCode}): ${serverOutput}`);
      try {
        health = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000) });
        if (health.ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.equal(health?.status, 200, `API did not become healthy: ${serverOutput}`);

    const invalidCommonsSearch = await fetch(`${baseUrl}/api/commons/search?term=nike&category=other`);
    assert.equal(invalidCommonsSearch.status, 400);
    const invalidCommonsImport = await fetch(`${baseUrl}/api/commons/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'missing-project', imageId: '12345' }) });
    assert.equal(invalidCommonsImport.status, 400);

    const samplePng = await sharp({ create: { width: 8, height: 6, channels: 4, background: { r: 220, g: 80, b: 45, alpha: 1 } } }).png().toBuffer();
    let colorResponse;
    try {
      colorResponse = await fetch(`${baseUrl}/api/print/cmyk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dataUrl: `data:image/png;base64,${samplePng.toString('base64')}`, dpi: 300 }),
      });
    } catch (error) {
      throw new Error(`CMYK route connection failed (API exit ${child.exitCode}; cause ${String(error)}; detail ${String(error?.cause)}; output ${serverOutput})`, { cause: error });
    }
    assert.equal(colorResponse.status, 200);
    assert.equal(colorResponse.headers.get('x-color-space'), 'CMYK');
    assert.equal(colorResponse.headers.get('x-icc-profile-name'), 'Generic CMYK');
    assert.ok(colorResponse.headers.get('x-icc-profile-name').length < 80);
    assert.equal(colorResponse.headers.get('content-type'), 'image/jpeg');
    const profileResponse = await fetch(`${baseUrl}/api/print/icc/cmyk`);
    assert.equal(profileResponse.status, 200);
    assert.equal(profileResponse.headers.get('content-type'), 'application/vnd.iccprofile');
    const profileBytes = Buffer.from(await profileResponse.arrayBuffer());
    assert.ok(profileBytes.length > 100_000, 'ICC profile bytes should be available outside HTTP headers');
    const jpegBytes = Buffer.from(await colorResponse.arrayBuffer());
    const convertedMetadata = await sharp(jpegBytes).metadata();
    assert.equal(convertedMetadata.space, 'cmyk');
    assert.deepEqual(convertedMetadata.icc, profileBytes);

    const settingsResponse = await fetch(`${baseUrl}/api/ai/settings`);
    const settings = await settingsResponse.json();
    assert.equal(settingsResponse.status, 200);
    assert.equal(settings.apiKeyConfigured, false);
    assert.equal(settings.mode, 'local');
    assert.equal('apiKey' in settings, false);

    const localSettingsResponse = await fetch(`${baseUrl}/api/ai/local/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ textModel: 'model-intentionally-not-installed', imageCheckpoint: '', mode: 'local' }),
    });
    assert.equal(localSettingsResponse.status, 200);
    const localSettings = await localSettingsResponse.json();
    assert.equal(localSettings.mode, 'local');
    assert.equal(localSettings.status.selectedTextModelAvailable, false);
    const localTextResponse = await fetch(`${baseUrl}/api/ai/local/text`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'marketing', prompt: 'Write a short product headline' }),
    });
    assert.equal(localTextResponse.status, 503);
    assert.match((await localTextResponse.json()).error, /not installed or Ollama is unavailable/i);

    const savedSettingsResponse = await fetch(`${baseUrl}/api/ai/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'https://provider.example/v1', textModel: 'text-test', imageModel: 'image-test', mode: 'provider' }),
    });
    assert.equal(savedSettingsResponse.status, 200);
    const savedSettings = await savedSettingsResponse.json();
    assert.equal(savedSettings.baseUrl, 'https://provider.example/v1');
    assert.equal(savedSettings.mode, 'provider');
    assert.equal(savedSettings.apiKeyConfigured, false);
    assert.equal('apiKey' in savedSettings, false);

    const textResponse = await fetch(`${baseUrl}/api/ai/text`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'marketing', prompt: 'Write a short product headline' }),
    });
    assert.equal(textResponse.status, 503);
    assert.match((await textResponse.json()).error, /API key/i);
    const posterPlanResponse = await fetch(`${baseUrl}/api/ai/text`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'poster-plan', prompt: 'Affiche de festival' }),
    });
    assert.equal(posterPlanResponse.status, 503);
    const invalidTextTask = await fetch(`${baseUrl}/api/ai/text`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'unknown', prompt: 'No request should be made' }),
    });
    assert.equal(invalidTextTask.status, 400);

    const projectResponse = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'integration-project', name: 'Integration project', width: 100, height: 100, updatedAt: '2026-01-02T00:00:00.000Z', nodes: [] }),
    });
    assert.equal(projectResponse.status, 201);
    const freshProject = await fetch(`${baseUrl}/api/projects/integration-project`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'integration-project', name: 'Latest project', width: 100, height: 100, updatedAt: '2026-01-03T00:00:00.000Z', nodes: [] }),
    });
    assert.equal(freshProject.status, 200);
    const staleProject = await fetch(`${baseUrl}/api/projects/integration-project`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'integration-project', name: 'Stale project', width: 100, height: 100, updatedAt: '2026-01-02T12:00:00.000Z', nodes: [] }),
    });
    assert.equal(staleProject.status, 200);
    assert.equal((await staleProject.json()).name, 'Latest project', 'Older autosave requests must not overwrite a newer project revision.');
    const checkpointAt = new Date(Date.now() - 1000).toISOString();
    const stagedAssetResponse = await fetch(`${baseUrl}/api/assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'integration-project', name: 'staged.png', dataUrl: `data:image/png;base64,${samplePng.toString('base64')}`, width: 8, height: 6 }),
    });
    assert.equal(stagedAssetResponse.status, 201);
    const stagedAsset = await stagedAssetResponse.json();
    const imageProject = { id: 'integration-project', name: 'Latest project', width: 100, height: 100, updatedAt: new Date().toISOString(), nodes: [{ id: 'asset-reference', name: 'Asset', type: 'image', x: 0, y: 0, width: 8, height: 6, rotation: 0, fill: '#000000', visible: true, locked: false, opacity: 1, src: stagedAsset.src }] };
    const withAsset = await fetch(`${baseUrl}/api/projects/integration-project`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(imageProject) });
    assert.equal(withAsset.status, 200);
    const retainedAssets = await fetch(`${baseUrl}/api/projects/integration-project/assets/prune`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ createdAfter: checkpointAt }) });
    assert.equal((await retainedAssets.json()).removed, 0);
    assert.equal((await fetch(`${baseUrl}${stagedAsset.src}`)).status, 200, 'Assets referenced by a project must not be pruned.');
    const withoutAsset = await fetch(`${baseUrl}/api/projects/integration-project`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...imageProject, updatedAt: new Date(Date.now() + 1000).toISOString(), nodes: [] }) });
    assert.equal(withoutAsset.status, 200);
    const prunedAssets = await fetch(`${baseUrl}/api/projects/integration-project/assets/prune`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ createdAfter: checkpointAt }) });
    assert.equal((await prunedAssets.json()).removed, 1);
    assert.equal((await fetch(`${baseUrl}${stagedAsset.src}`)).status, 404);
    const generatedProject = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'generated-project', automationParentId: 'integration-project', name: 'Generated project', width: 100, height: 100, updatedAt: new Date().toISOString(), nodes: [] }),
    });
    assert.equal(generatedProject.status, 201);
    const forbiddenDelete = await fetch(`${baseUrl}/api/projects/generated-project`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ automationParentId: 'other-project' }) });
    assert.equal(forbiddenDelete.status, 403);
    const removedGeneratedProject = await fetch(`${baseUrl}/api/projects/generated-project`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ automationParentId: 'integration-project' }) });
    assert.equal(removedGeneratedProject.status, 204);
    const projectListAfterDelete = await fetch(`${baseUrl}/api/projects`);
    assert.equal((await projectListAfterDelete.json()).some((item) => item.id === 'generated-project'), false);
    const imageResponse = await fetch(`${baseUrl}/api/ai/image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'integration-project', task: 'generate', prompt: 'A simple test image' }),
    });
    assert.equal(imageResponse.status, 503);
    assert.match((await imageResponse.json()).error, /API key/i);

    const pinterestStatusResponse = await fetch(`${baseUrl}/api/pinterest/status`);
    const pinterestStatus = await pinterestStatusResponse.json();
    assert.equal(pinterestStatusResponse.status, 200);
    assert.equal(pinterestStatus.connected, false);
    assert.equal(pinterestStatus.clientSecretConfigured, false);

    const authorizeResponse = await fetch(`${baseUrl}/api/pinterest/authorize`, { method: 'POST' });
    assert.equal(authorizeResponse.status, 400);
    assert.match((await authorizeResponse.json()).error, /app ID and secret/i);

    const pinterestSearchResponse = await fetch(`${baseUrl}/api/pinterest/search?term=botanical`);
    assert.equal(pinterestSearchResponse.status, 503);
    assert.match((await pinterestSearchResponse.json()).error, /authorized Pinterest account/i);

    const callbackResponse = await fetch(`${baseUrl}/api/pinterest/callback?code=not-a-real-code&state=invalid`);
    assert.equal(callbackResponse.status, 400);
    console.log(JSON.stringify({ health: 'ok', settingsRedacted: true, imageAndTextMissingKey: '503 explicit', pinterestAuthorizationMissingCredentials: '400 explicit', unauthorizedSearch: '503 explicit', invalidOAuthState: '400 rejected' }));
  } finally {
    child.kill();
    await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 5_000))]);
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'iadesign-commons-live-'));
const portServer = createServer();
portServer.listen(0, '127.0.0.1');
await once(portServer, 'listening');
const port = portServer.address().port;
await new Promise((resolve, reject) => portServer.close((error) => error ? reject(error) : resolve()));
const baseUrl = `http://127.0.0.1:${port}`;
const serverFile = fileURLToPath(new URL('../electron/server.ts', import.meta.url));
const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', serverFile], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DESIGN_STUDIO_DATA: dataDirectory },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
child.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk; });

try {
  let health;
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API exited (${child.exitCode}): ${output}`);
    try {
      health = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (health.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal(health?.status, 200, `API did not start: ${output}`);

  const projectResponse = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'commons-live-project', name: 'Commons live search', width: 800, height: 800, nodes: [] }),
  });
  assert.equal(projectResponse.status, 201);

  const searchResponse = await fetch(`${baseUrl}/api/commons/search?term=Nike&category=logo`);
  assert.equal(searchResponse.status, 200, await searchResponse.clone().text());
  const search = await searchResponse.json();
  assert.ok(search.items.length >= 2, `Expected multiple Nike logo examples; received ${search.items.length}.`);
  assert.ok(search.items.some((item) => /nike/i.test(`${item.title} ${item.description}`)));
  const selected = search.items.find((item) => item.license && item.sourceUrl) ?? search.items[0];

  const importResponse = await fetch(`${baseUrl}/api/commons/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: 'commons-live-project', imageId: selected.id }),
  });
  assert.equal(importResponse.status, 201, await importResponse.clone().text());
  const imported = await importResponse.json();
  assert.ok(imported.sourceUrl.startsWith('https://commons.wikimedia.org/'));
  const imageResponse = await fetch(`${baseUrl}${imported.src}`);
  assert.equal(imageResponse.status, 200);
  const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
  const imageMetadata = await sharp(imageBytes).metadata();
  assert.equal(imageMetadata.format, 'png');
  assert.ok(imageMetadata.width > 0 && imageMetadata.height > 0);

  child.kill();
  await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  const SQL = await initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
  const database = new SQL.Database(await readFile(path.join(dataDirectory, 'studio.sqlite')));
  const attributionRows = database.exec('SELECT source_url, attribution_text FROM asset_attributions');
  const values = attributionRows[0]?.values ?? [];
  assert.ok(values.some(([url, text]) => String(url).startsWith('https://commons.wikimedia.org/') && String(text).length > 0));
  database.close();
  console.log(JSON.stringify({ search: 'passed', query: 'Nike', category: 'logo', examples: search.items.length, import: 'passed', pngAsset: 'passed', sourceAndLicenseAttributionPersisted: 'passed' }));
} finally {
  if (child.exitCode === null) child.kill();
  await Promise.race([once(child, 'exit').catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  await rm(dataDirectory, { recursive: true, force: true });
}

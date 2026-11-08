import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const installer = process.argv[2] ?? path.join('release-backup-final', 'AI Design Studio Setup 1.0.0.exe');
assert.ok(installer, 'Pass the Windows x64 installer path as the first argument.');
const root = await mkdtemp(path.join(os.tmpdir(), 'iadesign-release-install-'));
const installDirectory = path.join(root, 'installed-app');
const debugServer = createServer();
debugServer.listen(0, '127.0.0.1');
await once(debugServer, 'listening');
const debugPort = debugServer.address().port;
await new Promise((resolve, reject) => debugServer.close((error) => error ? reject(error) : resolve()));
let appProcess;
let browser;
try {
  const installation = spawnSync(path.resolve(installer), ['/S', `/D=${installDirectory}`], { stdio: 'inherit', timeout: 300_000, windowsHide: true });
  assert.equal(installation.status, 0, `Silent installer exited with ${installation.status ?? installation.error}`);
  const executable = path.join(installDirectory, 'AI Design Studio.exe');
  await access(executable);
  await access(path.join(installDirectory, 'resources', 'app.asar'));
  appProcess = spawn(executable, [`--remote-debugging-port=${debugPort}`], { stdio: 'ignore', windowsHide: true });
  let health;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (appProcess.exitCode !== null) throw new Error(`Packaged application exited with ${appProcess.exitCode} before startup.`);
    try {
      health = await fetch('http://127.0.0.1:4174/api/health', { signal: AbortSignal.timeout(1_000) });
      if (health.ok) break;
    } catch {}
    await delay(250);
  }
  assert.equal(health?.status, 200, 'Packaged local API did not start.');
  const model = await fetch('http://127.0.0.1:4174/models/onnx-community/BiRefNet_lite-ONNX/onnx/model_fp16.onnx', { method: 'HEAD' });
  assert.equal(model.status, 200, 'Packaged local segmentation model was not served.');
  assert.ok(Number(model.headers.get('content-length')) > 50 * 1024 * 1024, 'Packaged model file is unexpectedly small.');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.waitForURL('http://127.0.0.1:4174/', { timeout: 30_000 });
  await page.waitForSelector('canvas', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Backup and recovery' }).click();
  await page.getByRole('heading', { name: 'Protégez vos projets locaux' }).waitFor();
  assert.equal(await page.evaluate(() => typeof window.studioBackup?.create), 'function', 'Packaged backup IPC preload is unavailable.');
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ install: 'passed', packagedStartup: 'passed', localApi: 'passed', bundledSegmentationModel: 'served', backupPreload: 'exposed', browserErrors: failures.length }));
} finally {
  await browser?.close().catch(() => undefined);
  if (appProcess?.pid) {
    const taskkill = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    spawnSync(taskkill, ['/pid', String(appProcess.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
  }
  const uninstaller = path.join(installDirectory, 'Uninstall AI Design Studio.exe');
  try {
    await access(uninstaller);
    const uninstall = spawnSync(uninstaller, ['/S'], { stdio: 'inherit', timeout: 120_000, windowsHide: true });
    if (uninstall.status !== 0) throw new Error(`Silent uninstall exited with ${uninstall.status ?? uninstall.error}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 7) throw error;
      await delay(500);
    }
  }
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts', 'background-removal-certification');
const screenshotDir = path.join(artifacts, 'workflow-screenshots');
const baseUrl = process.env.BG_WORKFLOW_URL ?? 'http://127.0.0.1:4176';
const apiUrl = process.env.BG_WORKFLOW_API ?? 'http://127.0.0.1:4176';
const testImages = [
  path.join(root, 'artifacts', 'background-removal-certification', 'real-photo-evaluation', 'images', '10fd5df6c15ddcad.jpg'),
  path.join(root, 'artifacts', 'background-removal-certification', 'real-photo-evaluation', 'images', 'cc8f89ff8071d9c1.jpg'),
];
const baseImageName = (name) => name.replace(/ · (?:BiRefNet Lite|MODNet)$/, '');
const browserErrors = [];
const screenshots = [];
const projectWrites = [];
fs.mkdirSync(screenshotDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(45_000);
page.setDefaultNavigationTimeout(60_000);
page.on('pageerror', (error) => browserErrors.push(error.message));
page.on('requestfailed', (request) => browserErrors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'request failed'}`));
page.on('response', async (response) => {
  if (response.url().includes('/api/projects/') && response.request().method() === 'PUT') {
    const sent = response.request().postData();
    const received = await response.json().catch(() => null);
    projectWrites.push({ status: response.status(), revision: sent ? JSON.parse(sent).updatedAt : null, nodeOriginals: received?.nodes?.map((node) => Boolean(node.originalSrc)) ?? null });
  }
  if (response.status() >= 400) {
    const body = await response.text().catch(() => 'response body unavailable');
    const requestBody = response.request().postData();
    let assetProject = '';
    if (response.url().endsWith('/api/assets') && requestBody) {
      try { assetProject = ` projectId=${JSON.parse(requestBody).projectId ?? 'missing'}`; } catch { assetProject = ' projectId=unparseable'; }
    }
    browserErrors.push(`${response.status()} ${response.url()}${assetProject} ${body.slice(0, 1200)}`);
  }
});
page.on('dialog', (dialog) => void dialog.accept());

async function persistedProject(projectId) {
  const response = await fetch(`${apiUrl}/api/projects`);
  assert.equal(response.status, 200, `Project lookup failed: ${response.status}`);
  const projects = await response.json();
  const project = projects.find((item) => item.id === projectId);
  assert.ok(project, `Project ${projectId} was not persisted.`);
  return project;
}

async function waitForPersistedProject(projectId, predicate, message) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const project = await persistedProject(projectId);
    if (predicate(project)) return project;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(message);
}

async function outputImageDimensions(source) {
  return page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Output PNG could not be inspected.');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonOpaquePixels = 0;
    let nonTransparentPixels = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] < 255) nonOpaquePixels += 1;
      if (pixels[index] > 0) nonTransparentPixels += 1;
    }
    return { width: image.naturalWidth, height: image.naturalHeight, nonOpaquePixels, nonTransparentPixels };
  }, source);
}

try {
  const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  assert.equal(response?.status(), 200, 'The editor did not load.');
  await page.locator('.app-shell').waitFor();
  const previousProjectId = await page.locator('.app-shell').getAttribute('data-project-id');
  await page.locator('.create-project').click();
  await page.waitForFunction((previousId) => {
    const currentId = document.querySelector('.app-shell')?.getAttribute('data-project-id');
    return Boolean(currentId && currentId !== previousId);
  }, previousProjectId, { timeout: 30_000 });
  const projectId = await page.locator('.app-shell').getAttribute('data-project-id');
  assert.ok(projectId, 'The test workspace did not receive a project ID.');
  await page.waitForFunction(async (id) => {
    const response = await fetch('/api/projects');
    const projects = await response.json();
    return projects.some((project) => project.id === id);
  }, projectId, { timeout: 30_000 });
  const starterLayers = page.locator('.layer-row');
  while (await starterLayers.count()) {
    await starterLayers.first().click();
    await page.locator('button[aria-label="Delete selected objects"]').click();
  }
  await page.waitForFunction(async (id) => {
    const response = await fetch('/api/projects');
    const projects = await response.json();
    return projects.some((project) => project.id === id && project.nodes.length === 0);
  }, projectId, { timeout: 30_000 });
  await page.locator('input.hidden-input[type=file]').setInputFiles(testImages);
  await page.waitForFunction(() => document.querySelectorAll('.layer-row[data-node-type="image"]').length === 2, null, { timeout: 30_000 });
  const expectedNames = testImages.map((source) => path.basename(source)).sort();
  const originalProject = await waitForPersistedProject(projectId, (saved) => {
    const images = saved.nodes.filter((node) => node.type === 'image');
    return images.length === 2 && images.every((node) => node.src) && images.map((node) => baseImageName(node.name)).sort().every((name, index) => name === expectedNames[index]);
  }, 'Imported source images did not reach persistent project storage.');
  const originalSources = Object.fromEntries(originalProject.nodes.filter((node) => node.type === 'image').map((node) => [baseImageName(node.name), node.originalSrc ?? node.src]));
  const layers = page.locator('.layer-row[data-node-type="image"]');
  await layers.nth(0).click();
  await layers.nth(1).click({ modifiers: ['Shift'] });
  await page.locator('select[aria-label="Segmentation model"]').selectOption('universal');
  await page.getByRole('button', { name: 'Remove background (2 images)' }).click();
  await page.getByRole('button', { name: 'Remove background (2 images)' }).waitFor({ state: 'visible', timeout: 300_000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.layer-row')).filter((row) => row.textContent.includes('BiRefNet Lite')).length === 2, null, { timeout: 300_000 });
  await page.screenshot({ path: path.join(screenshotDir, 'real-photo-batch-cutout.png'), fullPage: true });
  screenshots.push('artifacts/background-removal-certification/workflow-screenshots/real-photo-batch-cutout.png');

  let project = await waitForPersistedProject(projectId, (saved) => {
    const images = saved.nodes.filter((node) => node.type === 'image');
    return images.length === 2 && images.every((node) => node.originalSrc && node.maskSrc && node.src && node.src !== node.originalSrc);
  }, 'Batch segmentation output did not persist.');
  let processed = project.nodes.filter((node) => node.type === 'image');
  assert.equal(processed.length, 2, 'Batch processing must keep both editable image objects.');
  for (const node of processed) {
    const originalName = baseImageName(node.name);
    assert.equal(node.originalSrc, originalSources[originalName], `${node.name} did not preserve the exact original asset.`);
    assert.ok(node.maskSrc, `${node.name} did not save an editable mask.`);
    assert.ok(node.src && node.src !== node.originalSrc, `${node.name} did not create a distinct transparent PNG asset.`);
    assert.ok(node.sourceWidth > 0 && node.sourceHeight > 0, `${node.name} lost source dimensions.`);
    const output = await outputImageDimensions(node.src);
    assert.deepEqual({ width: output.width, height: output.height }, { width: node.sourceWidth, height: node.sourceHeight }, `${node.name} transparent output dimensions do not match the original.`);
    assert.ok(output.nonOpaquePixels > 0 && output.nonTransparentPixels > 0, `${node.name} must contain both transparent background and non-transparent subject pixels.`);
  }

  await page.getByRole('button', { name: 'Annuler' }).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.layer-row')).filter((row) => row.dataset.nodeType === 'image').length === 2 && Array.from(document.querySelectorAll('.layer-row[data-node-type="image"]')).every((row) => !row.textContent.includes('BiRefNet Lite')), null, { timeout: 30_000 });
  await waitForPersistedProject(projectId, (saved) => {
    const images = saved.nodes.filter((node) => node.type === 'image');
    return images.length === 2 && images.every((node) => node.src === originalSources[node.name] && !node.originalSrc && !node.maskSrc);
  }, 'Undo did not persist the exact original image states.');
  project = await persistedProject(projectId);
  assert.ok(project.nodes.filter((node) => node.type === 'image').every((node) => node.src === originalSources[node.name] && !node.originalSrc && !node.maskSrc), 'Undo must restore both exact original image states.');
  await page.getByRole('button', { name: 'Rétablir' }).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.layer-row[data-node-type="image"]')).length === 2 && Array.from(document.querySelectorAll('.layer-row[data-node-type="image"]')).every((row) => row.textContent.includes('BiRefNet Lite')), null, { timeout: 30_000 });
  await waitForPersistedProject(projectId, (saved) => {
    const images = saved.nodes.filter((node) => node.type === 'image');
    return images.length === 2 && images.every((node) => node.originalSrc === originalSources[baseImageName(node.name)] && node.maskSrc && node.src !== originalSources[baseImageName(node.name)]);
  }, 'Redo did not persist the original assets and editable masks.');
  project = await persistedProject(projectId);
  processed = project.nodes.filter((node) => node.type === 'image');
  assert.ok(processed.every((node) => node.originalSrc === originalSources[baseImageName(node.name)] && node.maskSrc), 'Redo must restore the same source assets and editable masks.');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction((id) => document.querySelector('.app-shell')?.getAttribute('data-project-id') === id, projectId, { timeout: 30_000 });
  await page.waitForFunction(() => document.querySelectorAll('.layer-row[data-node-type="image"]').length === 2, null, { timeout: 30_000 });
  project = await persistedProject(projectId);
  processed = project.nodes.filter((node) => node.type === 'image');
  assert.ok(processed.every((node) => node.originalSrc === originalSources[baseImageName(node.name)] && node.maskSrc), 'Reopening the saved project must retain exact originals and editable masks.');

  const firstProcessed = page.locator('.layer-row[data-node-type="image"]').filter({ hasText: 'BiRefNet Lite' }).first();
  const refinedNodeId = await firstProcessed.getAttribute('data-node-id');
  assert.ok(refinedNodeId, 'The selected processed image has no persisted object ID.');
  await firstProcessed.click();
  await page.getByRole('button', { name: 'Refine mask' }).click();
  const maskCanvas = page.locator('.mask-editor-canvas-wrap canvas');
  await maskCanvas.waitFor();
  const bounds = await maskCanvas.boundingBox();
  assert.ok(bounds, 'The editable mask canvas is missing.');
  const alphaAt = (position) => maskCanvas.evaluate((canvas, point) => {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The editable mask preview is unavailable.');
    return context.getImageData(Math.floor(canvas.width * point.x), Math.floor(canvas.height * point.y), 1, 1).data[3];
  }, position);
  const backgroundPoint = { x: 0.92, y: 0.08 };
  const backgroundAlpha = await alphaAt(backgroundPoint);
  assert.ok(backgroundAlpha < 16, `Mask restore target must begin transparent; alpha was ${backgroundAlpha}.`);
  await page.mouse.click(bounds.x + bounds.width * backgroundPoint.x, bounds.y + bounds.height * backgroundPoint.y);
  const restoredAlpha = await alphaAt(backgroundPoint);
  assert.ok(restoredAlpha > backgroundAlpha, 'The restore brush must increase mask opacity on the selected transparent pixels.');
  const maskUndo = page.getByRole('button', { name: 'Undo', exact: true });
  const maskRedo = page.getByRole('button', { name: 'Redo', exact: true });
  await maskUndo.click();
  assert.equal(await alphaAt(backgroundPoint), backgroundAlpha, 'Mask undo must restore the exact pre-brush alpha value.');
  await maskRedo.click();
  assert.equal(await alphaAt(backgroundPoint), restoredAlpha, 'Mask redo must restore the exact post-brush alpha value.');
  const foregroundPoint = await maskCanvas.evaluate((canvas) => {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The editable mask preview is unavailable.');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let y = Math.floor(canvas.height * 0.3); y < Math.floor(canvas.height * 0.8); y += 1) {
      for (let x = Math.floor(canvas.width * 0.3); x < Math.floor(canvas.width * 0.7); x += 1) {
        if (pixels[(y * canvas.width + x) * 4 + 3] > 240) return { x: x / canvas.width, y: y / canvas.height };
      }
    }
    return null;
  });
  assert.ok(foregroundPoint, 'The selected photograph must contain an opaque mask pixel for eraser verification.');
  const foregroundAlpha = await alphaAt(foregroundPoint);
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.mouse.click(bounds.x + bounds.width * foregroundPoint.x, bounds.y + bounds.height * foregroundPoint.y);
  const erasedAlpha = await alphaAt(foregroundPoint);
  assert.ok(erasedAlpha < foregroundAlpha, 'The eraser must decrease mask opacity on the selected foreground pixels.');
  await maskUndo.click();
  assert.equal(await alphaAt(foregroundPoint), foregroundAlpha, 'Eraser undo must restore the exact previous alpha value.');
  await maskRedo.click();
  assert.equal(await alphaAt(foregroundPoint), erasedAlpha, 'Eraser redo must restore the exact post-erase alpha value.');
  await page.screenshot({ path: path.join(screenshotDir, 'real-photo-mask-refinement.png'), fullPage: true });
  screenshots.push('artifacts/background-removal-certification/workflow-screenshots/real-photo-mask-refinement.png');
  await page.getByRole('button', { name: 'Apply transparent mask' }).click();
  await page.locator('.mask-editor-modal').waitFor({ state: 'detached', timeout: 30_000 });
  await page.waitForTimeout(800);
  project = await persistedProject(projectId);
  const refined = project.nodes.find((node) => node.id === refinedNodeId);
  assert.ok(refined?.originalSrc && refined.maskSrc && refined.src, 'Applying a refined mask must preserve original, mask and transparent output.');
  const refinedDimensions = await outputImageDimensions(refined.src);
  assert.deepEqual({ width: refinedDimensions.width, height: refinedDimensions.height }, { width: refined.sourceWidth, height: refined.sourceHeight }, 'Refined transparent PNG dimensions must match the original.');
  assert.ok(refinedDimensions.nonOpaquePixels > 0 && refinedDimensions.nonTransparentPixels > 0, 'The refined PNG must retain real alpha transparency.');

  await page.getByRole('button', { name: 'Restore original' }).click();
  await page.waitForTimeout(800);
  project = await persistedProject(projectId);
  const restored = project.nodes.find((node) => node.id === refined.id);
  assert.equal(restored.src, refined.originalSrc, 'Original recovery must restore the exact source asset.');
  assert.ok(!restored.originalSrc && !restored.maskSrc, 'Original recovery must clear only the derived mask references.');
  await page.screenshot({ path: path.join(screenshotDir, 'real-photo-original-restored.png'), fullPage: true });
  screenshots.push('artifacts/background-removal-certification/workflow-screenshots/real-photo-original-restored.png');

  assert.deepEqual(browserErrors, [], `Browser errors occurred: ${browserErrors.join(' | ')}`);
  console.log(JSON.stringify({ status: 'PASS', projectId, batchImages: processed.length, operations: ['real photo import', 'BiRefNet batch processing', 'source preservation', 'transparent PNG output and dimensions', 'editable mask persistence', 'undo', 'redo', 'save/reopen', 'manual brush correction', 'mask undo/redo', 'mask apply', 'original recovery'], browserErrors, screenshots }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', error: error instanceof Error ? error.message : String(error), projectWrites: projectWrites.slice(-20), browserErrors }, null, 2));
  throw error;
} finally {
  await browser.close();
}

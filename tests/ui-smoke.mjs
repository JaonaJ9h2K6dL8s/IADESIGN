import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';

const baseUrl = process.env.UI_TEST_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
const failures = [];
const dialogs = [];
const failedResponses = [];
page.on('pageerror', (error) => failures.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') failures.push(message.text()); });
page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.accept(); });
page.on('response', async (response) => { if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url(), body: await response.text().catch(() => '') }); });
try {
  const response = await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30_000 });
  assert.equal(response?.status(), 200);
  await page.waitForSelector('canvas', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Backup and recovery' }).click();
  await page.getByRole('heading', { name: 'Protégez vos projets locaux' }).waitFor();
  assert.ok((await page.locator('.backup-manager-modal').innerText()).includes('La sauvegarde est disponible'));
  assert.ok(await page.getByRole('button', { name: 'Créer une sauvegarde' }).isDisabled(), 'Browser preview must not invoke native backup actions');
  await page.getByRole('button', { name: 'Fermer' }).click();
  const initial = await page.evaluate(() => ({
    title: document.title,
    headings: Array.from(document.querySelectorAll('h1,h2')).map((node) => node.textContent?.trim()).filter(Boolean),
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    canvasCount: document.querySelectorAll('canvas').length,
  }));
  assert.ok(initial.canvasCount > 0, 'Konva editor canvas should render');
  assert.ok(initial.documentWidth <= initial.viewportWidth + 1, `Unexpected initial horizontal overflow: ${initial.documentWidth}px`);
  await page.screenshot({ path: path.join(tmpdir(), 'iadesign-ui-smoke.png'), fullPage: true });
  await page.locator('.rail-bottom .rail-button').first().click();
  await page.waitForTimeout(800);
  await page.locator('.save-state:not(.saving)').waitFor({ state: 'visible', timeout: 20_000 });

  await page.getByRole('button', { name: 'OPTIMISER' }).click();
  assert.equal(await page.locator('.optimizer-grid article').count(), 6, 'Smart Layout should offer six alternatives');
  await page.locator('.optimizer-grid article').first().getByRole('button').click();
  await page.waitForSelector('.optimizer-modal', { state: 'detached' });
  await page.keyboard.press('Control+z');

  await page.locator('.tool-rail .rail-button').filter({ hasText: 'Assistant de création' }).click();
  await page.locator('.assistant-modal').waitFor({ state: 'visible' });
  await page.locator('.assistant-modal select').selectOption('layout');
  await page.locator('.assistant-modal textarea').fill('Slogan printanier pour affiches botaniques');
  const layerCount = await page.locator('.layer-list .layer-row').count();
  await page.locator('.assistant-modal').getByRole('button', { name: 'Create local editable layout' }).click();
  await page.waitForFunction((count) => document.querySelectorAll('.layer-list .layer-row').length >= count + 4, layerCount);
  await page.keyboard.press('Control+z');

  await page.locator('.tool-rail .rail-button').filter({ hasText: 'Produit' }).click();
  const template = page.getByLabel('Product template');
  await template.selectOption('bottle');
  assert.ok((await page.locator('.region-list').innerText()).includes('Wrap label'));
  await page.getByRole('button', { name: 'Open live 3D preview' }).click();
  await page.locator('.product-preview canvas').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.texture-debug-canvas');
    return canvas && canvas.width > 500 && canvas.height > 300;
  }, undefined, { timeout: 20_000 });
  await page.waitForTimeout(300);
  const bottlePreview = await page.locator('.product-preview').screenshot();
  const { data: previewPixels, info: previewInfo } = await sharp(bottlePreview).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let artworkPixels = 0;
  for (let index = 0; index < previewPixels.length; index += previewInfo.channels) {
    const red = previewPixels[index];
    const green = previewPixels[index + 1];
    const blue = previewPixels[index + 2];
    if (Math.max(red, green, blue) - Math.min(red, green, blue) > 45) artworkPixels += 1;
  }
  assert.ok(artworkPixels > 40, `Bottle mockup should visibly render colored artwork; got ${artworkPixels} colored pixels`);
  const bottleCanvases = await page.locator('.product-preview canvas').count();
  const bottleTexture = await page.locator('.texture-debug-canvas').evaluate((canvas) => {
    const element = canvas;
    const data = element.getContext('2d')?.getImageData(0, 0, element.width, element.height).data;
    const colors = new Set();
    if (data) for (let index = 0; index < data.length; index += 160) colors.add(`${data[index]}:${data[index + 1]}:${data[index + 2]}`);
    return { width: element.width, height: element.height, distinctColors: colors.size, dataUrl: element.toDataURL('image/png') };
  });
  await writeFile(path.join(tmpdir(), 'iadesign-bottle-texture.png'), Buffer.from(bottleTexture.dataUrl.split(',')[1], 'base64'));
  assert.ok(bottleTexture.distinctColors > 10, `Bottle artwork texture should render non-uniform artwork; got ${bottleTexture.distinctColors} colors`);
  await page.screenshot({ path: path.join(tmpdir(), 'iadesign-bottle-3d.png') });
  await page.locator('.product-modal header button').click();

  await template.selectOption('tshirt');
  assert.equal(await page.locator('.region-list span').count(), 4, 'Textile template should expose body and sleeve print regions');
  await page.getByRole('button', { name: 'Open live 3D preview' }).click();
  await page.locator('.product-preview canvas').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.texture-debug-canvas');
    return canvas && canvas.width > 500 && canvas.height > 300;
  }, undefined, { timeout: 20_000 });
  const readGarmentTexture = () => page.locator('.texture-debug-canvas').evaluate((canvas) => {
    const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!data) throw new Error('Garment artwork texture is not readable');
    let signature = 0;
    const colors = new Set();
    for (let index = 0; index < data.length; index += 64) {
      signature = (Math.imul(signature, 31) + data[index] + data[index + 1] * 3 + data[index + 2] * 7) | 0;
      colors.add(`${data[index]}:${data[index + 1]}:${data[index + 2]}`);
    }
    return { width: canvas.width, height: canvas.height, signature, distinctColors: colors.size, regionId: canvas.dataset.regionId };
  });
  const waitForTextureRegion = (regionId) => page.waitForFunction((expected) => document.querySelector('.texture-debug-canvas')?.dataset.regionId === expected, regionId, { timeout: 20_000 });
  await waitForTextureRegion('front');
  const frontTexture = await readGarmentTexture();
  assert.equal(frontTexture.regionId, 'front', 'Front view must assign the front artwork region');
  assert.ok(frontTexture.distinctColors > 10, 'Front texture should contain the front artwork rather than a placeholder');
  await page.getByRole('button', { name: 'Show back' }).click();
  await page.getByRole('button', { name: 'Show front' }).waitFor({ state: 'visible' });
  await waitForTextureRegion('back');
  await page.waitForFunction((previous) => {
    const canvas = document.querySelector('.texture-debug-canvas');
    const data = canvas?.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!canvas || !data) return false;
    let signature = 0;
    for (let index = 0; index < data.length; index += 64) signature = (Math.imul(signature, 31) + data[index] + data[index + 1] * 3 + data[index + 2] * 7) | 0;
    return signature !== previous;
  }, frontTexture.signature);
  const initialBackTexture = await readGarmentTexture();
  assert.equal(initialBackTexture.regionId, 'back', 'Back view must assign only the back artwork region');
  assert.ok(initialBackTexture.distinctColors > 10, 'Back texture should contain its own region artwork');
  await page.locator('.product-modal header button').click();
  await page.locator('.layer-row').filter({ hasText: 'Signature' }).click();
  await page.locator('.text-content-field').fill('BACK-REGION-CHANGED');
  await page.locator('.inspector-section').nth(1).locator('input[type="number"]').fill('32');
  await page.locator('input[type="color"]').fill('#ff00ff');
  await page.locator('.save-state:not(.saving)').waitFor({ state: 'visible', timeout: 20_000 });
  await page.getByRole('button', { name: 'Open live 3D preview' }).click();
  await page.locator('.product-preview canvas').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.texture-debug-canvas');
    return canvas && canvas.width > 500 && canvas.height > 300;
  }, undefined, { timeout: 20_000 });
  const showFrontButton = page.getByRole('button', { name: 'Show front' });
  if (await showFrontButton.isVisible()) await showFrontButton.click();
  await page.getByRole('button', { name: 'Show back' }).waitFor({ state: 'visible' });
  await waitForTextureRegion('front');
  await page.waitForFunction((previous) => {
    const canvas = document.querySelector('.texture-debug-canvas');
    const data = canvas?.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!canvas || !data) return false;
    let signature = 0;
    for (let index = 0; index < data.length; index += 64) signature = (Math.imul(signature, 31) + data[index] + data[index + 1] * 3 + data[index + 2] * 7) | 0;
    return signature !== previous;
  }, initialBackTexture.signature);
  const updatedFrontTexture = await readGarmentTexture();
  assert.equal(updatedFrontTexture.signature, frontTexture.signature, 'Back artwork edits must not alter the front region texture');
  const countMagentaPixels = async () => {
    const screenshot = await page.locator('.product-preview').screenshot();
    const { data, info } = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let count = 0;
    for (let index = 0; index < data.length; index += info.channels) {
      if (data[index] > 200 && data[index + 1] < 100 && data[index + 2] > 160) count += 1;
    }
    return count;
  };
  const frontOnlyMagentaPixels = await countMagentaPixels();
  await page.screenshot({ path: path.join(tmpdir(), 'iadesign-shirt-front-3d.png') });
  assert.ok(frontOnlyMagentaPixels < 10, `Back-only artwork must not appear while viewing the front; got ${frontOnlyMagentaPixels} magenta pixels`);
  await page.getByRole('button', { name: 'Show back' }).click();
  await page.getByRole('button', { name: 'Show front' }).waitFor({ state: 'visible' });
  await waitForTextureRegion('back');
  await page.waitForFunction((previous) => {
    const canvas = document.querySelector('.texture-debug-canvas');
    const data = canvas?.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!canvas || !data) return false;
    let signature = 0;
    for (let index = 0; index < data.length; index += 64) signature = (Math.imul(signature, 31) + data[index] + data[index + 1] * 3 + data[index + 2] * 7) | 0;
    return signature !== previous;
  }, updatedFrontTexture.signature);
  const updatedBackTexture = await readGarmentTexture();
  assert.notEqual(updatedBackTexture.signature, initialBackTexture.signature, 'Switching to the back must update its artwork region texture');
  assert.ok(await countMagentaPixels() > 20, 'Back artwork must be visible on the back surface');
  await page.screenshot({ path: path.join(tmpdir(), 'iadesign-shirt-back-3d.png') });
  await page.locator('.product-modal header button').click();

  await page.locator('.tool-rail .rail-button').filter({ hasText: 'Impression' }).click();
  await page.getByLabel('Color workflow').selectOption('CMYK');
  await page.getByRole('button', { name: 'Validate print file' }).click();
  assert.ok((await page.locator('.print-warnings').innerText()).includes('generic CMYK ICC profile'));
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Print-ready PDF' }).click();
  const download = await downloadPromise;
  const pdfPath = path.join(tmpdir(), 'iadesign-production-smoke.pdf');
  await download.saveAs(pdfPath);
  const pdf = await PDFDocument.load(await readFile(pdfPath));
  assert.equal(pdf.getPageCount(), 1);
  const pageSize = pdf.getPage(0).getSize();
  const trimBox = pdf.getPage(0).getTrimBox();
  const bleedBox = pdf.getPage(0).getBleedBox();
  assert.ok(pageSize.width > 500 && pageSize.height > 700, 'Production PDF should use physical print dimensions');
  assert.ok(Math.abs(trimBox.width - 300 * 72 / 25.4) < 1, 'PDF TrimBox should match the configured physical width');
  assert.ok(bleedBox.width > trimBox.width && bleedBox.height > trimBox.height, 'PDF BleedBox should include configured bleed content');
  await page.locator('.save-state:not(.saving)').waitFor({ state: 'visible', timeout: 20_000 });
  const savedProjectName = await page.locator('.document-title input').inputValue();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('canvas', { timeout: 20_000 });
  await page.waitForFunction((name) => document.querySelector('.document-title input')?.value === name, savedProjectName, { timeout: 20_000 });
  await page.locator('.tool-rail .rail-button').filter({ hasText: 'Produit' }).click();
  assert.equal(await page.getByLabel('Product template').inputValue(), 'tshirt', 'Saved product template should reopen');
  assert.equal(await page.locator('.layer-list .layer-row').count(), 8, 'Editable layers should survive project reload');

  const final = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    canvasCount: document.querySelectorAll('canvas').length,
  }));
  assert.ok(final.documentWidth <= final.viewportWidth + 1, `Unexpected horizontal overflow: ${final.documentWidth}px`);
  assert.deepEqual(failures, [], `Browser console errors: ${failures.join(' | ')}`);
  console.log(JSON.stringify({
    title: initial.title,
    smartLayoutAlternatives: 6,
    localEditableLayout: 'added four layers and undo invoked',
    bottle3dCanvasCount: bottleCanvases,
    bottleArtworkPixels: artworkPixels,
    textileRegions: 4,
    shirtBackView: 'rendered',
    productionPdfPages: pdf.getPageCount(),
    productionPdfPageSizePt: pageSize,
    horizontalOverflow: false,
    browserErrors: failures.length,
    screenshots: ['iadesign-ui-smoke.png', 'iadesign-bottle-3d.png', 'iadesign-shirt-back-3d.png'].map((name) => path.join(tmpdir(), name)),
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ failures, dialogs, failedResponses, url: page.url(), body: await page.locator('body').innerText().catch(() => '') }, null, 2));
  throw error;
} finally {
  await browser.close();
}

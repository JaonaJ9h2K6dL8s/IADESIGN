import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright';

const baseUrl = process.env.UI_TEST_URL ?? 'http://127.0.0.1:5173';
const screenshotDirectory = path.join(tmpdir(), 'iadesign-editor-tests');
const smartLayoutScreenshotDirectory = path.join(process.cwd(), 'artifacts', 'smart-layout-certification');
const browser = await chromium.launch({ headless: true });
await mkdir(screenshotDirectory, { recursive: true });
await mkdir(smartLayoutScreenshotDirectory, { recursive: true });
after(() => browser.close());

async function withEditor(name, run) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  let screenshot;
  try {
    const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    assert.equal(response?.status(), 200);
    await page.waitForSelector('.app-shell', { timeout: 20_000 });
    await page.locator('.language-button').click();
    await page.locator('.rail-bottom .rail-button').first().click();
    await page.locator('.save-state:not(.saving)').waitFor({ state: 'visible', timeout: 20_000 });
    const rows = page.locator('.layer-list .layer-row');
    const count = await rows.count();
    if (count) {
      for (let index = 0; index < count; index += 1) await rows.nth(index).click(index ? { modifiers: ['Shift'] } : undefined);
      await page.getByRole('button', { name: 'Delete selected objects' }).click();
    }
    await page.waitForFunction(() => document.querySelectorAll('.layer-list .layer-row').length === 0);
    await page.locator('.save-state:not(.saving)').waitFor({ state: 'visible', timeout: 20_000 });
    await run(page);
  } finally {
    screenshot = path.join(screenshotDirectory, `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`);
    if (!page.isClosed()) {
      await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
      if (errors.length) assert.deepEqual(errors, [], `Browser errors in ${name}: ${errors.join(' | ')}`);
      await page.close();
    }
  }
  console.log(`Screenshot ${name}: ${screenshot}`);
}

async function addRectangle(page) {
  const before = await page.locator('.layer-list .layer-row').count();
  await page.getByRole('button', { name: 'Elements' }).click();
  await page.getByRole('button', { name: 'Rectangle' }).click();
  await page.waitForFunction((value) => document.querySelectorAll('.layer-list .layer-row').length === value + 1, before);
  return page.locator('.layer-list .layer-row').first();
}

async function selectRows(page, rowIds) {
  for (let index = 0; index < rowIds.length; index += 1) {
    await page.locator(`.layer-row[data-node-id="${rowIds[index]}"]`).click(index ? { modifiers: ['Shift'] } : undefined);
  }
}

async function waitSaved(page) {
  await page.locator('.save-state:not(.saving)').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(650);
}

async function projectSnapshot(page) {
  return page.evaluate(async () => {
    const id = document.querySelector('.app-shell')?.getAttribute('data-project-id');
    const projects = await fetch('/api/projects').then((response) => response.json());
    return projects.find((project) => project.id === id);
  });
}

async function dragNode(page, row, deltaX, deltaY) {
  const attributes = await row.evaluate((element) => ({ x: Number(element.dataset.x), y: Number(element.dataset.y), width: Number(element.dataset.width), height: Number(element.dataset.height) }));
  const stage = await page.locator('.canvas-viewport canvas').first().boundingBox();
  assert.ok(stage, 'Editor stage should have a visible canvas');
  const zoom = Number((await page.locator('.canvas-controls span').innerText()).replace('%', '')) / 100;
  const startX = stage.x + (attributes.x + attributes.width / 2) * zoom;
  const startY = stage.y + (attributes.y + attributes.height / 2) * zoom;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 8 });
  await page.mouse.up();
}

test('single and multiple selection preserve object identity', async () => withEditor('selection', async (page) => {
  const firstRow = await addRectangle(page);
  const firstId = await firstRow.getAttribute('data-node-id');
  const secondRow = await addRectangle(page);
  const secondId = await secondRow.getAttribute('data-node-id');
  assert.equal(await page.locator('.layer-row.selected').count(), 1);
  await selectRows(page, [firstId, secondId]);
  assert.equal(await page.locator('.layer-row.selected').count(), 2);
  assert.equal(await page.getByRole('button', { name: 'Group selected objects' }).count(), 1);
}));

test('move by dragging updates the selected object position', async () => withEditor('move', async (page) => {
  const row = await addRectangle(page);
  const originalX = Number(await row.getAttribute('data-x'));
  const originalY = Number(await row.getAttribute('data-y'));
  await dragNode(page, row, 34, 24);
  await page.waitForFunction(({ id, x, y }) => {
    const node = document.querySelector(`.layer-row[data-node-id="${id}"]`);
    return Number(node?.getAttribute('data-x')) !== x && Number(node?.getAttribute('data-y')) !== y;
  }, { id: await row.getAttribute('data-node-id'), x: originalX, y: originalY });
  assert.ok(Number(await row.getAttribute('data-x')) > originalX);
}));

test('resize updates dimensions without replacing the object', async () => withEditor('resize', async (page) => {
  const row = await addRectangle(page);
  const id = await row.getAttribute('data-node-id');
  const originalWidth = Number(await row.getAttribute('data-width'));
  const width = page.locator('.inspector-section .field-row input[type="number"]').nth(2);
  await width.fill(String(originalWidth + 37));
  await page.waitForFunction(({ id, width }) => Number(document.querySelector(`.layer-row[data-node-id="${id}"]`)?.getAttribute('data-width')) === width, { id, width: originalWidth + 37 });
  assert.equal(await row.getAttribute('data-node-id'), id);
}));

test('rotation updates the editable object transform', async () => withEditor('rotate', async (page) => {
  const row = await addRectangle(page);
  const id = await row.getAttribute('data-node-id');
  await page.locator('.inspector-section input.full-input[type="number"]').fill('27');
  await page.waitForFunction(({ id }) => Number(document.querySelector(`.layer-row[data-node-id="${id}"]`)?.getAttribute('data-rotation')) === 27, { id });
}));

test('delete removes selected objects and retains unrelated document state', async () => withEditor('delete', async (page) => {
  const row = await addRectangle(page);
  const id = await row.getAttribute('data-node-id');
  await page.getByRole('button', { name: 'Delete selected objects' }).click();
  assert.equal(await page.locator(`.layer-row[data-node-id="${id}"]`).count(), 0);
  assert.equal(await page.locator('.layer-list .layer-row').count(), 0);
}));

test('duplicate creates a distinct editable copy with preserved properties', async () => withEditor('duplicate', async (page) => {
  const row = await addRectangle(page);
  const id = await row.getAttribute('data-node-id');
  await page.locator('.inspector-section input.full-input[type="number"]').fill('-12');
  await page.getByRole('button', { name: 'Duplicate selected objects' }).click();
  const copy = page.locator('.layer-list .layer-row').first();
  assert.notEqual(await copy.getAttribute('data-node-id'), id);
  assert.equal(await copy.getAttribute('data-rotation'), '-12');
  assert.equal(await page.locator('.layer-list .layer-row').count(), 2);
}));

test('undo and redo restore exact editable object state', async () => withEditor('undo-redo', async (page) => {
  const row = await addRectangle(page);
  const id = await row.getAttribute('data-node-id');
  const before = await row.evaluate((element) => ['data-x', 'data-y', 'data-width', 'data-height', 'data-rotation'].map((key) => element.getAttribute(key)));
  await page.locator('.inspector-section .field-row input[type="number"]').first().fill('245');
  await page.locator('.inspector-section input.full-input[type="number"]').fill('33');
  await page.keyboard.press('Control+z');
  await page.waitForFunction((id) => Number(document.querySelector(`.layer-row[data-node-id="${id}"]`)?.getAttribute('data-rotation')) === 0, id);
  await page.keyboard.press('Control+z');
  await page.waitForFunction((id) => Number(document.querySelector(`.layer-row[data-node-id="${id}"]`)?.getAttribute('data-x')) !== 245, id);
  const undone = await row.evaluate((element) => ['data-x', 'data-y', 'data-width', 'data-height', 'data-rotation'].map((key) => element.getAttribute(key)));
  assert.deepEqual(undone, before);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForFunction((id) => Number(document.querySelector(`.layer-row[data-node-id="${id}"]`)?.getAttribute('data-x')) === 245, id);
  assert.equal(await row.getAttribute('data-rotation'), '0');
}));

test('image crop is non-destructive and survives project persistence', async () => withEditor('image-crop', async (page) => {
  const imageBuffer = await sharp({ create: { width: 160, height: 120, channels: 3, background: '#d0714c' } }).png().toBuffer();
  await page.locator('input[type="file"]').setInputFiles({ name: 'crop-source.png', mimeType: 'image/png', buffer: imageBuffer });
  const row = page.locator('.layer-list .layer-row').first();
  await row.waitFor();
  const id = await row.getAttribute('data-node-id');
  await waitSaved(page);
  const original = await projectSnapshot(page);
  const originalSrc = original.nodes.find((node) => node.id === id).src;
  await page.getByRole('button', { name: 'Crop selected image' }).click();
  await page.getByLabel('Left (%)').fill('20');
  await page.getByLabel('Top (%)').fill('10');
  await page.getByLabel('Width (%)').fill('55');
  await page.getByLabel('Height (%)').fill('65');
  await page.getByRole('button', { name: 'Apply crop' }).click();
  await waitSaved(page);
  const cropped = await projectSnapshot(page);
  const croppedNode = cropped.nodes.find((node) => node.id === id);
  assert.equal(croppedNode.src, originalSrc);
  assert.deepEqual(croppedNode.crop, { x: 0.2, y: 0.1, width: 0.55, height: 0.65 });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('.share-button').click();
  await page.getByRole('button', { name: 'SVG file' }).click();
  const download = await downloadPromise;
  const svgPath = path.join(screenshotDirectory, 'cropped-image.svg');
  await download.saveAs(svgPath);
  const svg = await readFile(svgPath, 'utf8');
  assert.match(svg, /viewBox="32 12 88 78" preserveAspectRatio="none"/);
  await page.reload({ waitUntil: 'networkidle' });
  const reopened = await page.locator(`.layer-row[data-node-id="${id}"]`);
  await reopened.waitFor();
  assert.equal(await reopened.getAttribute('data-crop-x'), '0.2');
  assert.equal(await reopened.getAttribute('data-crop-width'), '0.55');
}));

test('grouping and ungrouping preserve editable nodes and identity', async () => withEditor('group-ungroup', async (page) => {
  const row1 = await addRectangle(page);
  const id1 = await row1.getAttribute('data-node-id');
  const row2 = await addRectangle(page);
  const id2 = await row2.getAttribute('data-node-id');
  await selectRows(page, [id1, id2]);
  await page.getByRole('button', { name: 'Group selected objects' }).click();
  const first = page.locator(`.layer-row[data-node-id="${id1}"]`);
  const second = page.locator(`.layer-row[data-node-id="${id2}"]`);
  const groupId = await first.getAttribute('data-group-id');
  assert.ok(groupId);
  assert.equal(await second.getAttribute('data-group-id'), groupId);
  assert.equal(await page.locator('.layer-list .layer-row').count(), 2);
  await page.getByRole('button', { name: 'Ungroup selected objects' }).click();
  assert.equal(await first.getAttribute('data-group-id'), '');
  assert.equal(await second.getAttribute('data-group-id'), '');
  assert.equal(await page.locator('.layer-list .layer-row').count(), 2);
}));

test('locked objects resist dragging and can be unlocked', async () => withEditor('lock-unlock', async (page) => {
  const row = await addRectangle(page);
  const id = await row.getAttribute('data-node-id');
  const x = await row.getAttribute('data-x');
  await page.getByRole('button', { name: 'Lock selected objects' }).click();
  assert.equal(await row.getAttribute('data-locked'), 'true');
  await dragNode(page, row, 40, 25);
  assert.equal(await row.getAttribute('data-x'), x);
  await page.getByRole('button', { name: 'Unlock selected objects' }).click();
  assert.equal(await row.getAttribute('data-locked'), 'false');
  await dragNode(page, row, 40, 25);
  await page.waitForFunction(({ id, x }) => Number(document.querySelector(`.layer-row[data-node-id="${id}"]`)?.getAttribute('data-x')) > Number(x), { id, x });
  await waitSaved(page);
  await page.reload({ waitUntil: 'networkidle' });
  const reopened = page.locator(`.layer-row[data-node-id="${id}"]`);
  await reopened.waitFor();
  assert.equal(await reopened.getAttribute('data-locked'), 'false');
  assert.ok(Number(await reopened.getAttribute('data-x')) > Number(x));
}));

test('layer order controls change stacking order without changing identity', async () => withEditor('layer-order', async (page) => {
  const bottom = await addRectangle(page);
  const bottomId = await bottom.getAttribute('data-node-id');
  const top = await addRectangle(page);
  const topId = await top.getAttribute('data-node-id');
  assert.equal(await page.locator('.layer-list .layer-row').first().getAttribute('data-node-id'), topId);
  await page.getByRole('button', { name: 'Move selected layers down' }).click();
  const order = await page.locator('.layer-list .layer-row').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-node-id')));
  assert.deepEqual(order, [bottomId, topId]);
}));

test('keyboard shortcuts do not delete or duplicate while editing text fields', async () => withEditor('keyboard-editing', async (page) => {
  const row = await addRectangle(page);
  const id = await row.getAttribute('data-node-id');
  const title = page.locator('.document-title input');
  await title.focus();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+d');
  assert.equal(await page.locator('.layer-list .layer-row').count(), 1);
  assert.equal(await page.locator(`.layer-row[data-node-id="${id}"]`).count(), 1);
  await page.locator('.layer-row').click();
  await page.keyboard.press('Control+d');
  assert.equal(await page.locator('.layer-list .layer-row').count(), 2);
  const copied = await page.locator('.layer-list .layer-row').first().getAttribute('data-node-id');
  await page.locator('.layer-row').filter({ has: page.locator('b', { hasText: 'Rectangle' }) }).nth(1).click();
  const rectangleIds = await page.locator('.layer-row[data-node-type="rect"]').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-node-id')));
  await selectRows(page, rectangleIds);
  await page.keyboard.press('Control+g');
  assert.ok(await page.locator(`.layer-row[data-node-id="${rectangleIds[0]}"]`).getAttribute('data-group-id'));
  await page.keyboard.press('Control+Shift+g');
  assert.equal(await page.locator(`.layer-row[data-node-id="${rectangleIds[0]}"]`).getAttribute('data-group-id'), '');
  assert.equal(await page.locator(`.layer-row[data-node-id="${copied}"]`).count(), 1);
}));

test('multi-selection dragging preserves relative object positions', async () => withEditor('multi-move', async (page) => {
  const first = await addRectangle(page);
  const firstId = await first.getAttribute('data-node-id');
  const second = await addRectangle(page);
  const secondId = await second.getAttribute('data-node-id');
  await page.locator(`.layer-row[data-node-id="${firstId}"]`).click();
  await page.locator(`.layer-row[data-node-id="${secondId}"]`).click({ modifiers: ['Shift'] });
  const before = await page.evaluate(({ firstId, secondId }) => {
    const get = (id) => document.querySelector(`.layer-row[data-node-id="${id}"]`);
    return [Number(get(firstId).getAttribute('data-x')), Number(get(firstId).getAttribute('data-y')), Number(get(secondId).getAttribute('data-x')), Number(get(secondId).getAttribute('data-y'))];
  }, { firstId, secondId });
  await dragNode(page, page.locator(`.layer-row[data-node-id="${secondId}"]`), 42, 28);
  await page.waitForFunction(({ firstId, beforeX }) => Number(document.querySelector(`.layer-row[data-node-id="${firstId}"]`)?.getAttribute('data-x')) !== beforeX, { firstId, beforeX: before[0] });
  const after = await page.evaluate(({ firstId, secondId }) => {
    const get = (id) => document.querySelector(`.layer-row[data-node-id="${id}"]`);
    return [Number(get(firstId).getAttribute('data-x')), Number(get(firstId).getAttribute('data-y')), Number(get(secondId).getAttribute('data-x')), Number(get(secondId).getAttribute('data-y'))];
  }, { firstId, secondId });
  assert.equal(after[2] - after[0], before[2] - before[0], `x relative offsets changed from ${before[2] - before[0]} to ${after[2] - after[0]} (${JSON.stringify({ before, after })})`);
  assert.equal(after[3] - after[1], before[3] - before[1], `y relative offsets changed from ${before[3] - before[1]} to ${after[3] - after[1]} (${JSON.stringify({ before, after })})`);
}));

test('Smart Layout previews and compares alternatives, preserves rejection, applies editably and undoes exactly', async () => withEditor('smart-layout-flow', async (page) => {
  for (let index = 0; index < 10; index += 1) await addRectangle(page);
  await waitSaved(page);
  const before = await page.locator('.layer-row').evaluateAll((rows) => rows.map((row) => ({ id: row.dataset.nodeId, x: row.dataset.x, y: row.dataset.y, width: row.dataset.width, height: row.dataset.height, rotation: row.dataset.rotation })));
  await page.getByRole('button', { name: 'OPTIMIZE' }).click();
  await page.getByTestId('smart-layout-dialog').waitFor();
  assert.equal(await page.locator('.optimizer-grid article').count(), 6);
  assert.ok((await page.locator('.layout-analysis-note').innerText()).includes('pixels and semantic content are not analyzed'));
  for (const mode of ['balanced', 'creative', 'advertising', 'showcase', 'grid', 'minimal']) {
    const card = page.getByTestId(`layout-card-${mode}`);
    assert.ok((await card.innerText()).includes('0 collisions'));
    await card.screenshot({ path: path.join(screenshotDirectory, `smart-layout-${mode}.png`) });
  }
  await page.getByTestId('layout-preview-showcase').click();
  assert.equal(await page.getByTestId('layout-preview-showcase').getAttribute('aria-pressed'), 'true');
  await page.getByTestId('reject-layout').click();
  assert.equal(await page.getByTestId('smart-layout-dialog').count(), 0);
  const afterReject = await page.locator('.layer-row').evaluateAll((rows) => rows.map((row) => ({ id: row.dataset.nodeId, x: row.dataset.x, y: row.dataset.y, width: row.dataset.width, height: row.dataset.height, rotation: row.dataset.rotation })));
  assert.deepEqual(afterReject, before, 'Rejecting alternatives must not change the active project');
  await page.getByRole('button', { name: 'OPTIMIZE' }).click();
  await page.getByTestId('layout-preview-grid').click();
  await page.getByTestId('apply-selected-layout').click();
  await page.waitForFunction((original) => {
    const rows = Array.from(document.querySelectorAll('.layer-row'));
    return rows.some((row, index) => row.dataset.x !== original[index]?.x || row.dataset.y !== original[index]?.y);
  }, before);
  const applied = await page.locator('.layer-row').evaluateAll((rows) => rows.map((row) => ({ id: row.dataset.nodeId, x: row.dataset.x, y: row.dataset.y, width: row.dataset.width, height: row.dataset.height, rotation: row.dataset.rotation })));
  assert.notDeepEqual(applied, before);
  await page.getByTestId('keep-layout').click();
  await page.keyboard.press('Control+z');
  await page.waitForFunction((original) => {
    const rows = Array.from(document.querySelectorAll('.layer-row'));
    return rows.length === original.length && rows.every((row, index) => row.dataset.nodeId === original[index]?.id && row.dataset.x === original[index]?.x && row.dataset.y === original[index]?.y && row.dataset.width === original[index]?.width && row.dataset.height === original[index]?.height && row.dataset.rotation === original[index]?.rotation);
  }, before.map(({ id, ...node }) => ({ id, ...node })));
  const undone = await page.locator('.layer-row').evaluateAll((rows) => rows.map((row) => ({ id: row.dataset.nodeId, x: row.dataset.x, y: row.dataset.y, width: row.dataset.width, height: row.dataset.height, rotation: row.dataset.rotation })));
  assert.deepEqual(undone, before, 'Undo must restore the exact original editable object properties');
}));

test('Smart Layout rejection after choosing a preview never modifies or saves the project', async () => withEditor('smart-layout-reject', async (page) => {
  for (let index = 0; index < 10; index += 1) await addRectangle(page);
  await waitSaved(page);
  const before = await projectSnapshot(page);
  await page.getByRole('button', { name: 'OPTIMIZE' }).click();
  await page.getByTestId('layout-preview-balanced').click();
  await page.getByTestId('reject-layout').click();
  await waitSaved(page);
  const after = await projectSnapshot(page);
  assert.deepEqual(after.nodes, before.nodes);
}));

 test('combined edit, duplicate, group, save, reopen, ungroup, undo and redo retains exact properties', async () => withEditor('combined-reopen', async (page) => {
  const first = await addRectangle(page);
  const firstId = await first.getAttribute('data-node-id');
  const second = await addRectangle(page);
  const secondId = await second.getAttribute('data-node-id');
  await page.locator(`.layer-row[data-node-id="${firstId}"]`).click();
  await page.locator('.inspector-section .field-row input[type="number"]').first().fill('230');
  await page.locator('.inspector-section .field-row input[type="number"]').nth(2).fill('188');
  await page.locator('.inspector-section input.full-input[type="number"]').fill('19');
  await page.getByRole('button', { name: 'Duplicate selected objects' }).click();
  const duplicate = page.locator('.layer-list .layer-row').first();
  const duplicateId = await duplicate.getAttribute('data-node-id');
  await selectRows(page, [firstId, secondId]);
  await page.getByRole('button', { name: 'Group selected objects' }).click();
  const groupId = await page.locator(`.layer-row[data-node-id="${firstId}"]`).getAttribute('data-group-id');
  assert.ok(groupId);
  await page.getByRole('button', { name: 'Lock selected objects' }).click();
  assert.equal(await page.locator(`.layer-row[data-node-id="${secondId}"]`).getAttribute('data-locked'), 'true');
  await page.getByRole('button', { name: 'Unlock selected objects' }).click();
  await waitSaved(page);
  await page.screenshot({ path: path.join(screenshotDirectory, 'combined-before-reopen.png'), fullPage: true });
  const savedProjectId = await page.locator('.app-shell').getAttribute('data-project-id');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction((id) => document.querySelector('.app-shell')?.getAttribute('data-project-id') === id, savedProjectId);
  const reopenedFirst = page.locator(`.layer-row[data-node-id="${firstId}"]`);
  const reopenedSecond = page.locator(`.layer-row[data-node-id="${secondId}"]`);
  await reopenedFirst.waitFor();
  assert.equal(await reopenedFirst.getAttribute('data-group-id'), groupId);
  assert.equal(await reopenedSecond.getAttribute('data-group-id'), groupId);
  assert.equal(await reopenedFirst.getAttribute('data-x'), '230');
  assert.equal(await reopenedFirst.getAttribute('data-width'), '188');
  assert.equal(await reopenedFirst.getAttribute('data-rotation'), '19');
  assert.equal(await page.locator(`.layer-row[data-node-id="${duplicateId}"]`).count(), 1);
  await reopenedFirst.click();
  await page.getByRole('button', { name: 'Ungroup selected objects' }).click();
  assert.equal(await reopenedFirst.getAttribute('data-group-id'), '');
  await page.keyboard.press('Control+z');
  assert.equal(await reopenedFirst.getAttribute('data-group-id'), groupId);
  await page.keyboard.press('Control+y');
  assert.equal(await reopenedFirst.getAttribute('data-group-id'), '');
  await waitSaved(page);
  const final = await projectSnapshot(page);
  const finalFirst = final.nodes.find((node) => node.id === firstId);
  assert.equal(finalFirst.x, 230);
  assert.equal(finalFirst.width, 188);
  assert.equal(finalFirst.rotation, 19);
  assert.equal(final.nodes.length, 3);
}));

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.UI_TEST_URL ?? 'http://127.0.0.1:5173';
const screenshotDirectory = path.join(process.cwd(), 'artifacts', 'smart-layout-certification');
const browser = await chromium.launch({ headless: true });
await mkdir(screenshotDirectory, { recursive: true });
after(() => browser.close());

async function createEditor() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
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
  return { page, errors };
}

async function addRectangle(page) {
  const before = await page.locator('.layer-list .layer-row').count();
  await page.getByRole('button', { name: 'Elements' }).click();
  await page.getByRole('button', { name: 'Rectangle' }).click();
  await page.waitForFunction((count) => document.querySelectorAll('.layer-list .layer-row').length === count + 1, before);
}

async function snapshotRows(page) {
  return page.locator('.layer-list .layer-row').evaluateAll((rows) => rows.map((row) => ({
    id: row.dataset.nodeId,
    x: row.dataset.x,
    y: row.dataset.y,
    width: row.dataset.width,
    height: row.dataset.height,
    rotation: row.dataset.rotation,
  })));
}

async function waitSaved(page) {
  await page.locator('.save-state:not(.saving)').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(650);
}

test('Smart Layout previews six valid alternatives, supports accept/reject, and undo restores the original', async () => {
  const { page, errors } = await createEditor();
  try {
    for (let index = 0; index < 10; index += 1) await addRectangle(page);
    await waitSaved(page);
    const original = await snapshotRows(page);
    await page.getByRole('button', { name: 'OPTIMIZE' }).click();
    await page.getByTestId('smart-layout-dialog').waitFor();
    assert.equal(await page.locator('.optimizer-grid article').count(), 6);
    assert.match(await page.locator('.layout-analysis-note').innerText(), /pixels and semantic content are not analyzed/);
    for (const mode of ['balanced', 'creative', 'advertising', 'showcase', 'grid', 'minimal']) {
      const card = page.getByTestId(`layout-card-${mode}`);
      assert.match(await card.innerText(), /0 collisions/);
      await page.getByTestId(`layout-preview-${mode}`).click();
      assert.equal(await page.getByTestId(`layout-preview-${mode}`).getAttribute('aria-pressed'), 'true');
      await page.getByTestId('selected-layout-preview').screenshot({ path: path.join(screenshotDirectory, `alternative-${mode}.png`) });
    }
    await page.getByTestId('reject-layout').click();
    assert.deepEqual(await snapshotRows(page), original, 'Rejecting previews must not mutate the document');
    await page.getByRole('button', { name: 'OPTIMIZE' }).click();
    await page.getByTestId('layout-preview-grid').click();
    await page.getByTestId('apply-selected-layout').click();
    await page.waitForFunction((before) => Array.from(document.querySelectorAll('.layer-list .layer-row')).some((row, index) => row.dataset.x !== before[index]?.x || row.dataset.y !== before[index]?.y), original);
    const applied = await snapshotRows(page);
    assert.notDeepEqual(applied, original);
    await waitSaved(page);
    await page.getByTestId('keep-layout').click();
    await page.keyboard.press('Control+z');
    await page.waitForFunction((before) => {
      const rows = Array.from(document.querySelectorAll('.layer-list .layer-row'));
      return rows.length === before.length && rows.every((row, index) => row.dataset.nodeId === before[index]?.id && row.dataset.x === before[index]?.x && row.dataset.y === before[index]?.y && row.dataset.width === before[index]?.width && row.dataset.height === before[index]?.height && row.dataset.rotation === before[index]?.rotation);
    }, original);
    assert.deepEqual(await snapshotRows(page), original, 'Undo must restore the exact original objects');
    await waitSaved(page);
    await page.getByRole('button', { name: 'OPTIMIZE' }).click();
    await page.getByTestId('layout-preview-balanced').click();
    await page.getByTestId('reject-layout').click();
    assert.deepEqual(await snapshotRows(page), original, 'Rejecting after preview leaves the current document unchanged');
    assert.deepEqual(errors, [], `Unexpected uncaught browser errors: ${errors.join(' | ')}`);
  } finally {
    const screenshot = path.join(screenshotDirectory, 'smart-layout-editor.png');
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
    await page.close();
    console.log(`Smart Layout screenshots: ${screenshotDirectory}`);
  }
});

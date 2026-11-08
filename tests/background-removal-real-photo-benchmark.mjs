import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evaluationRoot = path.join(root, 'artifacts', 'background-removal-certification', 'real-photo-evaluation');
const resultsRoot = path.join(evaluationRoot, process.env.BG_BENCH_DATASET === 'transparent' ? 'transparent-benchmark-results' : 'benchmark-results');
const manifest = JSON.parse(fs.readFileSync(path.join(evaluationRoot, 'manifest.json'), 'utf8'));
const benchmarkDatasetId = process.env.BG_BENCH_DATASET ?? 'openimages';
const transparentRoot = path.join(root, 'artifacts', 'background-removal-certification', 'transparent-460');
const transparentManifest = benchmarkDatasetId === 'transparent' ? JSON.parse(fs.readFileSync(path.join(transparentRoot, 'manifest.json'), 'utf8')) : null;
const transparentLimit = transparentManifest ? Math.min(transparentManifest.images.length, Number(process.env.BG_BENCH_LIMIT ?? 10)) : 0;
const benchmarkImages = transparentManifest
  ? Array.from({ length: transparentLimit }, (_, index) => transparentManifest.images[Math.floor(index * transparentManifest.images.length / transparentLimit)]).map((entry, index) => ({
    id: `transparent-${String(index + 1).padStart(2, '0')}-${path.basename(entry.image, '.jpg')}`,
    category: 'transparent-objects',
    annotationLabel: 'Transparent object alpha matte',
    author: 'Underlying source photographer not independently verified',
    source: entry.provenance,
    license: transparentManifest.license,
    imagePath: `artifacts/background-removal-certification/transparent-460/${entry.image}`,
    referenceMaskPath: `artifacts/background-removal-certification/transparent-460/${entry.alpha}`,
  }))
  : manifest.images;
const benchmarkDataset = transparentManifest ? {
  dataset: transparentManifest.dataset,
  datasetSource: transparentManifest.source,
  datasetLicense: transparentManifest.license,
  annotationLicense: 'Dataset-provided paired alpha mattes; same non-commercial dataset terms apply.',
  categoryAvailability: [{ category: 'transparent-objects', requested: benchmarkImages.length, selected: benchmarkImages.length }],
} : manifest;
const baseUrl = process.env.BG_BENCH_URL ?? 'http://127.0.0.1:5174';
const allModels = [
  { id: 'universal', name: 'BiRefNet Lite' },
  { id: 'portrait', name: 'MODNet' },
];
const models = process.env.BG_BENCH_MODEL ? allModels.filter((model) => model.id === process.env.BG_BENCH_MODEL) : allModels;
assert.ok(models.length, `Unknown benchmark model: ${process.env.BG_BENCH_MODEL}`);
const browserErrors = [];
const modelResponses = [];
const results = [];
const pageSize = 512;

function dataUrl(filePath, mimeType) {
  return `data:${mimeType};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * ratio))];
}

function summarize(items) {
  const categories = [...new Set(items.map((item) => item.category))].sort();
  const categoryMetrics = categories.map((category) => {
    const group = items.filter((item) => item.category === category);
    const passed = group.filter((item) => item.status === 'ok');
    const mean = (field) => passed.length ? passed.reduce((total, item) => total + item.metrics[field], 0) / passed.length : null;
    const warm = passed.filter((item) => !item.coldStart).map((item) => item.durationMs);
    return {
      category,
      requested: benchmarkDataset.categoryAvailability.find((entry) => entry.category === category)?.requested ?? null,
      available: group.length,
      succeeded: passed.length,
      failed: group.length - passed.length,
      meanIoU: mean('iou'),
      meanDice: mean('dice'),
      meanBoundaryF1: mean('boundaryF1'),
      coldStartMilliseconds: passed.find((item) => item.coldStart)?.durationMs ?? null,
      medianWarmMilliseconds: percentile(warm, 0.5),
      p95WarmMilliseconds: percentile(warm, 0.95),
      outputResolutions: [...new Set(passed.map((item) => `${item.outputWidth}x${item.outputHeight}`))],
    };
  });
  const successful = items.filter((item) => item.status === 'ok');
  const warmTimes = successful.filter((item) => !item.coldStart).map((item) => item.durationMs);
  return {
    model: items[0]?.model ?? 'unknown',
    attempted: items.length,
    succeeded: successful.length,
    failures: items.filter((item) => item.status !== 'ok').map(({ imageId, category, error }) => ({ imageId, category, error })),
    meanIoU: successful.length ? successful.reduce((total, item) => total + item.metrics.iou, 0) / successful.length : null,
    meanDice: successful.length ? successful.reduce((total, item) => total + item.metrics.dice, 0) / successful.length : null,
    meanBoundaryF1: successful.length ? successful.reduce((total, item) => total + item.metrics.boundaryF1, 0) / successful.length : null,
    coldStartMilliseconds: successful.find((item) => item.coldStart)?.durationMs ?? null,
    medianWarmMilliseconds: percentile(warmTimes, 0.5),
    p95WarmMilliseconds: percentile(warmTimes, 0.95),
    categoryMetrics,
  };
}

fs.mkdirSync(resultsRoot, { recursive: true });
for (const entry of benchmarkImages) {
  if (!transparentManifest) assert.equal(entry.license, 'https://creativecommons.org/licenses/by/2.0/', `Unapproved photo license in dataset: ${entry.id}`);
  assert.ok(fs.existsSync(path.join(root, entry.imagePath)), `Missing photo ${entry.imagePath}`);
  assert.ok(fs.existsSync(path.join(root, entry.referenceMaskPath)), `Missing mask ${entry.referenceMaskPath}`);
}
for (const model of models) {
  const modelOutput = [];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (error) => browserErrors.push(`${model.name}: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(`${model.name}: ${message.text()}`); });
  page.on('response', (response) => {
    if (response.url().includes('/models/')) modelResponses.push({ model: model.name, status: response.status(), url: response.url(), contentType: response.headers()['content-type'] });
  });
  try {
    const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    assert.equal(response?.status(), 200, `Application did not load at ${baseUrl}`);
    await page.waitForSelector('canvas', { timeout: 30_000 });
    await page.evaluate(async () => { await import('/src/background-removal.ts'); });
    for (let index = 0; index < benchmarkImages.length; index += 1) {
      const item = benchmarkImages[index];
      const imagePath = path.join(root, item.imagePath);
      const referencePath = path.join(root, item.referenceMaskPath);
      const imageData = dataUrl(imagePath, 'image/jpeg');
      const referenceData = dataUrl(referencePath, 'image/png');
      const coldStart = index === 0;
      try {
        const result = await page.evaluate(async ({ imageData, referenceData, modelId, pageSize }) => {
          const decode = async (source) => {
            const image = new Image();
            image.src = source;
            await image.decode();
            return image;
          };
          const toBinary = async (source, threshold) => {
            const image = await decode(source);
            const canvas = document.createElement('canvas');
            canvas.width = pageSize;
            canvas.height = pageSize;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) throw new Error('Canvas unavailable for metric calculation.');
            context.drawImage(image, 0, 0, pageSize, pageSize);
            const rgba = context.getImageData(0, 0, pageSize, pageSize).data;
            const binary = new Uint8Array(pageSize * pageSize);
            for (let index = 0; index < binary.length; index += 1) binary[index] = rgba[index * 4] >= threshold ? 1 : 0;
            return binary;
          };
          const started = performance.now();
          const imageResponse = await fetch(imageData);
          const blob = await imageResponse.blob();
          const { segmentForeground } = await import('/src/background-removal.ts');
          const prediction = await segmentForeground(blob, modelId);
          const durationMs = performance.now() - started;
          const predictedBinary = new Uint8Array(pageSize * pageSize);
          const outputCanvas = document.createElement('canvas');
          outputCanvas.width = prediction.width;
          outputCanvas.height = prediction.height;
          const outputContext = outputCanvas.getContext('2d');
          if (!outputContext) throw new Error('Canvas unavailable for predicted mask encoding.');
          const pixels = outputContext.createImageData(prediction.width, prediction.height);
          for (let index = 0; index < prediction.mask.length; index += 1) {
            const offset = index * 4;
            pixels.data[offset] = prediction.mask[index];
            pixels.data[offset + 1] = prediction.mask[index];
            pixels.data[offset + 2] = prediction.mask[index];
            pixels.data[offset + 3] = 255;
          }
          outputContext.putImageData(pixels, 0, 0);
          const outputPng = await new Promise((resolve, reject) => outputCanvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not encode predicted mask.')), 'image/png'));
          const outputBuffer = await outputPng.arrayBuffer();
          const outputBytes = new Uint8Array(outputBuffer);
          let binary = '';
          for (let offset = 0; offset < outputBytes.length; offset += 32768) binary += String.fromCharCode(...outputBytes.subarray(offset, Math.min(offset + 32768, outputBytes.length)));
          const outputMaskBase64 = btoa(binary);
          const predicted = await toBinary(`data:image/png;base64,${outputMaskBase64}`, 128);
          const reference = await toBinary(referenceData, 128);
          let intersection = 0;
          let union = 0;
          let predictedCount = 0;
          let referenceCount = 0;
          for (let index = 0; index < predicted.length; index += 1) {
            const predictedForeground = predicted[index] === 1;
            const referenceForeground = reference[index] === 1;
            if (predictedForeground) predictedCount += 1;
            if (referenceForeground) referenceCount += 1;
            if (predictedForeground && referenceForeground) intersection += 1;
            if (predictedForeground || referenceForeground) union += 1;
          }
          const makeBoundary = (mask) => {
            const boundary = [];
            for (let y = 1; y < pageSize - 1; y += 1) for (let x = 1; x < pageSize - 1; x += 1) {
              const position = y * pageSize + x;
              if (mask[position] && (!mask[position - 1] || !mask[position + 1] || !mask[position - pageSize] || !mask[position + pageSize])) boundary.push(position);
            }
            return boundary;
          };
          const predictedBoundary = makeBoundary(predicted);
          const referenceBoundary = makeBoundary(reference);
          const within = (position, mask) => {
            const x = position % pageSize;
            const y = Math.floor(position / pageSize);
            for (let offsetY = -2; offsetY <= 2; offsetY += 1) for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
              const candidateX = x + offsetX;
              const candidateY = y + offsetY;
              if (candidateX >= 0 && candidateX < pageSize && candidateY >= 0 && candidateY < pageSize && mask[candidateY * pageSize + candidateX]) return true;
            }
            return false;
          };
          let predictedMatched = 0;
          let referenceMatched = 0;
          for (const position of predictedBoundary) if (within(position, reference)) predictedMatched += 1;
          const predictedBoundaryMask = new Uint8Array(pageSize * pageSize);
          for (const position of predictedBoundary) predictedBoundaryMask[position] = 1;
          for (const position of referenceBoundary) if (within(position, predictedBoundaryMask)) referenceMatched += 1;
          const precision = predictedBoundary.length ? predictedMatched / predictedBoundary.length : 0;
          const recall = referenceBoundary.length ? referenceMatched / referenceBoundary.length : 0;
          const boundaryF1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
          return {
            width: prediction.width,
            height: prediction.height,
            durationMs,
            mask: outputMaskBase64,
            metrics: {
              iou: union ? intersection / union : 0,
              dice: predictedCount + referenceCount ? 2 * intersection / (predictedCount + referenceCount) : 0,
              boundaryF1,
              predictedForegroundRatio: predictedCount / predicted.length,
              referenceForegroundRatio: referenceCount / reference.length,
              boundaryToleranceAt512Px: 2,
            },
          };
        }, { imageData, referenceData, modelId: model.id, pageSize });
        const maskPath = path.join(resultsRoot, `${item.id}-${model.id}.png`);
        const maskBytes = Buffer.from(result.mask, 'base64');
        fs.writeFileSync(maskPath, maskBytes);
        const record = {
          imageId: item.id,
          category: item.category,
          annotationLabel: item.annotationLabel,
          author: item.author,
          source: item.source,
          license: item.license,
          model: model.name,
          status: 'ok',
          coldStart,
          durationMs: Math.round(result.durationMs),
          outputWidth: result.width,
          outputHeight: result.height,
          outputMaskPath: path.relative(root, maskPath).replaceAll('\\', '/'),
          metrics: result.metrics,
        };
        modelOutput.push(record);
        results.push(record);
        console.log(JSON.stringify({ model: model.name, image: item.id, category: item.category, milliseconds: record.durationMs, iou: Number(record.metrics.iou.toFixed(4)), dice: Number(record.metrics.dice.toFixed(4)), boundaryF1: Number(record.metrics.boundaryF1.toFixed(4)), coldStart }));
      } catch (error) {
        const record = { imageId: item.id, category: item.category, model: model.name, status: 'failed', error: error instanceof Error ? error.message : String(error), coldStart };
        modelOutput.push(record);
        results.push(record);
        console.error(JSON.stringify(record));
      }
    }
  } finally {
    await browser.close();
  }
  const modelSummary = summarize(modelOutput);
  fs.writeFileSync(path.join(resultsRoot, `${model.id}-summary.json`), `${JSON.stringify(modelSummary, null, 2)}\n`);
  console.log(JSON.stringify({ summary: modelSummary }, null, 2));
}

const screenshotSheets = [];
for (const category of [...new Set(benchmarkImages.map((item) => item.category))]) {
  const entries = benchmarkImages.filter((item) => item.category === category);
  const cells = [];
  const labels = ['Photo', 'Reference', 'BiRefNet Lite', 'MODNet'];
  const cellWidth = 276;
  const imageHeight = 196;
  for (let rowIndex = 0; rowIndex < entries.length; rowIndex += 1) {
    const entry = entries[rowIndex];
    const row = [
      path.join(root, entry.imagePath),
      path.join(root, entry.referenceMaskPath),
      path.join(resultsRoot, `${entry.id}-universal.png`),
      path.join(resultsRoot, `${entry.id}-portrait.png`),
    ];
    for (let column = 0; column < row.length; column += 1) {
      if (!fs.existsSync(row[column])) continue;
      const input = await sharp(row[column]).rotate().resize(cellWidth - 8, imageHeight - 8, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
      const label = Buffer.from(`<svg width="${cellWidth}" height="28"><rect width="100%" height="100%" fill="#f1f2f4"/><text x="8" y="19" font-family="Arial" font-size="13" fill="#20242a">${labels[column]}</text></svg>`);
      const content = await sharp({ create: { width: cellWidth, height: imageHeight, channels: 4, background: '#fff' } }).composite([{ input: label, top: 0, left: 0 }, { input, top: 28, left: 4 }]).png().toBuffer();
      cells.push({ input: content, left: column * cellWidth, top: rowIndex * imageHeight });
    }
  }
  const sheetPath = path.join(resultsRoot, `${category}-comparison.png`);
  await sharp({ create: { width: cellWidth * 4, height: imageHeight * entries.length, channels: 4, background: '#ffffff' } }).composite(cells).png().toFile(sheetPath);
  screenshotSheets.push(path.relative(root, sheetPath).replaceAll('\\', '/'));
}

for (const model of models) {
  const modelOutput = results.filter((item) => item.model === model.name);
  const modelSummary = summarize(modelOutput);
  fs.writeFileSync(path.join(resultsRoot, `${model.id}-summary.json`), `${JSON.stringify(modelSummary, null, 2)}\n`);
}
const summary = {
  dataset: benchmarkDataset.dataset,
  datasetSource: benchmarkDataset.datasetSource,
  datasetLicense: benchmarkDataset.datasetLicense,
  annotationLicense: benchmarkDataset.annotationLicense,
  imageCount: benchmarkImages.length,
  categoryAvailability: benchmarkDataset.categoryAvailability,
  metricsResolution: `${pageSize}x${pageSize}`,
  boundaryMetric: 'Symmetric boundary F1 with a 2-pixel tolerance after resizing masks to 512x512.',
  latencyMethod: 'Browser wall-clock time around local worker inference; first image per model includes cold model initialization, remaining images are warm timings.',
  memory: 'Peak process RAM and WebAssembly memory were not measured. Browser JavaScript heap is not an adequate proxy for ONNX/WASM model memory.',
  models: allModels.map((model) => JSON.parse(fs.readFileSync(path.join(resultsRoot, `${model.id}-summary.json`), 'utf8'))),
  browserErrors,
  modelResponses,
  screenshots: screenshotSheets,
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(resultsRoot, 'benchmark-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
assert.equal(results.length, benchmarkImages.length * models.length, 'Every model/image pair must have a recorded result.');
assert.deepEqual(browserErrors, [], `Browser errors occurred: ${browserErrors.join(' | ')}`);
console.log(JSON.stringify({ output: path.relative(root, path.join(resultsRoot, 'benchmark-summary.json')).replaceAll('\\', '/'), summary }, null, 2));

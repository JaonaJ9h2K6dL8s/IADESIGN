import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const datasetRoot = path.join(repositoryRoot, 'artifacts', 'background-removal-certification');
const evaluationRoot = path.join(datasetRoot, 'real-photo-evaluation');
const imageRoot = path.join(evaluationRoot, 'images');
const maskRoot = path.join(evaluationRoot, 'masks');
const extractedRoot = path.join(evaluationRoot, 'mask-archive-temp');
const annotationsPath = path.join(datasetRoot, 'openimages-validation-masks.csv');
const imageMetadataPath = path.join(datasetRoot, 'openimages-validation-images.csv');
const categoryDefinitions = [
  { id: 'bottles', labelNames: ['Bottle', 'Glass bottle', 'Plastic bottle'] },
  { id: 'mugs-tumblers', labelNames: ['Mug', 'Cup (container)'] },
  { id: 'clothing', labelNames: ['Clothing'] },
  { id: 'shoes-accessories', labelNames: ['Shoe', 'Footwear', 'Handbag'] },
  { id: 'packaging-boxes', labelNames: ['Box', 'Cardboard box'] },
  { id: 'jars-containers', labelNames: ['Jar', 'Container'] },
  { id: 'transparent-objects', labelNames: ['Glass bottle', 'Wine glass', 'Beer glass'] },
  { id: 'reflective-objects', labelNames: ['Mirror', 'Sunglasses'] },
  { id: 'hair-portraits', labelNames: ['Person'] },
  { id: 'complex-backgrounds', labelNames: ['Person', 'Shoe', 'Bottle', 'Chair'] },
];

function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell);
  return cells;
}

function readCsvRows(filePath) {
  const [headerLine, ...lines] = fs.readFileSync(filePath, 'utf8').trimEnd().split(/\r?\n/);
  const headers = parseCsvLine(headerLine);
  return lines.map((line) => Object.fromEntries(parseCsvLine(line).map((value, index) => [headers[index], value])));
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: evaluationRoot, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout || result.error}`);
}

function download(url, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination) && fs.statSync(destination).size > 1024) return;
  run('curl.exe', ['--fail', '--location', '--silent', '--show-error', '--retry', '2', '--output', destination, url]);
}

assert.ok(fs.existsSync(annotationsPath), 'Open Images validation mask annotations must be downloaded first.');
assert.ok(fs.existsSync(imageMetadataPath), 'Open Images validation image metadata must be downloaded first.');
fs.mkdirSync(imageRoot, { recursive: true });
fs.mkdirSync(maskRoot, { recursive: true });

const metadata = new Map(readCsvRows(imageMetadataPath).map((row) => [row.ImageID, row]));
const maskRows = readCsvRows(annotationsPath);
const labelsById = new Map();
for (const [mid, name] of readCsvRows(path.join(datasetRoot, 'openimages-class-descriptions.csv')).map((row) => [row.LabelName, row.DisplayName])) labelsById.set(mid, name);
const instanceCounts = new Map();
for (const row of maskRows) {
  const key = `${row.ImageID}:${row.LabelName}`;
  instanceCounts.set(key, (instanceCounts.get(key) ?? 0) + 1);
}
const rowsByLabel = new Map();
for (const row of maskRows) {
  const labelName = labelsById.get(row.LabelName);
  const image = metadata.get(row.ImageID);
  if (!labelName || !image || image.License !== 'https://creativecommons.org/licenses/by/2.0/' || instanceCounts.get(`${row.ImageID}:${row.LabelName}`) !== 1) continue;
  const list = rowsByLabel.get(labelName) ?? [];
  list.push({ ...row, labelName, image });
  rowsByLabel.set(labelName, list);
}

const selected = [];
const usedImageIds = new Set();
const categoryAvailability = [];
for (const category of categoryDefinitions) {
  const candidateByImage = new Map();
  for (const row of category.labelNames.flatMap((labelName) => rowsByLabel.get(labelName) ?? [])) {
    if (!usedImageIds.has(row.ImageID) && !candidateByImage.has(row.ImageID)) candidateByImage.set(row.ImageID, row);
  }
  const candidates = [...candidateByImage.values()]
    .sort((left, right) => stableHash(`${category.id}:${left.ImageID}`) - stableHash(`${category.id}:${right.ImageID}`));
  const picked = candidates.slice(0, 2);
  for (const row of picked) {
    usedImageIds.add(row.ImageID);
    selected.push({
      id: row.ImageID,
      category: category.id,
      annotationLabel: row.labelName,
      maskFile: row.MaskPath,
      imageFile: `${row.ImageID}.jpg`,
      source: row.image.OriginalLandingURL,
      imageSourceUrl: `https://open-images-dataset.s3.amazonaws.com/validation/${row.ImageID}.jpg`,
      license: row.image.License,
      author: row.image.Author,
      title: row.image.Title,
      authorProfile: row.image.AuthorProfileURL,
      annotationSource: 'Open Images V5 validation object-segmentation annotation',
    });
  }
  categoryAvailability.push({ category: category.id, requested: 2, selected: picked.length, labels: [...new Set(picked.map((row) => row.labelName))] });
}

assert.ok(selected.length > 0, 'No usable licensed photos with segmentation masks were found.');
const maskShards = [...new Set(selected.map((row) => row.id[0].toLowerCase()))].sort();
for (const shard of maskShards) {
  const archive = path.join(evaluationRoot, `validation-masks-${shard}.zip`);
  download(`https://storage.googleapis.com/openimages/v5/validation-masks/validation-masks-${shard}.zip`, archive);
  fs.mkdirSync(extractedRoot, { recursive: true });
  run('tar.exe', ['-xf', archive, '-C', extractedRoot]);
}

for (const item of selected) {
  const imagePath = path.join(imageRoot, item.imageFile);
  download(item.imageSourceUrl, imagePath);
  const extractedMaskPath = path.join(extractedRoot, item.maskFile);
  assert.ok(fs.existsSync(extractedMaskPath), `Reference mask missing from downloaded archive: ${item.maskFile}`);
  const referencePath = path.join(maskRoot, `${item.id}.png`);
  fs.copyFileSync(extractedMaskPath, referencePath);
  item.imagePath = path.relative(repositoryRoot, imagePath).replaceAll('\\', '/');
  item.referenceMaskPath = path.relative(repositoryRoot, referencePath).replaceAll('\\', '/');
}

const manifest = {
  dataset: 'Open Images V5 validation object-segmentation subset',
  createdAt: new Date().toISOString(),
  selection: 'Deterministic FNV-1a order within target classes; up to two distinct images per category; only per-image CC BY 2.0 licenses accepted.',
  datasetSource: 'https://storage.googleapis.com/openimages/web/download_v7.html',
  imageDownloadInstructions: 'https://github.com/openimages/dataset/blob/master/downloader.py',
  datasetLicense: 'Each selected photograph is individually listed as CC BY 2.0 in the Open Images image metadata; credit the author and landing page recorded per row.',
  annotationLicense: 'Open Images annotations are licensed by Google under CC BY 4.0.',
  categoryAvailability,
  images: selected,
};
fs.writeFileSync(path.join(evaluationRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
fs.rmSync(extractedRoot, { recursive: true, force: true });
console.log(JSON.stringify({ imageCount: selected.length, maskShardCount: maskShards.length, categoryAvailability }, null, 2));

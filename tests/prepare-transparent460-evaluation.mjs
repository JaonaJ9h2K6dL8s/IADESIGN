import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const datasetRoot = path.join(repositoryRoot, 'artifacts', 'background-removal-certification', 'transparent-460');
const inputRoot = path.join(datasetRoot, 'Test');
const imageRoot = path.join(inputRoot, 'fg');
const alphaRoot = path.join(inputRoot, 'alpha');
const namesPath = path.join(inputRoot, 'transparent-460-test-fg-names.txt');
const baseUrl = 'https://huggingface.co/datasets/Thinnaphat/transparent-460/resolve/main/Test';

function download(url, destination) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(destination) && fs.statSync(destination).size > 1024) return resolve();
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const child = spawn('curl.exe', ['--fail', '--location', '--silent', '--show-error', '--retry', '2', '--output', destination, url], { windowsHide: true });
    let error = '';
    child.stderr.on('data', (chunk) => { error += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`curl failed for ${url}: ${error}`)));
  });
}

await download(`${baseUrl}/transparent-460-test-fg-names.txt`, namesPath);
const names = fs.readFileSync(namesPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
assert.equal(names.length, 50, 'The official Transparent-460 test split should list 50 foreground images.');
const pending = [...names];
const workers = Array.from({ length: 6 }, async () => {
  while (pending.length) {
    const name = pending.shift();
    const alphaName = name.replace(/\.jpg$/i, '.png');
    await Promise.all([
      download(`${baseUrl}/fg/${name}`, path.join(imageRoot, name)),
      download(`${baseUrl}/alpha/${alphaName}`, path.join(alphaRoot, alphaName)),
    ]);
  }
});
await Promise.all(workers);
const images = names.map((name) => ({
  image: `Test/fg/${name}`,
  alpha: `Test/alpha/${name.replace(/\.jpg$/i, '.png')}`,
  provenance: `https://huggingface.co/datasets/Thinnaphat/transparent-460/resolve/main/Test/fg/${name}`,
  reference: `https://huggingface.co/datasets/Thinnaphat/transparent-460/resolve/main/Test/alpha/${name.replace(/\.jpg$/i, '.png')}`,
}));
fs.writeFileSync(path.join(datasetRoot, 'manifest.json'), `${JSON.stringify({
  dataset: 'Transparent-460 official test split',
  split: 'Test',
  imageCount: images.length,
  source: 'https://huggingface.co/datasets/Thinnaphat/transparent-460',
  originalPublication: 'TransMatting: Enhancing Transparent Objects Matting with Transformers, ECCV 2022',
  license: 'transparent-460-non-commercial; non-commercial research use only; no public redistribution; internal use within one organization only.',
  warning: 'Use only for internal non-commercial quality evaluation. The dataset owners state source images were collected from the Internet and disclaim responsibility for the underlying image rights; each original photo rightsholder/license has not been independently verified.',
  selection: 'All 50 official test foreground images and their paired grayscale alpha mattes; no background composites are included in this evaluation subset.',
  images,
}, null, 2)}\n`);
console.log(JSON.stringify({ imageCount: images.length, imageRoot, alphaRoot }, null, 2));

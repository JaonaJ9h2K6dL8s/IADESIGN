import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { convertToCmyk, convertToSrgbJpeg, convertToSrgbPng } from '../electron/color-engine';
import { validateProviderSettings } from '../electron/ai-provider';
import { createLayoutAlternatives } from '../src/optimizer';
import { outputPixelSize, validatePrint } from '../src/print-engine';
import { createStarterProject, productTemplates, validateProductTemplate } from '../src/product-templates';
import { getArtworkCropBounds, getPreviewCameraPosition, resolvePreviewRegion } from '../src/product-preview';

async function sampleImage() {
  return sharp({ create: { width: 8, height: 6, channels: 4, background: { r: 220, g: 80, b: 45, alpha: 0.75 } } }).png().toBuffer();
}

test('sRGB PNG and JPEG exports carry a real ICC profile and requested resolution', async () => {
  const source = await sampleImage();
  const png = await convertToSrgbPng(source, 300);
  const pngMetadata = await sharp(png.data).metadata();
  assert.equal(pngMetadata.space, 'srgb');
  assert.ok(pngMetadata.icc?.length);
  assert.equal(pngMetadata.density, 300);
  assert.equal(pngMetadata.hasAlpha, true);

  const jpeg = await convertToSrgbJpeg(source, 150);
  const jpegMetadata = await sharp(jpeg.data).metadata();
  assert.equal(jpegMetadata.space, 'srgb');
  assert.ok(jpegMetadata.icc?.length);
  assert.equal(jpegMetadata.density, 150);
});

test('CMYK export changes channel space and embeds its ICC profile', async () => {
  const conversion = await convertToCmyk(await sampleImage(), 300);
  const metadata = await sharp(conversion.data).metadata();
  assert.equal(metadata.space, 'cmyk');
  assert.equal(metadata.channels, 4);
  assert.ok(metadata.icc?.length);
  assert.ok(conversion.iccProfile.length > 0);
  assert.equal(metadata.density, 300);
  const lowerDpi = await convertToCmyk(await sampleImage(), 150);
  const lowerDpiMetadata = await sharp(lowerDpi.data).metadata();
  assert.equal(lowerDpiMetadata.space, 'cmyk');
  assert.equal(lowerDpiMetadata.density, 150);
});

test('60 cm square production output is calculated correctly at 150 and 300 DPI', () => {
  const project = { ...createStarterProject(), physicalWidthMm: 600, physicalHeightMm: 600 };
  assert.deepEqual(outputPixelSize({ ...project, printSettings: { ...project.printSettings!, resolutionDpi: 150 } }, 150), { width: 3543, height: 3543 });
  assert.deepEqual(outputPixelSize(project, 300), { width: 7087, height: 7087 });
  assert.ok(validatePrint(project).every((warning) => warning.code !== 'OUTPUT_TOO_LARGE'));
  const unsafe = { ...project, nodes: [{ ...project.nodes[0], x: 0 }] };
  assert.ok(validatePrint(unsafe).some((warning) => warning.code === 'SAFE_AREA'));
});

test('Smart Layout creates six distinct reversible compositions while honoring locked objects', () => {
  const project = createStarterProject();
  const locked = { ...project.nodes[0], locked: true };
  const source = { ...project, nodes: [locked, ...project.nodes.slice(1)] };
  const generated = createLayoutAlternatives(source);
  const alternatives = generated.alternatives;
  assert.ok(alternatives.length > 0 && alternatives.length <= 6);
  if (alternatives.length < 6) assert.ok(generated.explanation);
  assert.equal(new Set(alternatives.map((alternative) => alternative.mode)).size, alternatives.length);
  assert.ok(new Set(alternatives.map((alternative) => alternative.project.nodes.slice(1).map((node) => `${Math.round(node.x)}:${Math.round(node.y)}`).join('|'))).size > 1);
  for (const alternative of alternatives) {
    assert.deepEqual(alternative.project.nodes[0], locked);
    for (const node of alternative.project.nodes.slice(1)) {
      assert.ok(node.x >= 0 && node.y >= 0 && node.width > 0 && node.height > 0);
      assert.ok(node.x + node.width <= project.width + 1);
      assert.ok(node.y + node.height <= project.height + 1);
    }
  }
});

test('built-in product templates validate physical dimensions, normalized regions and UV bounds', () => {
  const required = new Set(['poster', 'sticker', 'packaging', 'bottle', 'mug', 'jar', 'tshirt', 'hoodie', 'sweatshirt']);
  assert.ok([...required].every((id) => productTemplates.some((template) => template.id === id)), 'all requested product templates should be present');
  for (const template of productTemplates.filter((item) => required.has(item.id))) {
    assert.deepEqual(validateProductTemplate(template), [], `${template.id} should pass template validation`);
    assert.ok(template.widthMm >= 10 && template.heightMm >= 10);
    for (const region of template.regions) {
      assert.ok(region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0);
      assert.ok(region.x + region.width <= 1);
      assert.ok(region.y + region.height <= 1);
      if (region.uv) {
        assert.ok(region.uv.x >= 0 && region.uv.y >= 0 && region.uv.width > 0 && region.uv.height > 0);
        assert.ok(region.uv.x + region.uv.width <= 1 && region.uv.y + region.uv.height <= 1);
      }
    }
  }
});

test('template validation rejects invalid physical size, printable regions and UV mapping', () => {
  const poster = productTemplates.find((item) => item.id === 'poster')!;
  const invalid = { ...poster, widthMm: 0, regions: [{ ...poster.regions[0], x: 0.9, width: 0.2, uv: { x: 0, y: 0, width: 1.2, height: 1 } }] };
  assert.ok(validateProductTemplate(invalid).some((message) => message.includes('Physical dimensions')));
  assert.ok(validateProductTemplate(invalid).some((message) => message.includes('normalized artwork bounds')));
  assert.ok(validateProductTemplate(invalid).some((message) => message.includes('UV mapping')));
});

test('garment preview selects isolated front and back artwork and faces each printed plane', () => {
  for (const template of productTemplates.filter((item) => ['tshirt', 'hoodie', 'sweatshirt'].includes(item.kind))) {
    const front = resolvePreviewRegion(template, 'front');
    const back = resolvePreviewRegion(template, 'back');
    assert.equal(front.surface, 'front');
    assert.equal(back.surface, 'back');
    assert.notDeepEqual(getArtworkCropBounds(front), getArtworkCropBounds(back));

    const frontCamera = getPreviewCameraPosition(template, 'front');
    const backCamera = getPreviewCameraPosition(template, 'back');
    assert.deepEqual(backCamera, [-frontCamera[0], frontCamera[1], -frontCamera[2]]);
    assert.notDeepEqual(frontCamera, backCamera);
  }
});

test('legacy templates without garment surfaces retain a safe first-region fallback', () => {
  const legacyTemplate = { ...productTemplates.find((item) => item.id === 'tshirt')!, regions: [productTemplates.find((item) => item.id === 'tshirt')!.regions[0]] };
  assert.equal(resolvePreviewRegion(legacyTemplate, 'front'), legacyTemplate.regions[0]);
  assert.equal(resolvePreviewRegion(legacyTemplate, 'back'), legacyTemplate.regions[0]);
  assert.deepEqual(getArtworkCropBounds(), { x: 0, y: 0, width: 1, height: 1 });
});

test('textile product regions expose front, back, and sleeve artwork surfaces', () => {
  for (const template of productTemplates.filter((item) => ['tshirt', 'hoodie', 'sweatshirt'].includes(item.kind))) {
    assert.deepEqual(new Set(template.regions.map((region) => region.surface)), new Set(['front', 'back', 'left-sleeve', 'right-sleeve']));
  }
});

test('provider configuration accepts public HTTPS and rejects insecure or private targets', () => {
  assert.deepEqual(validateProviderSettings({ baseUrl: 'https://api.openai.com/v1/', textModel: ' text ', imageModel: ' image ' }), {
    baseUrl: 'https://api.openai.com/v1', textModel: 'text', imageModel: 'image',
  });
  assert.throws(() => validateProviderSettings({ baseUrl: 'http://api.example.com/v1', textModel: 'text', imageModel: 'image' }), /HTTPS/);
  assert.throws(() => validateProviderSettings({ baseUrl: 'https://127.0.0.1:8443/v1', textModel: 'text', imageModel: 'image' }), /Private network/);
  assert.throws(() => validateProviderSettings({ baseUrl: 'https://172.31.255.255/v1', textModel: 'text', imageModel: 'image' }), /Private network/);
  assert.throws(() => validateProviderSettings({ baseUrl: 'https://100.64.0.1/v1', textModel: 'text', imageModel: 'image' }), /Private network/);
  assert.throws(() => validateProviderSettings({ baseUrl: 'https://[::1]/v1', textModel: 'text', imageModel: 'image' }), /Private network/);
  assert.throws(() => validateProviderSettings({ baseUrl: 'https://service.internal/v1', textModel: 'text', imageModel: 'image' }), /Private network/);
});

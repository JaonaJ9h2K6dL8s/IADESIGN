import type { DesignProject, ProductKind, ProductModel, PrintableRegion } from './types';

export type ProductTemplate = {
  id: string;
  name: string;
  kind: ProductKind;
  model: ProductModel;
  widthMm: number;
  heightMm: number;
  regions: PrintableRegion[];
  surface: 'flat' | 'curved' | 'fabric' | 'box';
  camera: [number, number, number];
};

const fullSurface = (name = 'Printable surface', surface?: PrintableRegion['surface']): PrintableRegion[] => [{ id: 'surface', name, x: 0.04, y: 0.04, width: 0.92, height: 0.92, ...(surface ? { surface } : {}) }];

export const productTemplates: ProductTemplate[] = [
  { id: 'poster', name: 'Poster · A4', kind: 'poster', model: 'flat', widthMm: 210, heightMm: 297, regions: fullSurface(), surface: 'flat', camera: [0, 0, 5] },
  { id: 'tshirt', name: 'T-shirt · front print', kind: 'tshirt', model: 'shirt', widthMm: 300, heightMm: 380, regions: [{ id: 'front', name: 'Front', x: 0.2, y: 0.04, width: 0.6, height: 0.43, surface: 'front' }, { id: 'back', name: 'Back', x: 0.2, y: 0.53, width: 0.6, height: 0.43, surface: 'back' }, { id: 'left-sleeve', name: 'Left sleeve', x: 0.02, y: 0.24, width: 0.14, height: 0.32, surface: 'left-sleeve' }, { id: 'right-sleeve', name: 'Right sleeve', x: 0.84, y: 0.24, width: 0.14, height: 0.32, surface: 'right-sleeve' }], surface: 'fabric', camera: [0, 0, 5] },
  { id: 'hoodie', name: 'Hoodie · front print', kind: 'hoodie', model: 'hoodie', widthMm: 300, heightMm: 380, regions: [{ id: 'front', name: 'Front', x: 0.2, y: 0.04, width: 0.6, height: 0.43, surface: 'front' }, { id: 'back', name: 'Back', x: 0.2, y: 0.53, width: 0.6, height: 0.43, surface: 'back' }, { id: 'left-sleeve', name: 'Left sleeve', x: 0.02, y: 0.24, width: 0.14, height: 0.32, surface: 'left-sleeve' }, { id: 'right-sleeve', name: 'Right sleeve', x: 0.84, y: 0.24, width: 0.14, height: 0.32, surface: 'right-sleeve' }], surface: 'fabric', camera: [0, 0, 5] },
  { id: 'sweatshirt', name: 'Sweatshirt · front print', kind: 'sweatshirt', model: 'shirt', widthMm: 300, heightMm: 380, regions: [{ id: 'front', name: 'Front', x: 0.2, y: 0.04, width: 0.6, height: 0.43, surface: 'front' }, { id: 'back', name: 'Back', x: 0.2, y: 0.53, width: 0.6, height: 0.43, surface: 'back' }, { id: 'left-sleeve', name: 'Left sleeve', x: 0.02, y: 0.24, width: 0.14, height: 0.32, surface: 'left-sleeve' }, { id: 'right-sleeve', name: 'Right sleeve', x: 0.84, y: 0.24, width: 0.14, height: 0.32, surface: 'right-sleeve' }], surface: 'fabric', camera: [0, 0, 5] },
  { id: 'bottle', name: 'Bottle · wrap label', kind: 'bottle', model: 'bottle', widthMm: 220, heightMm: 110, regions: fullSurface('Wrap label', 'wrap'), surface: 'curved', camera: [3.6, 2.1, 4.4] },
  { id: 'jar', name: 'Glass jar · wrap label', kind: 'jar', model: 'jar', widthMm: 250, heightMm: 90, regions: fullSurface('Wrap label', 'wrap'), surface: 'curved', camera: [3.6, 2.1, 4.4] },
  { id: 'mug', name: 'Mug · wrap print', kind: 'mug', model: 'mug', widthMm: 265, heightMm: 90, regions: fullSurface('Wrap print', 'wrap'), surface: 'curved', camera: [3.6, 2.1, 4.4] },
  { id: 'tumbler', name: 'Tumbler · wrap print', kind: 'tumbler', model: 'tumbler', widthMm: 260, heightMm: 120, regions: fullSurface('Wrap print', 'wrap'), surface: 'curved', camera: [3.6, 2.1, 4.4] },
  { id: 'label', name: 'Bottle label · flat', kind: 'label', model: 'flat', widthMm: 180, heightMm: 70, regions: fullSurface('Label face'), surface: 'flat', camera: [0, 0, 5] },
  { id: 'sticker', name: 'Sticker sheet · A4', kind: 'sticker', model: 'flat', widthMm: 210, heightMm: 297, regions: fullSurface('Cut area'), surface: 'flat', camera: [0, 0, 5] },
  { id: 'packaging', name: 'Packaging · front panel', kind: 'packaging', model: 'box', widthMm: 200, heightMm: 150, regions: fullSurface('Front panel'), surface: 'box', camera: [3.6, 2.5, 4.6] },
  { id: 'custom', name: 'Custom product', kind: 'custom', model: 'flat', widthMm: 210, heightMm: 297, regions: fullSurface('Printable surface'), surface: 'flat', camera: [0, 0, 5] },
];

export const getProductTemplate = (id?: string): ProductTemplate => productTemplates.find((template) => template.id === id) ?? productTemplates[0];

export function validateProductTemplate(template: ProductTemplate): string[] {
  const errors: string[] = [];
  if (!template.id.trim() || !template.name.trim()) errors.push('Template id and name are required.');
  if (!Number.isFinite(template.widthMm) || !Number.isFinite(template.heightMm) || template.widthMm < 10 || template.heightMm < 10 || template.widthMm > 3000 || template.heightMm > 3000) errors.push('Physical dimensions must be between 10 and 3,000 mm.');
  if (!['flat', 'shirt', 'hoodie', 'bottle', 'jar', 'mug', 'tumbler', 'box', 'custom'].includes(template.model)) errors.push('The 3D model type is not supported.');
  if (!Array.isArray(template.regions) || template.regions.length === 0 || template.regions.length > 16) errors.push('Templates must define between 1 and 16 printable regions.');
  const regionIds = new Set<string>();
  for (const region of template.regions ?? []) {
    if (!region.id.trim() || regionIds.has(region.id)) errors.push('Printable region ids must be non-empty and unique.');
    regionIds.add(region.id);
    if (![region.x, region.y, region.width, region.height].every(Number.isFinite) || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || region.x + region.width > 1 || region.y + region.height > 1) errors.push(`Printable region ${region.id} must fit within normalized artwork bounds.`);
    if (region.uv && (![region.uv.x, region.uv.y, region.uv.width, region.uv.height].every(Number.isFinite) || region.uv.x < 0 || region.uv.y < 0 || region.uv.width <= 0 || region.uv.height <= 0 || region.uv.x + region.uv.width > 1 || region.uv.y + region.uv.height > 1)) errors.push(`UV mapping for ${region.id} must fit within normalized texture bounds.`);
  }
  if (['bottle', 'jar', 'mug', 'tumbler'].includes(template.model) && !template.regions.some((region) => region.surface === 'wrap')) errors.push('Curved products require a wrap printable region.');
  if (['shirt', 'hoodie'].includes(template.model) && !['front', 'back'].every((surface) => template.regions.some((region) => region.surface === surface))) errors.push('Garment templates require front and back artwork regions.');
  if (!Array.isArray(template.camera) || template.camera.length !== 3 || !template.camera.every(Number.isFinite) || template.camera.every((coordinate) => coordinate === 0)) errors.push('A valid 3D camera preset is required.');
  return errors;
}

export function applyProductTemplate(project: DesignProject, template: ProductTemplate, widthMm = template.widthMm, heightMm = template.heightMm): DesignProject {
  const nextWidth = Math.max(50, Math.round(widthMm / 25.4 * 96));
  const nextHeight = Math.max(50, Math.round(heightMm / 25.4 * 96));
  const scale = Math.min(nextWidth / project.width, nextHeight / project.height);
  const contentWidth = project.width * scale;
  const contentHeight = project.height * scale;
  const offsetX = (nextWidth - contentWidth) / 2;
  const offsetY = (nextHeight - contentHeight) / 2;
  return {
    ...project,
    width: nextWidth,
    height: nextHeight,
    productTemplateId: template.id,
    productKind: template.kind,
    physicalWidthMm: widthMm,
    physicalHeightMm: heightMm,
    printableRegions: template.regions,
    nodes: project.nodes.map((node) => ({ ...node, x: offsetX + node.x * scale, y: offsetY + node.y * scale, width: node.width * scale, height: node.height * scale, fontSize: node.fontSize ? node.fontSize * scale : undefined })),
  };
}

export function createStarterProject(): DesignProject {
  const id = crypto.randomUUID();
  const template = productTemplates[0];
  const width = Math.round(template.widthMm / 25.4 * 96);
  const height = Math.round(template.heightMm / 25.4 * 96);
  const node = (name: string, type: DesignProject['nodes'][number]['type'], x: number, y: number, w: number, h: number, fill: string, extra: Partial<DesignProject['nodes'][number]> = {}) => ({ id: crypto.randomUUID(), name, type, x, y, width: w, height: h, rotation: 0, fill, visible: true, locked: false, opacity: 1, ...extra });
  return {
    id,
    name: 'Affiche — Jardin de Mai',
    width,
    height,
    background: '#f6f5f1',
    productTemplateId: template.id,
    productKind: template.kind,
    physicalWidthMm: template.widthMm,
    physicalHeightMm: template.heightMm,
    printableRegions: template.regions,
    printSettings: { resolutionDpi: 300, bleedMm: 3, safeMarginMm: 5, colorProfile: 'sRGB', cropMarks: true, transparentBackground: false, unit: 'mm' },
    updatedAt: new Date().toISOString(),
    nodes: [
      node('Collection', 'text', 54, 72, 350, 22, '#73796b', { text: 'C O L L E C T I O N   P R I N T E M P S  /  0 6', fontSize: 10, fontFamily: 'Arial' }),
      node('Titre principal', 'text', 50, 155, 660, 180, '#252a25', { text: 'Le jardin\nreprend ses droits.', fontSize: 67, fontFamily: 'Georgia', fontStyle: 'bold' }),
      node('Cercle', 'ellipse', 530, 440, 150, 150, '#cbd3bd', { opacity: 0.9 }),
      node('Fleur', 'ellipse', 376, 423, 210, 255, '#d0714c', { rotation: -18, opacity: 0.92 }),
      node('Cœur', 'ellipse', 452, 521, 57, 57, '#f0c97b'),
      node('Description', 'text', 53, 738, 490, 60, '#555d51', { text: 'Un hommage aux plantes sauvages et aux matins doux.', fontSize: 17, fontFamily: 'Arial' }),
      node('Filet inférieur', 'rect', 53, 963, 690, 1, '#d8d5ca'),
      node('Signature', 'text', 53, 987, 540, 35, '#6f7566', { text: 'ATELIER BOTANIQUE     ·     PARIS   /   EST. 2024', fontSize: 10, fontFamily: 'Arial' }),
    ],
  };
}

import type { ProductTemplate } from './product-templates';
import type { PrintableRegion } from './types';

export type ProductPreviewView = 'front' | 'back';
export type NormalizedArtworkBounds = { x: number; y: number; width: number; height: number };

export function isGarmentTemplate(template: ProductTemplate): boolean {
  return template.model === 'shirt' || template.model === 'hoodie';
}

export function resolvePreviewRegion(template: ProductTemplate, view: ProductPreviewView): PrintableRegion {
  const surface = isGarmentTemplate(template) ? view : 'wrap';
  return template.regions.find((region) => region.surface === surface) ?? template.regions[0];
}

export function getPreviewCameraPosition(template: ProductTemplate, view: ProductPreviewView): [number, number, number] {
  const [x, y, z] = template.camera;
  return isGarmentTemplate(template) && view === 'back' ? [-x, y, -z] : [x, y, z];
}

export function getArtworkCropBounds(region?: PrintableRegion): NormalizedArtworkBounds {
  const bounds = region?.uv ?? region;
  const x = Math.max(0, Math.min(1, bounds?.x ?? 0));
  const y = Math.max(0, Math.min(1, bounds?.y ?? 0));
  const width = Math.max(0.001, Math.min(1 - x, bounds?.width ?? 1));
  const height = Math.max(0.001, Math.min(1 - y, bounds?.height ?? 1));
  return { x, y, width, height };
}

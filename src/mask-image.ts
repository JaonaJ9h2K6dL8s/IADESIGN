import type { SegmentationResult } from './background-removal';

export function maskToBlob(mask: Uint8Array, width: number, height: number) {
  if (mask.length !== width * height) throw new Error('Mask dimensions do not match its pixel data.');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable for mask encoding.');
  const pixels = context.createImageData(width, height);
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    pixels.data[offset] = mask[index];
    pixels.data[offset + 1] = mask[index];
    pixels.data[offset + 2] = mask[index];
    pixels.data[offset + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Unable to encode the segmentation mask.')), 'image/png'));
}

export async function applyForegroundMask(original: Blob, segmentation: Pick<SegmentationResult, 'width' | 'height' | 'mask'>) {
  if (segmentation.mask.length !== segmentation.width * segmentation.height) throw new Error('Segmentation mask dimensions are invalid.');
  const image = await createImageBitmap(original);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable for transparent PNG creation.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  const alpha = document.createElement('canvas');
  alpha.width = canvas.width;
  alpha.height = canvas.height;
  const alphaContext = alpha.getContext('2d');
  if (!alphaContext) throw new Error('Canvas is unavailable for alpha mask creation.');
  const alphaPixels = alphaContext.createImageData(alpha.width, alpha.height);
  for (let y = 0; y < alpha.height; y += 1) for (let x = 0; x < alpha.width; x += 1) {
    const sourceIndex = (Math.min(segmentation.height - 1, Math.floor(y / alpha.height * segmentation.height)) * segmentation.width + Math.min(segmentation.width - 1, Math.floor(x / alpha.width * segmentation.width)));
    const offset = (y * alpha.width + x) * 4;
    const value = segmentation.mask[sourceIndex];
    alphaPixels.data[offset] = 255;
    alphaPixels.data[offset + 1] = 255;
    alphaPixels.data[offset + 2] = 255;
    alphaPixels.data[offset + 3] = value;
  }
  alphaContext.putImageData(alphaPixels, 0, 0);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(alpha, 0, 0);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Unable to encode transparent PNG.')), 'image/png'));
}

export async function maskFromBlob(blob: Blob, width: number, height: number) {
  const image = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is unavailable for mask refinement.');
  context.drawImage(image, 0, 0, width, height);
  image.close();
  const pixels = context.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) mask[index] = pixels[index * 4];
  return mask;
}

export function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read encoded image.'));
    reader.readAsDataURL(blob);
  });
}

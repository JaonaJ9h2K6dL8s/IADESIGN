import type { DesignProject } from './types';

export type RenderOptions = { scale?: number; transparent?: boolean; maxDimension?: number; paddingPx?: number };

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load image asset: ${source.slice(0, 80)}`));
    image.src = source;
  });
}

function drawWrappedText(context: CanvasRenderingContext2D, text: string, width: number, lineHeight: number) {
  const lines = text.split('\n');
  let y = 0;
  for (const line of lines) {
    const words = line.split(/\s+/);
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && context.measureText(candidate).width > width) {
        context.fillText(current, 0, y);
        y += lineHeight;
        current = word;
      } else current = candidate;
    }
    if (current) {
      context.fillText(current, 0, y);
      y += lineHeight;
    }
  }
}

export async function renderArtwork(project: DesignProject, options: RenderOptions = {}): Promise<HTMLCanvasElement> {
  const maxDimension = options.maxDimension ?? 16384;
  const paddingPx = Math.max(0, Math.round(options.paddingPx ?? 0));
  const availableDimension = maxDimension - paddingPx * 2;
  if (availableDimension < 1) throw new Error('Artwork padding exceeds the render safety limit.');
  const scale = Math.min(options.scale ?? 1, availableDimension / project.width, availableDimension / project.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(project.width * scale) + paddingPx * 2);
  canvas.height = Math.max(1, Math.round(project.height * scale) + paddingPx * 2);
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('Canvas rendering is not available');
  context.scale(scale, scale);
  context.translate(paddingPx / scale, paddingPx / scale);
  if (!options.transparent) {
    context.fillStyle = project.background ?? '#ffffff';
    context.fillRect(-paddingPx / scale, -paddingPx / scale, project.width + 2 * paddingPx / scale, project.height + 2 * paddingPx / scale);
  }
  for (const node of project.nodes) {
    if (!node.visible || node.opacity <= 0) continue;
    context.save();
    context.globalAlpha = node.opacity;
    context.translate(node.x + node.width / 2, node.y + node.height / 2);
    context.rotate(node.rotation * Math.PI / 180);
    context.translate(-node.width / 2, -node.height / 2);
    context.fillStyle = node.fill;
    if (node.type === 'image' && node.src) {
      const image = await loadImage(node.src);
      const crop = node.crop ?? { x: 0, y: 0, width: 1, height: 1 };
      context.drawImage(image, crop.x * image.naturalWidth, crop.y * image.naturalHeight, crop.width * image.naturalWidth, crop.height * image.naturalHeight, 0, 0, node.width, node.height);
    } else if (node.type === 'text') {
      const weight = node.fontStyle?.includes('bold') ? 'bold ' : '';
      const italic = node.fontStyle?.includes('italic') ? 'italic ' : '';
      context.font = `${italic}${weight}${node.fontSize ?? 24}px ${node.fontFamily ?? 'Arial'}`;
      context.textBaseline = 'top';
      context.textAlign = (node.align as CanvasTextAlign) ?? 'left';
      const lineHeight = (node.fontSize ?? 24) * 1.16;
      drawWrappedText(context, node.text ?? '', node.width, lineHeight);
    } else if (node.type === 'ellipse') {
      context.beginPath();
      context.ellipse(node.width / 2, node.height / 2, node.width / 2, node.height / 2, 0, 0, Math.PI * 2);
      context.fill();
    } else context.fillRect(0, 0, node.width, node.height);
    context.restore();
  }
  return canvas;
}

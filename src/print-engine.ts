import { convertArtworkToCmyk, embedSrgbJpegProfile, embedSrgbPngProfile } from './api';
import { renderArtwork } from './design-renderer';
import type { DesignProject } from './types';

export type PrintWarning = { severity: 'warning' | 'error'; code: string; message: string };

export function physicalSizeMm(project: DesignProject) {
  return {
    width: project.physicalWidthMm ?? project.width / 96 * 25.4,
    height: project.physicalHeightMm ?? project.height / 96 * 25.4,
  };
}

export function outputPixelSize(project: DesignProject, dpi = project.printSettings?.resolutionDpi ?? 300) {
  const physical = physicalSizeMm(project);
  return { width: Math.round(physical.width / 25.4 * dpi), height: Math.round(physical.height / 25.4 * dpi) };
}

export function validatePrint(project: DesignProject): PrintWarning[] {
  const warnings: PrintWarning[] = [];
  const dpi = project.printSettings?.resolutionDpi ?? 300;
  const output = outputPixelSize(project, dpi);
  if (output.width > 16384 || output.height > 16384) warnings.push({ severity: 'error', code: 'OUTPUT_TOO_LARGE', message: 'Output exceeds the 16,384 pixel safety limit per dimension.' });
  if (project.printSettings?.colorProfile === 'CMYK') warnings.push({ severity: 'warning', code: 'CMYK_GENERIC_PROFILE', message: 'CMYK exports use the bundled generic CMYK ICC profile. Confirm the target printer and press profile before production.' });
  if (project.printSettings?.bleedMm === undefined) warnings.push({ severity: 'warning', code: 'BLEED_UNSET', message: 'Bleed is not configured.' });
  const safe = (project.printSettings?.safeMarginMm ?? 0) / 25.4 * 96;
  if (project.nodes.some((node) => node.visible && (node.x < safe || node.y < safe || node.x + node.width > project.width - safe || node.y + node.height > project.height - safe))) {
    warnings.push({ severity: 'warning', code: 'SAFE_AREA', message: 'One or more visible objects touch or extend beyond the safe margin.' });
  }
  for (const node of project.nodes) {
    if (node.visible && node.type === 'image' && node.sourceWidth && node.sourceHeight && node.width > 0 && node.height > 0) {
      const effectiveDpi = Math.min(node.sourceWidth * 96 / node.width, node.sourceHeight * 96 / node.height);
      if (effectiveDpi < dpi) warnings.push({ severity: 'warning', code: 'IMAGE_RESOLUTION', message: `${node.name}: approximately ${Math.round(effectiveDpi)} source DPI at placed size; target is ${dpi} DPI.` });
    }
  }
  if (project.printableRegions?.length) {
    const outside = project.nodes.some((node) => node.visible && !project.printableRegions?.some((region) => {
      const left = region.x * project.width;
      const top = region.y * project.height;
      return node.x >= left && node.y >= top && node.x + node.width <= left + region.width * project.width && node.y + node.height <= top + region.height * project.height;
    }));
    if (outside) warnings.push({ severity: 'warning', code: 'PRINTABLE_REGION', message: 'Some objects are outside the printable region.' });
  }
  return warnings;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function safeFileName(name: string) {
  return name.replace(/[^\p{L}\p{N}-]+/gu, '-').toLowerCase();
}

export async function exportProductionPng(project: DesignProject, transparent = project.printSettings?.transparentBackground ?? false) {
  const dpi = project.printSettings?.resolutionDpi ?? 300;
  const size = outputPixelSize(project, dpi);
  if (size.width > 16384 || size.height > 16384) throw new Error('Production export exceeds the 16,384 pixel safety limit. Reduce document size or output DPI.');
  const canvas = await renderArtwork(project, { scale: size.width / project.width, transparent, maxDimension: 16384 });
  const blob = await embedSrgbPngProfile(canvas.toDataURL('image/png'), dpi);
  download(blob, `${safeFileName(project.name)}-${dpi}dpi${transparent ? '-transparent' : ''}-srgb.png`);
  return size;
}

export async function exportProductionJpeg(project: DesignProject) {
  const dpi = project.printSettings?.resolutionDpi ?? 300;
  const size = outputPixelSize(project, dpi);
  if (size.width > 16384 || size.height > 16384) throw new Error('Production export exceeds the 16,384 pixel safety limit. Reduce document size or output DPI.');
  const canvas = await renderArtwork(project, { scale: size.width / project.width, maxDimension: 16384 });
  const dataUrl = canvas.toDataURL('image/png');
  const cmyk = project.printSettings?.colorProfile === 'CMYK';
  const converted = cmyk ? await convertArtworkToCmyk(dataUrl, dpi) : undefined;
  const blob = converted?.blob ?? await embedSrgbJpegProfile(dataUrl, dpi);
  download(blob, `${safeFileName(project.name)}-${dpi}dpi${cmyk ? '-cmyk' : '-srgb'}.jpg`);
  return { ...size, colorSpace: cmyk ? 'CMYK' : 'sRGB' };
}

export async function exportProductionPdf(project: DesignProject) {
  const { PDFDocument, PDFName, rgb } = await import('pdf-lib');
  const dpi = project.printSettings?.resolutionDpi ?? 300;
  const size = outputPixelSize(project, dpi);
  if (size.width > 16384 || size.height > 16384) throw new Error('PDF artwork exceeds the 16,384 pixel safety limit. Reduce document size or output DPI.');
  const bleedMm = Math.max(0, project.printSettings?.bleedMm ?? 0);
  const markSpaceMm = project.printSettings?.cropMarks ? 8 : 0;
  const bleedPx = Math.ceil(bleedMm / 25.4 * dpi);
  if (size.width + 2 * bleedPx > 16384 || size.height + 2 * bleedPx > 16384) throw new Error('PDF artwork including bleed exceeds the 16,384 pixel safety limit. Reduce bleed or output DPI.');
  const canvas = await renderArtwork(project, { scale: size.width / project.width, maxDimension: 16384, paddingPx: bleedPx });
  const physical = physicalSizeMm(project);
  const pageWidth = (physical.width + 2 * bleedMm + 2 * markSpaceMm) * 72 / 25.4;
  const pageHeight = (physical.height + 2 * bleedMm + 2 * markSpaceMm) * 72 / 25.4;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([pageWidth, pageHeight]);
  const useCmyk = project.printSettings?.colorProfile === 'CMYK';
  let embedded;
  if (useCmyk) {
    const conversion = await convertArtworkToCmyk(canvas.toDataURL('image/png'), dpi);
    embedded = await pdf.embedJpg(await conversion.blob.arrayBuffer());
    await embedded.embed();
    const profile = pdf.context.register(pdf.context.stream(conversion.iccProfile, { N: 4, Alternate: PDFName.of('DeviceCMYK') }));
    const imageStream = pdf.context.lookup(embedded.ref) as unknown as { dict: { set(key: unknown, value: unknown): void } };
    imageStream.dict.set(PDFName.of('ColorSpace'), pdf.context.obj([PDFName.of('ICCBased'), profile]));
  } else {
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG encoding failed')), 'image/png'));
    embedded = await pdf.embedPng(await png.arrayBuffer());
  }
  const bleedPt = bleedMm * 72 / 25.4;
  const markPt = markSpaceMm * 72 / 25.4;
  const trimWidth = physical.width * 72 / 25.4;
  const trimHeight = physical.height * 72 / 25.4;
  page.setTrimBox(markPt + bleedPt, markPt + bleedPt, trimWidth, trimHeight);
  page.node.set(PDFName.of('BleedBox'), pdf.context.obj([markPt, markPt, pageWidth - markPt, pageHeight - markPt]));
  page.drawImage(embedded, { x: markPt, y: markPt, width: trimWidth + 2 * bleedPt, height: trimHeight + 2 * bleedPt });
  if (markSpaceMm > 0) {
    const offset = markPt * 0.2;
    const length = markPt * 0.55;
    const left = markPt + bleedPt;
    const bottom = markPt + bleedPt;
    const right = left + trimWidth;
    const top = bottom + trimHeight;
    for (const x of [left, right]) for (const sign of [-1, 1]) {
      page.drawLine({ start: { x: x + sign * offset, y: bottom - offset }, end: { x: x + sign * (offset + length), y: bottom - offset }, thickness: 0.35, color: rgb(0.1, 0.1, 0.1) });
      page.drawLine({ start: { x: x + sign * offset, y: top + offset }, end: { x: x + sign * (offset + length), y: top + offset }, thickness: 0.35, color: rgb(0.1, 0.1, 0.1) });
    }
    for (const y of [bottom, top]) for (const sign of [-1, 1]) {
      page.drawLine({ start: { x: left - offset, y: y + sign * offset }, end: { x: left - offset, y: y + sign * (offset + length) }, thickness: 0.35, color: rgb(0.1, 0.1, 0.1) });
      page.drawLine({ start: { x: right + offset, y: y + sign * offset }, end: { x: right + offset, y: y + sign * (offset + length) }, thickness: 0.35, color: rgb(0.1, 0.1, 0.1) });
    }
  }
  const bytes = await pdf.save();
  download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${safeFileName(project.name)}-production.pdf`);
  return { width: size.width, height: size.height, pageWidthPt: pageWidth, pageHeightPt: pageHeight };
}

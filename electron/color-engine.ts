import sharp from 'sharp';

export type ProfiledPng = { data: Buffer; iccProfile: Buffer; width: number; height: number };

export async function convertToSrgbPng(source: Buffer, dpi: number): Promise<ProfiledPng> {
  if (!source.length || source.length > 75 * 1024 * 1024) throw new Error('Artwork exceeds the profile embedding size limit.');
  if (!Number.isInteger(dpi) || dpi < 36 || dpi > 2400) throw new Error('Output resolution must be between 36 and 2,400 DPI.');
  const data = await sharp(source, { limitInputPixels: 268_000_000 }).withIccProfile('srgb').withDensity(dpi).png({ compressionLevel: 9 }).toBuffer();
  const metadata = await sharp(data).metadata();
  if (metadata.space !== 'srgb' || !metadata.icc || !metadata.width || !metadata.height) throw new Error('The color engine did not produce an sRGB-profiled PNG.');
  return { data, iccProfile: metadata.icc, width: metadata.width, height: metadata.height };
}

export type ProfiledJpeg = { data: Buffer; iccProfile: Buffer; width: number; height: number };

export async function convertToSrgbJpeg(source: Buffer, dpi: number): Promise<ProfiledJpeg> {
  if (!source.length || source.length > 75 * 1024 * 1024) throw new Error('Artwork exceeds the profile embedding size limit.');
  if (!Number.isInteger(dpi) || dpi < 36 || dpi > 2400) throw new Error('Output resolution must be between 36 and 2,400 DPI.');
  const data = await sharp(source, { limitInputPixels: 268_000_000 }).withIccProfile('srgb').withDensity(dpi).jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer();
  const metadata = await sharp(data).metadata();
  if (metadata.space !== 'srgb' || !metadata.icc || !metadata.width || !metadata.height) throw new Error('The color engine did not produce an sRGB-profiled JPEG.');
  return { data, iccProfile: metadata.icc, width: metadata.width, height: metadata.height };
}

export type CmykConversion = { data: Buffer; iccProfile: Buffer; width: number; height: number };

export async function convertToCmyk(source: Buffer, dpi: number): Promise<CmykConversion> {
  if (!source.length || source.length > 75 * 1024 * 1024) throw new Error('Artwork exceeds the CMYK conversion size limit.');
  if (!Number.isInteger(dpi) || dpi < 36 || dpi > 2400) throw new Error('Output resolution must be between 36 and 2,400 DPI.');
  const data = await sharp(source, { limitInputPixels: 268_000_000 }).toColourspace('cmyk').withIccProfile('cmyk').withDensity(dpi).jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer();
  const metadata = await sharp(data).metadata();
  if (metadata.space !== 'cmyk' || !metadata.icc || !metadata.width || !metadata.height) throw new Error('The color engine did not produce a profiled CMYK image.');
  return { data, iccProfile: metadata.icc, width: metadata.width, height: metadata.height };
}

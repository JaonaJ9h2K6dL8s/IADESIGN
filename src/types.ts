export type ProductKind = 'poster' | 'tshirt' | 'hoodie' | 'sweatshirt' | 'bottle' | 'jar' | 'mug' | 'tumbler' | 'label' | 'sticker' | 'packaging' | 'custom';
export type ProductModel = 'flat' | 'shirt' | 'hoodie' | 'bottle' | 'jar' | 'mug' | 'tumbler' | 'box' | 'custom';
export type UnitSystem = 'mm' | 'cm' | 'in' | 'px';

export type PrintableRegion = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  surface?: 'front' | 'back' | 'left-sleeve' | 'right-sleeve' | 'body' | 'wrap' | 'custom';
  uv?: { x: number; y: number; width: number; height: number };
};

export type PrintSettings = {
  resolutionDpi: number;
  bleedMm: number;
  safeMarginMm: number;
  colorProfile: 'sRGB' | 'CMYK';
  cropMarks: boolean;
  transparentBackground: boolean;
  unit: UnitSystem;
};

export type NormalizedCrop = { x: number; y: number; width: number; height: number };

export type DesignNode = {
  id: string;
  name: string;
  type: 'text' | 'rect' | 'ellipse' | 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fill: string;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontStyle?: string;
  align?: string;
  src?: string;
  originalSrc?: string;
  maskSrc?: string;
  sourceUrl?: string;
  sourceName?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  crop?: NormalizedCrop;
  groupId?: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
};

export type DesignProject = {
  id: string;
  name: string;
  width: number;
  height: number;
  background?: string;
  nodes: DesignNode[];
  updatedAt: string;
  productTemplateId?: string;
  automationParentId?: string;
  productKind?: ProductKind;
  physicalWidthMm?: number;
  physicalHeightMm?: number;
  printableRegions?: PrintableRegion[];
  printSettings?: PrintSettings;
};

import { useEffect, useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import type { DesignNode, NormalizedCrop } from './types';

const fullCrop: NormalizedCrop = { x: 0, y: 0, width: 1, height: 1 };

type CropField = keyof NormalizedCrop;

export function ImageCropEditor({ node, onCancel, onApply }: { node: DesignNode; onCancel: () => void; onApply: (crop: NormalizedCrop) => void }) {
  const [crop, setCrop] = useState<NormalizedCrop>(node.crop ?? fullCrop);
  useEffect(() => setCrop(node.crop ?? fullCrop), [node.id, node.crop]);
  const change = (field: CropField, percentage: number) => {
    const value = Math.max(0, Math.min(100, percentage)) / 100;
    setCrop((current) => {
      const next = { ...current, [field]: value };
      if (field === 'x') next.width = Math.min(next.width, 1 - value);
      if (field === 'y') next.height = Math.min(next.height, 1 - value);
      if (field === 'width') next.width = Math.max(0.01, Math.min(value, 1 - next.x));
      if (field === 'height') next.height = Math.max(0.01, Math.min(value, 1 - next.y));
      return next;
    });
  };
  const sourceWidth = node.sourceWidth ?? 1;
  const sourceHeight = node.sourceHeight ?? 1;
  const previewRatio = Math.max(0.2, Math.min(5, sourceWidth * crop.width / (sourceHeight * crop.height)));
  return <div className="modal-backdrop crop-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}><section className="crop-editor-modal" role="dialog" aria-modal="true" aria-labelledby="crop-editor-title"><header><div><span>NON-DESTRUCTIVE EDIT</span><h2 id="crop-editor-title">Crop image</h2></div><button aria-label="Close crop editor" onClick={onCancel}><X size={17}/></button></header><p>Adjust the visible source area. Original image pixels remain unchanged.</p><div className="crop-editor-preview" style={{ aspectRatio: String(previewRatio) }}><img alt="Current image crop preview" src={node.src} draggable={false} style={{ width: `${100 / crop.width}%`, height: `${100 / crop.height}%`, left: `${-crop.x * 100 / crop.width}%`, top: `${-crop.y * 100 / crop.height}%` }}/></div><div className="crop-editor-fields">{([['x', 'Left (%)'], ['y', 'Top (%)'], ['width', 'Width (%)'], ['height', 'Height (%)']] as const).map(([field, label]) => <label key={field}>{label}<input aria-label={label} type="number" min="0.1" max="100" step="0.1" value={Math.round(crop[field] * 1000) / 10} onChange={(event) => change(field, Number(event.target.value))}/></label>)}</div><footer><button onClick={() => setCrop(fullCrop)}><RotateCcw size={14}/>Reset crop</button><div><button onClick={onCancel}>Cancel</button><button className="assistant-generate" onClick={() => onApply(crop)}><Check size={14}/>Apply crop</button></div></footer></section></div>;
}

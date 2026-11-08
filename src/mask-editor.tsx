import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject, PointerEvent } from 'react';
import { Brush, Eraser, Redo2, Undo2, X } from 'lucide-react';

type Props = { sourceUrl: string; maskUrl: string; title: string; onCancel: () => void; onApply: (blob: Blob, width: number, height: number) => void };

export function MaskEditor({ sourceUrl, maskUrl, title, onCancel, onApply }: Props) {
  const preview = useRef<HTMLCanvasElement | null>(null);
  const source = useRef<HTMLCanvasElement | null>(null);
  const mask = useRef<Uint8ClampedArray | null>(null);
  const size = useRef({ width: 1, height: 1 });
  const past = useRef<Uint8ClampedArray[]>([]);
  const future = useRef<Uint8ClampedArray[]>([]);
  const drawing = useRef(false);
  const previous = useRef<{ x: number; y: number } | undefined>(undefined);
  const [tool, setTool] = useState<'brush' | 'erase'>('brush');
  const [brushSize, setBrushSize] = useState(42);
  const [softness, setSoftness] = useState(0.72);
  const [, redraw] = useState(0);

  const render = () => {
    const canvas = preview.current;
    const image = source.current;
    const alpha = mask.current;
    if (!canvas || !image || !alpha) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const pixels = context.createImageData(size.current.width, size.current.height);
    const original = image.getContext('2d')?.getImageData(0, 0, size.current.width, size.current.height).data;
    if (!original) return;
    for (let index = 0; index < alpha.length; index += 1) {
      const offset = index * 4;
      pixels.data[offset] = original[offset];
      pixels.data[offset + 1] = original[offset + 1];
      pixels.data[offset + 2] = original[offset + 2];
      pixels.data[offset + 3] = alpha[index];
    }
    context.putImageData(pixels, 0, 0);
  };

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadCanvas(sourceUrl), loadCanvas(maskUrl)]).then(([sourceCanvas, maskCanvas]) => {
      if (cancelled) return;
      const width = sourceCanvas.width;
      const height = sourceCanvas.height;
      size.current = { width, height };
      source.current = sourceCanvas;
      const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true });
      if (!maskContext) throw new Error('Mask image is unavailable.');
      const raw = maskContext.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      const alpha = new Uint8ClampedArray(width * height);
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const src = (Math.min(maskCanvas.height - 1, Math.floor(y / height * maskCanvas.height)) * maskCanvas.width + Math.min(maskCanvas.width - 1, Math.floor(x / width * maskCanvas.width))) * 4;
        alpha[y * width + x] = raw.data[src];
      }
      mask.current = alpha;
      if (preview.current) {
        preview.current.width = width;
        preview.current.height = height;
      }
      render();
    }).catch(() => onCancel());
    return () => { cancelled = true; };
  }, [sourceUrl, maskUrl]);

  const snapshot = () => {
    if (!mask.current) return;
    past.current = [...past.current, mask.current.slice()].slice(-30);
    future.current = [];
  };

  const restore = (stack: MutableRefObject<Uint8ClampedArray[]>, other: MutableRefObject<Uint8ClampedArray[]>) => {
    const current = mask.current;
    const next = stack.current.pop();
    if (!current || !next) return;
    other.current.push(current.slice());
    mask.current = next;
    render();
    redraw((value) => value + 1);
  };

  const paint = (event: PointerEvent<HTMLCanvasElement>, continueStroke: boolean) => {
    const canvas = preview.current;
    const alpha = mask.current;
    if (!canvas || !alpha) return;
    const rect = canvas.getBoundingClientRect();
    const point = { x: (event.clientX - rect.left) / rect.width * size.current.width, y: (event.clientY - rect.top) / rect.height * size.current.height };
    if (!continueStroke) snapshot();
    const from = previous.current ?? point;
    const scale = size.current.width / rect.width;
    const radius = Math.max(1, brushSize * scale / 2);
    const steps = Math.max(1, Math.ceil(Math.hypot(point.x - from.x, point.y - from.y) / (radius * 0.28)));
    for (let step = 0; step <= steps; step += 1) {
      const cx = from.x + (point.x - from.x) * step / steps;
      const cy = from.y + (point.y - from.y) * step / steps;
      const left = Math.max(0, Math.floor(cx - radius));
      const right = Math.min(size.current.width - 1, Math.ceil(cx + radius));
      const top = Math.max(0, Math.floor(cy - radius));
      const bottom = Math.min(size.current.height - 1, Math.ceil(cy + radius));
      for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) {
        const distance = Math.hypot(x - cx, y - cy) / radius;
        if (distance > 1) continue;
        const falloff = distance <= softness ? 1 : Math.max(0, (1 - distance) / (1 - softness));
        const index = y * size.current.width + x;
        const amount = Math.round(255 * falloff);
        alpha[index] = tool === 'brush' ? Math.max(alpha[index], amount) : Math.min(alpha[index], 255 - amount);
      }
    }
    previous.current = point;
    render();
  };

  const finish = () => { drawing.current = false; previous.current = undefined; redraw((value) => value + 1); };
  const invert = () => {
    snapshot();
    if (mask.current) for (let index = 0; index < mask.current.length; index += 1) mask.current[index] = 255 - mask.current[index];
    render();
    redraw((value) => value + 1);
  };
  const apply = async () => {
    const alpha = mask.current;
    if (!alpha) return;
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = size.current.width;
    maskCanvas.height = size.current.height;
    const context = maskCanvas.getContext('2d');
    if (!context) return;
    const pixels = context.createImageData(maskCanvas.width, maskCanvas.height);
    for (let index = 0; index < alpha.length; index += 1) {
      const offset = index * 4;
      pixels.data[offset] = alpha[index];
      pixels.data[offset + 1] = alpha[index];
      pixels.data[offset + 2] = alpha[index];
      pixels.data[offset + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => maskCanvas.toBlob((value) => value ? resolve(value) : reject(new Error('Unable to save mask.')), 'image/png'));
    onApply(blob, size.current.width, size.current.height);
  };

  return <div className="modal-backdrop mask-editor-backdrop"><section className="mask-editor-modal"><header><div><span>NEURAL MASK REFINEMENT</span><h2>{title}</h2></div><button onClick={onCancel}><X size={17}/></button></header><p>Local foreground mask · Original image remains preserved.</p><div className="mask-editor-canvas-wrap"><canvas ref={preview} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drawing.current = true; previous.current = undefined; paint(event, false); }} onPointerMove={(event) => { if (drawing.current) paint(event, true); }} onPointerUp={finish} onPointerCancel={finish}/></div><div className="mask-editor-tools"><button className={tool === 'brush' ? 'active' : ''} onClick={() => setTool('brush')}><Brush size={14}/>Restore</button><button className={tool === 'erase' ? 'active' : ''} onClick={() => setTool('erase')}><Eraser size={14}/>Remove</button><button disabled={!past.current.length} onClick={() => restore(past, future)}><Undo2 size={14}/>Undo</button><button disabled={!future.current.length} onClick={() => restore(future, past)}><Redo2 size={14}/>Redo</button><button onClick={invert}>Invert</button></div><div className="mask-editor-sliders"><label>Brush size <input type="range" min="4" max="180" value={brushSize} onChange={(event) => setBrushSize(+event.target.value)}/>{brushSize}px</label><label>Edge softness <input type="range" min="0.1" max="0.95" step="0.05" value={softness} onChange={(event) => setSoftness(+event.target.value)}/>{Math.round(softness * 100)}%</label></div><footer><button onClick={onCancel}>Cancel</button><button className="assistant-generate" onClick={() => void apply()}>Apply transparent mask</button></footer></section></div>;
}

async function loadCanvas(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d')?.drawImage(image, 0, 0);
  return canvas;
}

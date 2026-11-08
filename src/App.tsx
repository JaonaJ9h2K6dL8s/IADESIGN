import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Ellipse, Image as KImage, Layer, Rect, Stage, Text, Transformer } from 'react-konva';
import type Konva from 'konva';
import { AlignCenter, ArrowDownToLine, ArrowUp, ArrowDown, Check, ChevronDown, ChevronRight, Circle, Cloud, Copy, Eye, FileImage, FolderOpen, ImagePlus, Layers3, LockKeyhole, Move, Paintbrush, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Plus, Redo2, Search, Settings2, Shapes, SlidersHorizontal, Sparkles, Square, Trash2, Type, UnlockKeyhole, Undo2, Upload, WandSparkles, X, ZoomIn, ZoomOut, Box, Rotate3D, Printer, Ruler, Scissors, Download, Shirt, PackageOpen, BadgeCheck, AlertTriangle, Crop, Group, Ungroup } from 'lucide-react';
import { createProject, createProductTemplate, deleteProject, pruneProjectAssets, listProjects, listProductTemplates, saveProject, storeAsset, getAIProviderSettings, requestAIImage, requestAIText, requestLocalPosterImage, requestLocalText, type AIProviderSettings } from './api';
import { createLayoutAlternatives, smartLayoutAnalysisDescription, type LayoutAlternative, type LayoutGenerationResult } from './optimizer';
import { applyProductTemplate, createStarterProject, getProductTemplate, productTemplates as builtInTemplates, type ProductTemplate } from './product-templates';
import { getArtworkCropBounds, getPreviewCameraPosition, isGarmentTemplate, resolvePreviewRegion } from './product-preview';
import { exportProductionJpeg, exportProductionPdf, exportProductionPng, outputPixelSize, physicalSizeMm, validatePrint } from './print-engine';
import { useStudioStore, captureStudioCheckpoint, restoreStudioCheckpoint, type StudioCheckpoint } from './studio-store';
import { LayoutPreview } from './layout-preview';
import { segmentForeground } from './background-removal';
import { applyForegroundMask, blobToDataUrl, maskFromBlob, maskToBlob } from './mask-image';
import { MaskEditor } from './mask-editor';
import { AISettings } from './ai-settings';
import { PinterestImporter } from './pinterest-importer';
import { CommonsSearch } from './commons-search';
import { BackupManager } from './backup-manager';
import { ImageCropEditor } from './image-crop-editor';
import { ProductionAssistant, type ProductionAssistantResult } from './production-assistant';
import { duplicateObjects, groupObjects, reorderObjects, selectObjects, toggleObjectsLocked, ungroupObjects } from './editor-operations';
import { useStrings, type Language } from './i18n';
import type { DesignNode, DesignProject, NormalizedCrop, PrintableRegion } from './types';

const uid = () => crypto.randomUUID();
const blank = (name = 'Affiche — Jardin de Mai'): DesignProject => ({ ...createStarterProject(), id: uid(), name, updatedAt: new Date().toISOString() });
const fileName = (name: string) => name.replace(/[^\p{L}\p{N}-]+/gu, '-').toLowerCase();

function useArtworkTexture(project: DesignProject, region: PrintableRegion | undefined, canvasRef?: React.RefObject<HTMLCanvasElement | null>, transparent = false) {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  useEffect(() => {
    let cancelled = false;
    let created: THREE.CanvasTexture | null = null;
    void import('./design-renderer').then(({ renderArtwork }) => renderArtwork(project, { maxDimension: 2048, transparent })).then((canvas) => {
      if (cancelled) return;
      const { x, y, width, height } = getArtworkCropBounds(region);
      const sourceX = Math.round(canvas.width * x);
      const sourceY = Math.round(canvas.height * y);
      const sourceRight = Math.round(canvas.width * (x + width));
      const sourceBottom = Math.round(canvas.height * (y + height));
      const crop = document.createElement('canvas');
      crop.width = Math.max(1, sourceRight - sourceX);
      crop.height = Math.max(1, sourceBottom - sourceY);
      crop.getContext('2d')?.drawImage(canvas, sourceX, sourceY, crop.width, crop.height, 0, 0, crop.width, crop.height);
      created = new THREE.CanvasTexture(crop);
      created.colorSpace = THREE.SRGBColorSpace;
      created.anisotropy = 8;
      created.needsUpdate = true;
      setTexture(created);
      if (canvasRef?.current) {
        canvasRef.current.width = crop.width;
        canvasRef.current.height = crop.height;
        canvasRef.current.dataset.regionId = region?.id ?? 'full-artwork';
        canvasRef.current.getContext('2d')?.drawImage(crop, 0, 0);
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      created?.dispose();
    };
  }, [project, region, canvasRef, transparent]);
  return texture;
}

function ArtworkSurface({ project, region, position, rotation = [0, 0, 0], size, canvasRef }: { project: DesignProject; region: PrintableRegion; position: [number, number, number]; rotation?: [number, number, number]; size: [number, number]; canvasRef?: React.RefObject<HTMLCanvasElement | null> }) {
  const texture = useArtworkTexture(project, region, canvasRef, true);
  return <mesh position={position} rotation={rotation}><planeGeometry args={size}/><meshBasicMaterial key={texture?.uuid ?? 'placeholder'} map={texture ?? undefined} color={texture ? '#ffffff' : '#ece8df'} transparent side={THREE.DoubleSide}/></mesh>;
}

function ProductMesh({ project, template, view, canvasRef }: { project: DesignProject; template: ProductTemplate; view: 'front' | 'back'; canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  const garment = isGarmentTemplate(template);
  const artworkRegion = resolvePreviewRegion(template, view);
  const texture = useArtworkTexture(project, artworkRegion, canvasRef, garment);
  const artwork = <meshBasicMaterial key={texture?.uuid ?? 'placeholder'} map={texture ?? undefined} color={texture ? '#ffffff' : '#ece8df'} transparent={garment} side={THREE.DoubleSide}/>;
  const fabric = <meshStandardMaterial color="#e7e4dc" roughness={0.82} side={THREE.DoubleSide}/>;
  if (template.model === 'bottle' || template.model === 'jar') {
    const labelRadius = template.model === 'jar' ? 0.845 : 0.685;
    const labelHeight = template.heightMm / 100;
    const labelAngle = Math.min(Math.PI * 1.8, template.widthMm / 100 / labelRadius);
    const cameraAzimuth = Math.atan2(template.camera[0], template.camera[2]);
    return <group>
      <mesh position={[0, 0.12, 0]}><cylinderGeometry args={[template.model === 'jar' ? 0.8 : 0.56, template.model === 'jar' ? 0.82 : 0.66, 2.35, 64, 1]} /><meshStandardMaterial color="#ece8df" roughness={0.42} /></mesh>
      <mesh position={[0, 0.12, 0]}><cylinderGeometry args={[labelRadius, labelRadius, labelHeight, 128, 1, true, cameraAzimuth - labelAngle / 2, labelAngle]} />{artwork}</mesh>
      <mesh position={[0, 1.38, 0]}><cylinderGeometry args={[0.42, 0.56, 0.32, 48]} /><meshStandardMaterial color="#d9d4c8" roughness={0.35} /></mesh>
      <mesh position={[0, 1.62, 0]}><cylinderGeometry args={[0.38, 0.38, 0.16, 48]} /><meshStandardMaterial color="#c2baa9" roughness={0.3} /></mesh>
    </group>;
  }
  if (template.model === 'mug') return <group>
    <mesh><cylinderGeometry args={[0.79, 0.79, 1.45, 64, 1, true]} />{artwork}</mesh>
    <mesh position={[0.86, 0, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.46, 0.1, 18, 48]} /><meshStandardMaterial color="#ece9e1" roughness={0.58} /></mesh>
  </group>;
  if (template.model === 'tumbler') return <group>
    <mesh><cylinderGeometry args={[0.66, 0.88, 2.25, 64, 1, true]} />{artwork}</mesh>
    <mesh position={[0, 1.17, 0]}><cylinderGeometry args={[0.68, 0.68, 0.11, 64]} /><meshStandardMaterial color="#d2cbbc" roughness={0.32} /></mesh>
  </group>;
  if (template.model === 'box') return <group>
    <mesh><boxGeometry args={[2.2, 1.7, 0.8]} /><meshStandardMaterial color="#ddd5c5" roughness={0.75} /></mesh>
    <mesh position={[0, 0, 0.405]}><planeGeometry args={[2.05, 1.55]} />{artwork}</mesh>
  </group>;
  if (garment) {
    const artworkWidth = 1.15;
    const artworkHeight = artworkWidth / Math.max(0.01, artworkRegion.width * project.width / (artworkRegion.height * project.height));
    return <group rotation={view === 'back' ? [0, Math.PI, 0] : [0, 0, 0]}>
      <mesh position={[0, -0.1, 0]} scale={[1.18, 1, 1]}><capsuleGeometry args={[0.8, 1.25, 8, 20]} />{fabric}</mesh>
      <mesh position={[0, 0.15, 1.02]}><planeGeometry args={[artworkWidth, artworkHeight]} />{artwork}</mesh>
    {template.regions.filter((region) => region.surface === 'left-sleeve' || region.surface === 'right-sleeve').map((region) => {
      const left = region.surface === 'left-sleeve';
      const side = left ? -1 : 1;
      return <group key={region.id}>
        <ArtworkSurface project={project} region={region} position={[side * 0.98, 0.42, 0.48]} rotation={[0, side * 0.22, side * -0.18]} size={[0.38, 0.88]}/>
      </group>;
    })}
    {template.model === 'hoodie' && <mesh position={[0, -0.84, 0.88]}><planeGeometry args={[0.72, 0.34]} /><meshStandardMaterial color="#d8d5cc" side={THREE.DoubleSide} /></mesh>}
  </group>;
  }
  return <group>
    <mesh position={[0, 0, -0.08]}><planeGeometry args={[3, 3.8]} /><meshStandardMaterial color="#e9e6de" side={THREE.DoubleSide} /></mesh>
    <mesh><planeGeometry args={[3, 3.8]} />{artwork}</mesh>
  </group>;
}


function ProductPreview({ project, template, onClose }: { project: DesignProject; template: ProductTemplate; onClose: () => void }) {
  const [view, setView] = useState<'front' | 'back'>('front');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const downloadMockup = () => {
    const canvas = document.querySelector<HTMLCanvasElement>('.product-preview canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `${fileName(project.name)}-3d-mockup.png`;
    link.click();
  };
  return <div className="product-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="product-modal"><header><div><span>3D PRESENTATION</span><h2>{template.name}</h2></div><button onClick={onClose}><X size={18}/></button></header><div className="product-preview"><Canvas key={`${template.id}-${isGarmentTemplate(template) ? view : 'front'}`} camera={{ position: getPreviewCameraPosition(template, view), fov: 37 }} gl={{ preserveDrawingBuffer: true, antialias: true }} shadows><color attach="background" args={['#f3f2ed']}/><ambientLight intensity={1.2}/><directionalLight position={[4, 5, 6]} intensity={2} castShadow/><ProductMesh project={project} template={template} view={view} canvasRef={canvasRef}/><OrbitControls enablePan={false} minDistance={3} maxDistance={9}/></Canvas></div><footer><small>Presentation mockup only · Not print-ready artwork</small><div><button onClick={() => setView((current) => current === 'front' ? 'back' : 'front')}><Rotate3D size={14}/>{view === 'front' ? 'Show back' : 'Show front'}</button><button onClick={downloadMockup}><Download size={14}/>Export mockup</button></div></footer><canvas ref={canvasRef} className="texture-debug-canvas"/></section></div>;
}

function ImageNode({ node, canvasProps }: { node: DesignNode; canvasProps: Omit<React.ComponentProps<typeof KImage>, 'image'> }) {
  const [image, setImage] = useState<HTMLImageElement>();
  useEffect(() => { if (!node.src) return; const img = new Image(); img.onload = () => setImage(img); img.src = node.src; }, [node.src]);
  return image ? <KImage {...canvasProps} image={image} crop={node.crop ? { x: node.crop.x * image.naturalWidth, y: node.crop.y * image.naturalHeight, width: node.crop.width * image.naturalWidth, height: node.crop.height * image.naturalHeight } : undefined} /> : <Rect {...canvasProps} fill="#ebe8de" />;
}

function App() {
  const [lang, setLang] = useState<Language>('fr');
  const t = useStrings(lang);
  const project = useStudioStore((state) => state.project);
  const setProject = useStudioStore((state) => state.setProject);
  const loadProject = useStudioStore((state) => state.loadProject);
  const selected = useStudioStore((state) => state.selected);
  const setSelected = useStudioStore((state) => state.setSelected);
  const undo = useStudioStore((state) => state.undo);
  const redo = useStudioStore((state) => state.redo);
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [templates, setTemplates] = useState<ProductTemplate[]>(builtInTemplates);
  const [panel, setPanel] = useState<'design'|'uploads'|'text'|'elements'|'background'|'assistant'|'product'|'print'>('design');
  const [zoom, setZoom] = useState(.58);
  const zoomManuallyAdjusted = useRef(false);
  const [saved, setSaved] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [showAi, setShowAi] = useState(false);
  const [expanded, setExpanded] = useState(() => window.innerWidth > 860);
  const [inspectorExpanded, setInspectorExpanded] = useState(() => window.innerWidth > 680);
  useEffect(() => {
    const syncResponsivePanels = () => {
      setExpanded(window.innerWidth > 860);
      setInspectorExpanded(window.innerWidth > 680);
    };
    const compactViewport = window.matchMedia('(max-width: 860px)');
    const narrowViewport = window.matchMedia('(max-width: 680px)');
    compactViewport.addEventListener('change', syncResponsivePanels);
    narrowViewport.addEventListener('change', syncResponsivePanels);
    return () => {
      compactViewport.removeEventListener('change', syncResponsivePanels);
      narrowViewport.removeEventListener('change', syncResponsivePanels);
    };
  }, []);
  useEffect(() => {
    const viewport = document.querySelector<HTMLElement>('.canvas-viewport');
    if (!viewport) return;
    const fitCanvas = () => {
      if (zoomManuallyAdjusted.current) return;
      const inset = window.innerWidth <= 680 ? 14 : 50;
      const fitWidth = (viewport.clientWidth - inset) / project.width;
      const fitHeight = (viewport.clientHeight - 90) / project.height;
      setZoom(Math.max(.1, Math.min(1.1, fitWidth, fitHeight)));
    };
    const observer = new ResizeObserver(fitCanvas);
    observer.observe(viewport);
    fitCanvas();
    return () => observer.disconnect();
  }, [project.height, project.width, expanded, inspectorExpanded]);
  const [background, setBackground] = useState('#f6f5f1');
  const [exportOpen, setExportOpen] = useState(false);
  const [show3d, setShow3d] = useState(false);
  const [showOptimizer, setShowOptimizer] = useState(false);
  const [alternatives, setAlternatives] = useState<LayoutAlternative[]>([]);
  const [layoutGeneration, setLayoutGeneration] = useState<LayoutGenerationResult | null>(null);
  const [layoutOriginal, setLayoutOriginal] = useState<DesignProject | null>(null);
  const [layoutApplied, setLayoutApplied] = useState(false);
  const [selectedLayoutMode, setSelectedLayoutMode] = useState<LayoutAlternative['mode'] | null>(null);
  const [printWarnings, setPrintWarnings] = useState<{severity: 'warning'|'error';code: string;message: string}[]>([]);
  const [printChecked, setPrintChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cutoutProgress, setCutoutProgress] = useState('');
  const [cutoutModel, setCutoutModel] = useState<'universal'|'portrait'>('universal');
  const [maskTarget, setMaskTarget] = useState<DesignNode | null>(null);
  const [aiSettingsOpen, setAISettingsOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [productionAssistantOpen, setProductionAssistantOpen] = useState(false);
  const [lastProductionRun, setLastProductionRun] = useState<{ before: StudioCheckpoint; background: string; createdProjects: DesignProject[]; assetsCreatedAfter: string } | null>(null);
  const productionCheckpoint = useRef<StudioCheckpoint | null>(null);
  const productionCheckpointAt = useRef<string>('');
  const [cropTarget, setCropTarget] = useState<DesignNode | null>(null);
  const [aiTask, setAITask] = useState<'image'|'edit'|'variation'|'marketing'|'layout'>('image');
  const [aiResult, setAIResult] = useState('');
  const [aiConfigured, setAIConfigured] = useState(false);
  const [aiMode, setAIMode] = useState<'local' | 'provider'>('local');
  useEffect(() => {
    let active = true;
    void getAIProviderSettings().then((settings) => {
      if (!active) return;
      setAIConfigured(settings.apiKeyConfigured);
      setAIMode(settings.mode);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const [viewZoom, setViewZoom] = useState(100);
  const stage = useRef<Konva.Stage>(null);
  const transformer = useRef<Konva.Transformer>(null);
  const refs = useRef<Record<string, Konva.Node>>({});
  const projectSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const projectSaveTimer = useRef<number | undefined>(undefined);
  const uploadRef = useRef<HTMLInputElement>(null);
  const initialized = useRef(false);
  const dragStartPositions = useRef<Record<string, { x: number; y: number }>>({});
  const dragStartPointer = useRef<{ x: number; y: number } | null>(null);
  const selectedNode = project.nodes.find((node) => node.id === selected.at(-1));
  const saveProjectInOrder = (snapshot: DesignProject) => {
    const pending = projectSaveQueue.current.catch(() => undefined).then(() => saveProject(snapshot));
    projectSaveQueue.current = pending.then(() => undefined, () => undefined);
    return pending;
  };
  const flushProjectSave = async () => {
    if (projectSaveTimer.current !== undefined) {
      window.clearTimeout(projectSaveTimer.current);
      projectSaveTimer.current = undefined;
    }
    setSaved(false);
    await projectSaveQueue.current;
    const item = await saveProjectInOrder({ ...project, background });
    setProjects((list) => [item, ...list.filter((p) => p.id !== item.id)]);
    setSaved(true);
  };

  useEffect(() => {
    void Promise.all([listProjects().catch(() => []), listProductTemplates().catch(() => builtInTemplates)]).then(([items, savedTemplates]) => {
      setTemplates(savedTemplates);
      const migrated = items.map((item) => item.productKind ? item : applyProductTemplate({ ...item, printSettings: { resolutionDpi: 300, bleedMm: 3, safeMarginMm: 5, colorProfile: 'sRGB', cropMarks: true, transparentBackground: false, unit: 'mm' } }, getProductTemplate('poster'), item.width / 96 * 25.4, item.height / 96 * 25.4));
      setProjects(migrated);
      const current = migrated[0] ?? blank(lang === 'fr' ? 'Affiche — Jardin de Mai' : 'Poster — Spring garden');
      loadProject(current);
      setSelected([]);
      setBackground(current.background ?? '#f6f5f1');
      initialized.current = true;
    });
  }, []);
  useEffect(() => {
    void getAIProviderSettings().then((settings) => setAIConfigured(settings.apiKeyConfigured)).catch(() => setAIConfigured(false));
  }, []);
  useEffect(() => {
    if (!initialized.current) return;
    setSaved(false);
    projectSaveTimer.current = window.setTimeout(() => {
      projectSaveTimer.current = undefined;
      void saveProjectInOrder({ ...project, background }).then((item) => {
        setProjects((list) => [item, ...list.filter((p) => p.id !== item.id)]);
        setSaved(true);
      }).catch(() => setSaved(false));
    }, 500);
    return () => {
      if (projectSaveTimer.current !== undefined) window.clearTimeout(projectSaveTimer.current);
      projectSaveTimer.current = undefined;
    };
  }, [project, background]);
  useEffect(() => { const tr = transformer.current; if (!tr) return; tr.nodes(selected.map((id) => project.nodes.find((item) => item.id === id)?.locked ? undefined : refs.current[id]).filter((node): node is Konva.Node => Boolean(node))); tr.getLayer()?.batchDraw(); }, [selected, project.nodes]);
  useEffect(() => { setPrintChecked(false); }, [project]);

  const update = (id: string, changes: Partial<DesignNode>) => setProject((p) => ({ ...p, nodes: p.nodes.map((n) => n.id === id ? { ...n, ...changes } : n) }));
  const updateMany = (updates: Record<string, Partial<DesignNode>>) => setProject((p) => ({ ...p, nodes: p.nodes.map((node) => updates[node.id] ? { ...node, ...updates[node.id] } : node) }));
  const startDrag = (id: string) => {
    const draggedNode = project.nodes.find((item) => item.id === id);
    const members = draggedNode?.groupId ? project.nodes.filter((item) => item.groupId === draggedNode.groupId).map((item) => item.id) : selected.includes(id) ? selected : [id];
    dragStartPositions.current = Object.fromEntries(members.flatMap((member) => {
      const node = project.nodes.find((item) => item.id === member);
      const ref = refs.current[member];
      return node && ref && !node.locked ? [[member, { x: node.x, y: node.y }]] : [];
    }));
  };
  const moveDrag = (id: string, target: Konva.Node) => {
    const origin = dragStartPositions.current[id];
    if (!origin) return;
    const deltaX = target.x() - origin.x;
    const deltaY = target.y() - origin.y;
    for (const [member, start] of Object.entries(dragStartPositions.current)) {
      if (member !== id) refs.current[member]?.position({ x: start.x + deltaX, y: start.y + deltaY });
    }
    target.getLayer()?.batchDraw();
  };
  const finishDrag = (id: string, target: Konva.Node) => {
    const origin = dragStartPositions.current[id];
    if (!origin) return;
    const deltaX = target.x() - origin.x;
    const deltaY = target.y() - origin.y;
    moveDrag(id, target);
    const updates = Object.fromEntries(Object.entries(dragStartPositions.current).map(([member, start]) => [member, { x: Math.round(start.x + deltaX), y: Math.round(start.y + deltaY) }]));
    dragStartPositions.current = {};
    updateMany(updates);
  };
  const updatePicked = (changes: Partial<DesignNode>) => selectedNode && update(selectedNode.id, changes);
  const add = (node: DesignNode) => { setProject((p) => ({ ...p, nodes: [...p.nodes, node] })); setSelected([node.id]); };
  const placeImportedAsset = (asset: { id?: string; src: string; sourceName: string; sourceUrl?: string; width: number; height: number }, name = asset.sourceName) => {
    const scale = Math.min(project.width * .66 / asset.width, project.height * .58 / asset.height, 1);
    add({ id: uid(), name, type: 'image', x: Math.round((project.width - asset.width * scale) / 2), y: Math.round((project.height - asset.height * scale) / 2), width: Math.round(asset.width * scale), height: Math.round(asset.height * scale), rotation: 0, fill: '#fff', src: asset.src, sourceWidth: asset.width, sourceHeight: asset.height, sourceName: asset.sourceName, sourceUrl: asset.sourceUrl, visible: true, locked: false, opacity: 1 });
  };
  const addText = (text = 'Votre nouveau titre', size = 42) => add({ id: uid(), name: text.slice(0, 24), type: 'text', x: 70, y: 400, width: 600, height: 100, rotation: 0, fill: '#252a25', text, fontSize: size, fontFamily: 'Georgia', fontStyle: 'bold', visible: true, locked: false, opacity: 1 });
  const addShape = (type: 'rect'|'ellipse') => add({ id: uid(), name: type === 'rect' ? 'Rectangle' : 'Cercle', type, x: 120, y: 410, width: 150, height: 150, rotation: 0, fill: '#cbd3bd', visible: true, locked: false, opacity: 1 });
  const importFiles = async (files: FileList | File[]) => {
    setBusy(true);
    try {
      for (const file of Array.from(files).filter((item) => ['image/png', 'image/jpeg', 'image/webp'].includes(item.type))) {
        if (file.size > 30 * 1024 * 1024) continue;
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const loaded = new Image();
          loaded.onload = () => resolve(loaded);
          loaded.onerror = reject;
          loaded.src = dataUrl;
        });
        const asset = await storeAsset({ projectId: project.id, name: file.name, dataUrl, width: image.naturalWidth, height: image.naturalHeight });
        const scale = Math.min(project.width * .66 / image.naturalWidth, project.height * .58 / image.naturalHeight, 1);
        add({ id: uid(), name: file.name, type: 'image', x: Math.round((project.width - image.naturalWidth * scale) / 2), y: Math.round((project.height - image.naturalHeight * scale) / 2), width: Math.round(image.naturalWidth * scale), height: Math.round(image.naturalHeight * scale), rotation: 0, fill: '#fff', src: asset.src, sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight, visible: true, locked: false, opacity: 1 });
      }
      setPanel('uploads');
    } finally {
      setBusy(false);
    }
  };
  const removeBackground = async (imageIds: string[] = selected, model: 'universal'|'portrait' = cutoutModel, reportProgress?: (message: string) => void) => {
    const targets = project.nodes.filter((node) => imageIds.includes(node.id) && node.type === 'image' && node.src);
    if (!targets.length) return project;
    setBusy(true);
    setCutoutProgress(`Loading the bundled ${model === 'universal' ? 'BiRefNet Lite' : 'MODNet'} model`);
    reportProgress?.(`Loading the bundled ${model === 'universal' ? 'BiRefNet Lite' : 'MODNet'} model`);
    const failures: string[] = [];
    const updates: Record<string, Partial<DesignNode>> = {};
    let completed = 0;
    let preparedProject = project;
    try {
      for (let index = 0; index < targets.length; index += 1) {
        const node = targets[index];
        const sourceUrl = node.originalSrc ?? node.src;
        if (!sourceUrl) continue;
        const baseName = node.name.replace(/ · (?:BiRefNet Lite|MODNet)$/, '');
        setCutoutProgress(`Segmenting ${index + 1}/${targets.length}: ${baseName}`);
        reportProgress?.(`Segmenting ${index + 1}/${targets.length}: ${baseName}`);
        try {
          const originalResponse = await fetch(sourceUrl);
          if (!originalResponse.ok) throw new Error(`Could not load the source image (${originalResponse.status}).`);
          const original = await originalResponse.blob();
          const sourceBitmap = await createImageBitmap(original);
          const sourceWidth = sourceBitmap.width;
          const sourceHeight = sourceBitmap.height;
          sourceBitmap.close();
          const segmentation = await segmentForeground(original, model, (message, progress) => {
            const status = `${message}${progress ? ` · ${progress}%` : ''}`;
            setCutoutProgress(status);
            reportProgress?.(status);
          });
          const transparent = await applyForegroundMask(original, segmentation);
          const originalSrc = node.originalSrc ?? sourceUrl;
          const maskBlob = await maskToBlob(segmentation.mask, segmentation.width, segmentation.height);
          const [png, maskPng] = await Promise.all([blobToDataUrl(transparent), blobToDataUrl(maskBlob)]);
          const [asset, maskAsset] = await Promise.all([
            storeAsset({ projectId: project.id, name: `${baseName}-${segmentation.model === 'universal' ? 'BiRefNet-Lite' : 'MODNet'}.png`, dataUrl: png, width: sourceWidth, height: sourceHeight }),
            storeAsset({ projectId: project.id, name: `${baseName}-mask.png`, dataUrl: maskPng, width: segmentation.width, height: segmentation.height }),
          ]);
          const modelLabel = segmentation.model === 'universal' ? 'BiRefNet Lite' : 'MODNet';
          updates[node.id] = { src: asset.src, originalSrc, maskSrc: maskAsset.src, name: `${baseName} · ${modelLabel}` };
          completed += 1;
        } catch (error) {
          failures.push(`${baseName}: ${error instanceof Error ? error.message : 'segmentation failed'}`);
        }
      }
      if (Object.keys(updates).length) {
        preparedProject = { ...project, nodes: project.nodes.map((node) => updates[node.id] ? { ...node, ...updates[node.id] } : node) };
        setProject(preparedProject);
        preparedProject = await saveProjectInOrder({ ...preparedProject, background });
      }
      if (failures.length) window.alert(`AI background removal completed for ${completed}/${targets.length} images. Failed images were left unchanged. ${failures.join(' ')}`);
      if (!completed) throw new Error(failures.join(' ') || 'No images were prepared.');
      reportProgress?.(`Prepared ${completed}/${targets.length} images.`);
      return preparedProject;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Local AI background removal failed.';
      window.alert(`AI background removal failed. Original images were preserved. ${detail}`);
      if (reportProgress) throw error;
      return project;
    } finally {
      setCutoutProgress('');
      setBusy(false);
    }
  };
  const saveRefinedMask = async (blob: Blob, width: number, height: number) => {
    if (!maskTarget?.src) return;
    setBusy(true);
    try {
      const currentResponse = await fetch(maskTarget.originalSrc ?? maskTarget.src);
      if (!currentResponse.ok) throw new Error('The original image could not be loaded.');
      const original = await currentResponse.blob();
      const mask = await maskFromBlob(blob, width, height);
      const transparent = await applyForegroundMask(original, { width, height, mask });
      const [resultData, maskData] = await Promise.all([blobToDataUrl(transparent), blobToDataUrl(blob)]);
      const [asset, maskAsset] = await Promise.all([
        storeAsset({ projectId: project.id, name: `${maskTarget.name}-refined.png`, dataUrl: resultData, width, height }),
        storeAsset({ projectId: project.id, name: `${maskTarget.name}-refined-mask.png`, dataUrl: maskData, width, height }),
      ]);
      update(maskTarget.id, { src: asset.src, maskSrc: maskAsset.src });
      setMaskTarget(null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not save the refined mask.');
    } finally {
      setBusy(false);
    }
  };
  const createCustomTemplate = async () => {
    const title = window.prompt(lang === 'fr' ? 'Nom du modèle produit' : 'Custom product template name', project.name);
    if (!title?.trim()) return;
    const id = `custom-${fileName(title).slice(0, 44) || uid()}`;
    const physical = physicalSizeMm(project);
    const template: ProductTemplate = { id, name: title.trim(), kind: 'custom', model: 'flat', widthMm: physical.width, heightMm: physical.height, regions: [{ id: 'surface', name: 'Printable surface', x: 0, y: 0, width: 1, height: 1 }], surface: 'flat', camera: [0, 0, 5] };
    try {
      const savedTemplate = await createProductTemplate(template);
      setTemplates((items) => [...items.filter((item) => item.id !== savedTemplate.id), savedTemplate]);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to save template');
    }
  };
  const applyTemplate = (id: string) => {
    const template = templates.find((item) => item.id === id) ?? getProductTemplate(id);
    setProject((current) => applyProductTemplate(current, template));
    setPrintWarnings([]);
  };
  const optimize = () => {
    const generation = createLayoutAlternatives(project);
    setLayoutOriginal(project);
    setLayoutGeneration(generation);
    setAlternatives(generation.alternatives);
    setSelectedLayoutMode(generation.alternatives[0]?.mode ?? null);
    setLayoutApplied(false);
    setShowOptimizer(true);
  };
  const applyLayout = (alternative: LayoutAlternative) => {
    if (!alternative.metrics.valid) return;
    setProject(alternative.project);
    setSelectedLayoutMode(alternative.mode);
    setLayoutApplied(true);
  };
  const closeOptimizer = (restoreOriginal = false) => {
    if (restoreOriginal && layoutApplied && layoutOriginal) setProject(layoutOriginal);
    setShowOptimizer(false);
  };
  const checkPrint = () => { setPrintWarnings(validatePrint({ ...project, background })); setPrintChecked(true); };
  const exportPng = async (transparent = false) => {
    try {
      const size = await exportProductionPng({ ...project, background }, transparent);
      window.alert(`Production PNG exported: ${size.width} × ${size.height}px at ${project.printSettings?.resolutionDpi ?? 300} DPI.`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'PNG export failed');
    }
  };
  const exportJpeg = async () => {
    try {
      const result = await exportProductionJpeg({ ...project, background });
      window.alert(`Production JPEG exported: ${result.width} × ${result.height}px at ${project.printSettings?.resolutionDpi ?? 300} DPI (${result.colorSpace}).`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'JPEG export failed');
    }
  };
  const exportPdf = async () => {
    try {
      const warnings = validatePrint({ ...project, background });
      setPrintWarnings(warnings);
      setPrintChecked(true);
      if (warnings.some((warning) => warning.severity === 'error')) return;
      await exportProductionPdf({ ...project, background });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'PDF export failed');
    }
  };
  const deletePicked = useCallback(() => { setProject((p) => ({ ...p, nodes: p.nodes.filter((node) => !selected.includes(node.id)) })); setSelected([]); }, [selected]);
  const duplicatePicked = () => {
    const result = duplicateObjects(project.nodes, selected, uid);
    if (result.selected.length) {
      setProject((current) => ({ ...current, nodes: result.nodes }));
      setSelected(result.selected);
    }
  };
  const groupPicked = () => {
    if (selected.length < 2) return;
    setProject((current) => ({ ...current, nodes: groupObjects(current.nodes, selected) }));
  };
  const ungroupPicked = () => {
    setProject((current) => ({ ...current, nodes: ungroupObjects(current.nodes, selected) }));
  };
  const lockPicked = () => setProject((current) => ({ ...current, nodes: toggleObjectsLocked(current.nodes, selected) }));
  const moveLayer = (direction: 'up'|'down') => setProject((current) => ({ ...current, nodes: reorderObjects(current.nodes, selected, direction) }));
  const applyCrop = (crop: NormalizedCrop) => {
    if (!cropTarget) return;
    update(cropTarget.id, { crop: crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1 ? undefined : crop });
    setCropTarget(null);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target;
      const editingText = target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || (target instanceof HTMLInputElement && ['text', 'search', 'url', 'tel', 'email', 'password', 'number'].includes(target.type)));
      if ((event.key === 'Delete' || event.key === 'Backspace') && !editingText) { event.preventDefault(); deletePicked(); return; }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !editingText) {
        const shortcut = event.key.toLowerCase();
        if (shortcut === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
        if (shortcut === 'y') { event.preventDefault(); redo(); return; }
        if (shortcut === 'd') { event.preventDefault(); duplicatePicked(); return; }
        if (shortcut === 'g') { event.preventDefault(); if (event.shiftKey) ungroupPicked(); else groupPicked(); return; }
      }
      if (event.key === 'Escape') setSelected([]);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [deletePicked, undo, redo, duplicatePicked, groupPicked, ungroupPicked, setSelected]);
  const startProductionAutomation = () => {
    productionCheckpoint.current = captureStudioCheckpoint();
    productionCheckpointAt.current = new Date().toISOString();
    setProductionAssistantOpen(true);
  };
  const completeProductionAutomation = (result: ProductionAssistantResult) => {
    const before = productionCheckpoint.current ?? captureStudioCheckpoint();
    const beforeProject = before.project;
    setBackground(beforeProject.background ?? '#f6f5f1');
    if (result.project.id !== beforeProject.id || result.project !== beforeProject) {
      loadProject(result.project);
      setSelected([]);
    }
    setProjects((items) => {
      const merged = [...result.createdProjects, ...(result.createdProjects.length ? items : [result.project, ...items])];
      return merged.filter((item, index) => merged.findIndex((candidate) => candidate.id === item.id) === index);
    });
    setLastProductionRun({ before, background, createdProjects: result.createdProjects, assetsCreatedAfter: productionCheckpointAt.current || new Date().toISOString() });
    if (result.warnings?.length) window.alert(`${lang === 'fr' ? 'Certaines déclinaisons ont été ignorées :' : 'Some formats were skipped:'}\n${result.warnings.join('\n')}`);
    setProductionAssistantOpen(false);
    productionCheckpoint.current = null;
    productionCheckpointAt.current = '';
  };
  const undoLastProductionAutomation = async () => {
    if (!lastProductionRun) return;
    try {
      if (lastProductionRun.createdProjects.length) {
        await Promise.all(lastProductionRun.createdProjects.map((item) => deleteProject(item.id, lastProductionRun.before.project.id)));
      } else {
        await saveProject({ ...lastProductionRun.before.project, updatedAt: new Date().toISOString() });
        await pruneProjectAssets(lastProductionRun.before.project.id, lastProductionRun.assetsCreatedAfter);
      }
      if (projectSaveTimer.current !== undefined) window.clearTimeout(projectSaveTimer.current);
      projectSaveTimer.current = undefined;
      setProjects((items) => items.filter((item) => !lastProductionRun.createdProjects.some((created) => created.id === item.id)));
      restoreStudioCheckpoint(lastProductionRun.before);
      setBackground(lastProductionRun.background);
      setLastProductionRun(null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to undo the last automation.');
    }
  };
  const newProject = async () => {
    const candidate = blank(lang === 'fr' ? 'Nouveau projet' : 'New project');
    try {
      const savedProject = await createProject(candidate);
      loadProject(savedProject);
      setProjects((list) => [savedProject, ...list]);
      setSelected([]);
    } catch {
      window.alert(lang === 'fr' ? 'Impossible de créer le projet. Vérifiez le service local puis réessayez.' : 'Unable to create the project. Check the local service and try again.');
    }
  };
  const exportSvg = () => { const content = project.nodes.filter((n) => n.visible).map((n) => { const transform = `transform="translate(${n.x} ${n.y}) rotate(${n.rotation} ${n.width/2} ${n.height/2})" opacity="${n.opacity}"`; if (n.type === 'text') return `<text ${transform} fill="${n.fill}" font-family="${n.fontFamily ?? 'Arial'}" font-size="${n.fontSize ?? 24}" font-weight="${n.fontStyle === 'bold' ? 700 : 400}">${(n.text ?? '').replace(/[<>&]/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]!))}</text>`; if (n.type === 'image') { const sourceWidth=n.sourceWidth??n.width,sourceHeight=n.sourceHeight??n.height,crop=n.crop??{x:0,y:0,width:1,height:1};return `<svg ${transform} width="${n.width}" height="${n.height}" viewBox="${crop.x*sourceWidth} ${crop.y*sourceHeight} ${crop.width*sourceWidth} ${crop.height*sourceHeight}" preserveAspectRatio="none"><image width="${sourceWidth}" height="${sourceHeight}" href="${n.src}"/></svg>`; } if (n.type === 'ellipse') return `<ellipse ${transform} cx="${n.width/2}" cy="${n.height/2}" rx="${n.width/2}" ry="${n.height/2}" fill="${n.fill}"/>`; return `<rect ${transform} width="${n.width}" height="${n.height}" fill="${n.fill}"/>`; }).join(''); const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${project.width}" height="${project.height}" viewBox="0 0 ${project.width} ${project.height}"><rect width="100%" height="100%" fill="${background}"/>${content}</svg>`; const link = document.createElement('a'); link.download = `${fileName(project.name)}.svg`; link.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); };
  const generateLayout = () => { const words = prompt.trim(); if (!words) return; const accent = /botan|jardin|fleur|flower|plant|leaf|natur/i.test(words) ? '#d0714c' : '#285f68'; const prefix = uid(); const nodes: DesignNode[] = [ { id: `${prefix}a`, name: 'Repère graphique', type: 'rect', x: 52, y: 58, width: 70, height: 4, rotation: 0, fill: accent, visible: true, locked: false, opacity: 1 }, { id: `${prefix}b`, name: 'Titre généré', type: 'text', x: 52, y: 180, width: 670, height: 155, rotation: 0, fill: '#252a25', text: words.slice(0, 34), fontSize: 52, fontFamily: 'Georgia', fontStyle: 'bold', visible: true, locked: false, opacity: 1 }, { id: `${prefix}c`, name: 'Forme d’accent', type: 'ellipse', x: 420, y: 455, width: 180, height: 205, rotation: -12, fill: accent, visible: true, locked: false, opacity: .88 }, { id: `${prefix}d`, name: 'Légende', type: 'text', x: 52, y: 820, width: 650, height: 65, rotation: 0, fill: '#64685c', text: words, fontSize: 16, fontFamily: 'Arial', visible: true, locked: false, opacity: 1 } ]; setProject((p) => ({ ...p, nodes: [...p.nodes, ...nodes] })); setSelected([nodes[1].id]); setShowAi(false); setPrompt(''); setPanel('design'); };
  const runConfiguredAI = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setAIResult('');
    try {
      if (aiTask === 'marketing' || aiTask === 'layout') {
        const result = aiMode === 'local' ? await requestLocalText(aiTask, prompt.trim()) : await requestAIText(aiTask, prompt.trim());
        setAIResult(result.text);
        if (aiTask === 'marketing') addText(result.text.slice(0, 180), 28);
        setShowAi(false);
        return;
      }
      const target = selectedNode?.type === 'image' ? selectedNode : undefined;
      if (aiMode === 'local' && aiTask !== 'image') throw new Error('Local mode supports poster/image generation and text tasks. Image editing and variations require the remote provider mode.');
      if (aiTask !== 'image' && !target?.src) throw new Error('Select an image object before editing or creating a variation.');
      let imageDataUrl: string | undefined;
      if (target?.src && aiTask !== 'image') {
        const imageResponse = await fetch(target.src);
        if (!imageResponse.ok) throw new Error('The selected image could not be loaded.');
        imageDataUrl = await blobToDataUrl(await imageResponse.blob());
      }
      await saveProjectInOrder({ ...project, background });
      const task = aiTask === 'image' ? 'generate' : aiTask === 'edit' ? 'edit' : 'variation';
      const asset = aiMode === 'local' ? await requestLocalPosterImage({ projectId: project.id, prompt: prompt.trim() }) : await requestAIImage({ projectId: project.id, task, prompt: prompt.trim(), imageDataUrl });
      if (task === 'edit' && target) update(target.id, { src: asset.src, originalSrc: undefined, maskSrc: undefined, sourceWidth: asset.width, sourceHeight: asset.height, sourceName: asset.sourceName, name: `${target.name} · AI edit` });
      else placeImportedAsset({ ...asset, sourceName: asset.sourceName || 'AI generated image' }, 'AI generated image');
      setShowAi(false);
      setPrompt('');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'AI request failed. Check provider settings and try again.');
    } finally {
      setBusy(false);
    }
  };
  const arrange = () => setProject((p) => { const nodes = [...p.nodes]; const gap = (p.height - 100) / Math.max(1, nodes.length); return { ...p, nodes: nodes.map((n, i) => n.locked ? n : { ...n, x: Math.round((p.width-n.width)/2), y: Math.round(50+i*gap) }) }; });
  const format = `${(project.width/96*2.54).toFixed(1)} × ${(project.height/96*2.54).toFixed(1)} cm`;
  const buttons: {id: typeof panel; icon: React.ReactNode; label: string}[] = [{id:'design',icon:<Move size={17}/>,label:t('design')},{id:'product',icon:<Box size={17}/>,label:lang==='fr'?'Produit':'Product'},{id:'print',icon:<Printer size={17}/>,label:lang==='fr'?'Impression':'Print'},{id:'uploads',icon:<FolderOpen size={17}/>,label:t('uploads')},{id:'text',icon:<Type size={17}/>,label:t('text')},{id:'elements',icon:<Shapes size={17}/>,label:t('elements')},{id:'background',icon:<Paintbrush size={17}/>,label:t('background')},{id:'assistant',icon:<Sparkles size={17}/>,label:t('askAi')}];
  const panelTitle = { design:t('design'), product:lang==='fr'?'Produit':'Product', print:lang==='fr'?'Impression':'Print', uploads:t('uploads'), text:t('text'), elements:t('elements'), background:t('background'), assistant:t('askAi') }[panel];

  return <div className="app-shell" data-project-id={project.id}>
    <header className="topbar"><div className="brand-lockup"><div className="brand-symbol"><i/><i/><i/></div><div className="brand-name">muse<span>.</span></div><div className="brand-divider"/><button className="workspace-switch"><b>A</b><span>{t('workspace')}<strong>Atelier nord</strong></span><ChevronDown size={13}/></button></div><div className="document-title"><input value={project.name} onChange={(e)=>setProject((p)=>({...p,name:e.target.value}))}/><span className={saved?'save-state':'save-state saving'}><Cloud size={12}/>{saved?t('saved'):t('saving')}</span></div><div className="top-actions"><button className="icon-button" title={t('undo')} onClick={undo}><Undo2 size={16}/></button><button className="icon-button" title={t('redo')} onClick={redo}><Redo2 size={16}/></button><button className="language-button" onClick={()=>setLang((l)=>l==='fr'?'en':'fr')}>{lang.toUpperCase()}</button><button className="share-button" onClick={()=>setExportOpen((open)=>!open)}><ArrowDownToLine size={15}/>{t('export')}<ChevronDown size={13}/></button></div></header>
    <main className={`studio ${expanded?'':'panel-collapsed'} ${inspectorExpanded?'':'inspector-collapsed'}`}>
      <aside className="tool-rail"><div>{buttons.map((b)=><button key={b.id} className={`rail-button ${panel===b.id?'active':''}`} title={b.label} onClick={()=>{setPanel(b.id);setExpanded(true);if(b.id==='assistant')setShowAi(true)}}>{b.icon}<span>{b.label}</span></button>)}</div><div className="rail-bottom"><button className="rail-button" onClick={newProject}><Plus size={18}/><span>{t('newDesign')}</span></button><button className="sidebar-toggle" aria-label={expanded?(lang==='fr'?'Réduire le panneau latéral':'Collapse sidebar'):(lang==='fr'?'Afficher le panneau latéral':'Show sidebar')} aria-pressed={expanded} title={expanded?(lang==='fr'?'Réduire le panneau latéral':'Collapse sidebar'):(lang==='fr'?'Afficher le panneau latéral':'Show sidebar')} onClick={()=>setExpanded((open)=>!open)}>{expanded?<PanelLeftClose size={17}/>:<PanelLeftOpen size={17}/>}</button><button className="rail-settings" aria-label="Backup and recovery" title="Backup and recovery" onClick={()=>setBackupOpen(true)}><Settings2 size={17}/></button></div></aside>
      {expanded && <aside className="asset-sidebar"><div className="sidebar-heading"><div><span className="eyebrow-label">{t('aiLabel')}</span><h1>{panelTitle}</h1></div><button className="panel-close" onClick={()=>setExpanded(false)}><PanelLeftClose size={16}/></button></div>
      {panel==='product' && <div className="product-panel"><p className="panel-copy">Select a reusable product profile. The editable artwork drives its 3D mockup.</p><label>Product template<select value={project.productTemplateId ?? 'poster'} onChange={(event) => applyTemplate(event.target.value)}>{templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}</select></label><div className="field-row"><label>Printable width<input type="number" min="10" max="3000" value={Math.round(physicalSizeMm(project).width * 10) / 10} onChange={(event) => setProject((current) => applyProductTemplate(current, templates.find((item) => item.id === current.productTemplateId) ?? getProductTemplate(current.productTemplateId), Math.max(10, +event.target.value || 10), physicalSizeMm(current).height))}/></label><label>Height<input type="number" min="10" max="3000" value={Math.round(physicalSizeMm(project).height * 10) / 10} onChange={(event) => setProject((current) => applyProductTemplate(current, templates.find((item) => item.id === current.productTemplateId) ?? getProductTemplate(current.productTemplateId), physicalSizeMm(current).width, Math.max(10, +event.target.value || 10)))}/></label></div><small>Millimeters · {project.width} × {project.height} artwork px</small><div className="region-list"><b>Printable regions</b>{(project.printableRegions ?? []).map((region) => <span key={region.id}><Check size={12}/>{region.name}</span>)}</div><button className="secondary-action" onClick={() => setShow3d(true)}><Rotate3D size={15}/>Open live 3D preview</button><button className="secondary-action" onClick={() => void createCustomTemplate()}><Plus size={15}/>Save current size as custom template</button><small>Rotatable product mockups are for presentation only.</small></div>}
      {panel==='print' && <div className="print-panel"><div className="physical-summary"><Ruler size={15}/><span>{physicalSizeMm(project).width.toFixed(1)} × {physicalSizeMm(project).height.toFixed(1)} mm</span></div><label>Resolution<select value={project.printSettings?.resolutionDpi ?? 300} onChange={(event) => setProject((current) => ({ ...current, printSettings: { ...current.printSettings!, resolutionDpi: +event.target.value } }))}><option value="150">150 DPI</option><option value="300">300 DPI</option><option value="600">600 DPI</option></select></label><div className="field-row"><label>Bleed mm<input type="number" min="0" max="20" step="0.5" value={project.printSettings?.bleedMm ?? 3} onChange={(event) => setProject((current) => ({ ...current, printSettings: { ...current.printSettings!, bleedMm: Math.max(0, +event.target.value || 0) } }))}/></label><label>Safe mm<input type="number" min="0" max="50" step="0.5" value={project.printSettings?.safeMarginMm ?? 5} onChange={(event) => setProject((current) => ({ ...current, printSettings: { ...current.printSettings!, safeMarginMm: Math.max(0, +event.target.value || 0) } }))}/></label></div><label>Color workflow<select value={project.printSettings?.colorProfile ?? 'sRGB'} onChange={(event) => setProject((current) => ({ ...current, printSettings: { ...current.printSettings!, colorProfile: event.target.value as 'sRGB'|'CMYK' } }))}><option value="sRGB">sRGB</option><option value="CMYK">CMYK · embedded ICC</option></select></label><label className="setting-check"><input type="checkbox" checked={project.printSettings?.cropMarks ?? true} onChange={(event) => setProject((current) => ({ ...current, printSettings: { ...current.printSettings!, cropMarks: event.target.checked } }))}/>Crop marks in PDF</label><label className="setting-check"><input type="checkbox" checked={project.printSettings?.transparentBackground ?? false} onChange={(event) => setProject((current) => ({ ...current, printSettings: { ...current.printSettings!, transparentBackground: event.target.checked } }))}/>Transparent PNG by default</label><div className="pixel-output">Output pixels: {outputPixelSize(project).width.toLocaleString()} × {outputPixelSize(project).height.toLocaleString()}</div><button className="assistant-generate" onClick={checkPrint}><BadgeCheck size={15}/>Validate print file</button>{printChecked&&printWarnings.length===0&&<div className="print-check-ok"><Check size={13}/>{lang==='fr'?'Aucun problème de production détecté.':'No production issues detected.'}</div>}{printWarnings.length>0&&<div className="print-warnings">{printWarnings.map((warning) => <div className={warning.severity} key={warning.code}><AlertTriangle size={13}/><span>{warning.message}</span></div>)}</div>}<div className="print-export-actions"><button onClick={() => void exportPng(false)}><FileImage size={14}/>Production PNG</button><button onClick={() => void exportPng(true)}><FileImage size={14}/>Transparent PNG</button><button onClick={() => void exportJpeg()}><FileImage size={14}/>Production JPEG</button><button onClick={() => void exportPdf()}><Printer size={14}/>Print-ready PDF</button></div><small>PNG exports are profiled sRGB; JPEG and PDF follow the selected color workflow. Generic CMYK profile is used.</small></div>}
      {panel==='design' && <><div className="panel-search"><Search size={14}/><input placeholder={t('recent')}/></div><button className="create-project" onClick={newProject}><Plus size={15}/>{t('newWorkspace')}</button><div className="sidebar-label"><span>{t('workspaces')}</span></div><div className="design-grid">{projects.map((p,i)=><button key={p.id} className={`design-card ${p.id===project.id?'chosen':''}`} onClick={()=>{loadProject(p);setSelected([]);setBackground(p.background??'#f6f5f1')}}><div className={`design-thumb thumb-${i%4}`}><span>{p.nodes.find((n)=>n.type==='text')?.text?.split('\n')[0]||'Nouveau design'}</span><i>✳</i></div><b>{p.name}</b><small>{lang==='fr'?'Modifié à l’instant':'Edited just now'}</small></button>)}</div><div className="recent-note"><span/> <p>{lang==='fr'?'Vos projets sont enregistrés localement.':'Your projects are saved locally.'}</p></div></>}
        {panel==='uploads' && <div className="upload-panel"><button className="upload-drop" onClick={()=>uploadRef.current?.click()}><span><Upload size={21}/></span><b>{t('upload')}</b><small>{t('uploadHint')}</small></button><button className="secondary-action" onClick={()=>uploadRef.current?.click()}><ImagePlus size={15}/>{t('chooseImage')}</button><small className="small-note">PNG, JPG, WebP · {lang==='fr'?'Fichiers conservés sur cet appareil.':'Files stay on this device.'}</small><CommonsSearch projectId={project.id} lang={lang} onImported={(asset)=>placeImportedAsset(asset, asset.sourceName)}/><PinterestImporter projectId={project.id} onImported={(asset)=>placeImportedAsset(asset, asset.sourceName)}/></div>}
        {panel==='text' && <div className="text-panel"><button className="text-style-card" onClick={()=>addText()}><b>Aa</b><span>{t('addText')}</span><Plus size={16}/></button><button className="text-style-card body-card" onClick={()=>addText('Un peu de douceur, chaque jour.',20)}><b>Aa</b><span>{t('addBody')}</span><Plus size={16}/></button></div>}
        {panel==='elements' && <div className="shape-grid"><button onClick={()=>addShape('rect')}><Square size={25}/><span>Rectangle</span></button><button onClick={()=>addShape('ellipse')}><Circle size={25}/><span>{lang==='fr'?'Cercle':'Circle'}</span></button></div>}
        {panel==='background' && <div className="background-panel"><p>{t('background')}</p><div className="swatches">{['#f6f5f1','#fffdfa','#eee9dd','#20231f','#d4ddce','#ebc6a8','#e7e7eb','#d97151'].map((color)=><button key={color} className="swatch" style={{background:color}} onClick={()=>setBackground(color)}/>)}</div></div>}
        {panel==='assistant' && <div className="assistant-panel"><div className="assistant-illustration"><WandSparkles size={22}/></div><h2>{t('askAi')}</h2><p>{t('assistantHint')}</p><button className="secondary-action" onClick={()=>setAISettingsOpen(true)}><Settings2 size={14}/>AI settings · {aiMode==='local'?'Local mode':aiConfigured?'provider configured':'provider key required'}</button><label className="prop-label">AI task<select value={aiTask} onChange={(event)=>setAITask(event.target.value as typeof aiTask)}><option value="image">Generate an image</option><option value="edit">Edit selected image</option><option value="variation">Create image variation</option><option value="marketing">Write marketing copy</option><option value="layout">AI composition advice</option></select></label><textarea value={prompt} onChange={(e)=>setPrompt(e.target.value)} placeholder={t('writePrompt')}/><button className="assistant-generate" disabled={!prompt.trim()||busy} onClick={()=>void runConfiguredAI()}><Sparkles size={15}/>{busy?'Working…':`Run AI · ${aiTask}`}</button><button className="secondary-action" onClick={generateLayout} disabled={!prompt.trim()}><WandSparkles size={14}/>Create local editable layout</button>{aiResult&&<div className="ai-result-box">{aiResult}</div>}<small>{aiMode==='local'?'Local Ollama and ComfyUI services handle text and image generation. Image edits and variations require remote provider mode.':aiConfigured?'Provider calls send prompts and, for image edits, your selected image to the configured service.':'No provider key is configured. Open AI settings to choose local mode or configure a remote provider.'}</small></div>}
        <input ref={uploadRef} className="hidden-input" type="file" accept="image/*,.svg" multiple onChange={(e)=>{if(e.target.files)void importFiles(e.target.files);e.target.value=''}}/>
      </aside>}
      <section className="editor-area"><div className="editor-toolbar"><div className="breadcrumb"><span>{t('projects')}</span><ChevronRight size={13}/><b>{project.name}</b></div><div><button className="toolbar-action assistant-generate" data-testid="open-production-assistant" onClick={startProductionAutomation}><WandSparkles size={14}/>{lang==='fr'?'AUTOMATISER':'AUTOMATE'}</button>{lastProductionRun&&<button className="toolbar-action" data-testid="undo-production-automation" onClick={()=>void undoLastProductionAutomation()}><Undo2 size={14}/>{lang==='fr'?'ANNULER IA':'UNDO AI'}</button>}<button className="toolbar-action optimizer-primary" onClick={optimize}><Sparkles size={14}/>{lang==='fr'?'OPTIMISER':'OPTIMIZE'}</button><button className="toolbar-action" onClick={() => setShow3d(true)}><Rotate3D size={14}/>3D</button><button className="toolbar-action" onClick={checkPrint}><Printer size={14}/>{lang==='fr'?'Vérifier':'Check print'}</button><span className="toolbar-rule"/><span className="avatar">A</span></div></div>
        <div className="canvas-viewport" onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{e.preventDefault();if(e.dataTransfer.files.length)void importFiles(e.dataTransfer.files)}}><div style={{width:project.width*zoom,height:project.height*zoom}}><Stage ref={stage} width={project.width*zoom} height={project.height*zoom} scaleX={zoom} scaleY={zoom} onMouseDown={(e)=>{if(e.target===e.target.getStage())setSelected([])}}><Layer><Rect width={project.width} height={project.height} fill={background} listening={false}/>{project.nodes.filter((n)=>n.visible).map((n)=>{const props={ref:(ref:Konva.Node|null)=>{if(ref)refs.current[n.id]=ref;else delete refs.current[n.id]},x:n.x,y:n.y,width:n.width,height:n.height,rotation:n.rotation,opacity:n.opacity,draggable:!n.locked,onClick:(e:Konva.KonvaEventObject<MouseEvent>)=>{e.cancelBubble=true;setSelected(selectObjects(project.nodes,selected,n.id,e.evt.shiftKey))},onDragStart:()=>startDrag(n.id),onDragMove:(e:Konva.KonvaEventObject<DragEvent>)=>moveDrag(n.id,e.target),onDragEnd:(e:Konva.KonvaEventObject<DragEvent>)=>finishDrag(n.id,e.target),onTransformEnd:()=>{const updates:Record<string,Partial<DesignNode>>={};for(const id of selected){const target=refs.current[id];const node=project.nodes.find((item)=>item.id===id);if(!target||node?.locked)continue;const sx=target.scaleX(),sy=target.scaleY();updates[id]={x:Math.round(target.x()),y:Math.round(target.y()),width:Math.max(12,Math.round(target.width()*sx)),height:Math.max(12,Math.round(target.height()*sy)),rotation:Math.round(target.rotation())};target.scaleX(1);target.scaleY(1)}updateMany(updates)}};if(n.type==='image')return <ImageNode key={n.id} node={n} canvasProps={props}/>;if(n.type==='text')return <Text key={n.id} {...props} text={n.text||''} fill={n.fill} fontFamily={n.fontFamily||'Arial'} fontSize={n.fontSize||24} fontStyle={n.fontStyle||'normal'} lineHeight={1.16} wrap="word" onDblClick={()=>{const text=window.prompt(lang==='fr'?'Modifier le texte':'Edit text',n.text);if(text!==null)update(n.id,{text,name:text.slice(0,24)})}}/>;if(n.type==='ellipse')return <Ellipse key={n.id} {...props} fill={n.fill}/>;return <Rect key={n.id} {...props} fill={n.fill}/>})}<Transformer ref={transformer} rotateEnabled borderStroke="#60745b" borderStrokeWidth={1} anchorFill="#fffdf8" anchorStroke="#60745b" anchorSize={7} rotateAnchorOffset={22} boundBoxFunc={(a,b)=>b.width<12||b.height<12?a:b}/></Layer></Stage></div><div className="print-badge"><span/>{t('dpi')} <i>·</i> {format}</div></div>
        <div className="canvas-footer"><div><span className="page-number">01</span><span>{project.name}</span><i/>{project.width} × {project.height} px</div><div className="canvas-controls"><button onClick={()=>{zoomManuallyAdjusted.current=true;setZoom((z)=>Math.max(.28,z-.06))}}><ZoomOut size={15}/></button><span>{Math.round(zoom*100)}%</span><button onClick={()=>{zoomManuallyAdjusted.current=true;setZoom((z)=>Math.min(1.1,z+.06))}}><ZoomIn size={15}/></button></div></div>
      </section>
      <aside className={`inspector ${inspectorExpanded?'':'is-collapsed'}`}><div className="inspector-tabs"><button className="active"><SlidersHorizontal size={14}/>{t('properties')}</button><span><Layers3 size={14}/>{t('layers')} {project.nodes.length}</span><button className="inspector-toggle" aria-label={inspectorExpanded?(lang==='fr'?'Réduire le panneau de propriétés':'Collapse properties panel'):(lang==='fr'?'Afficher le panneau de propriétés':'Show properties panel')} aria-pressed={inspectorExpanded} title={inspectorExpanded?(lang==='fr'?'Réduire le panneau de propriétés':'Collapse properties panel'):(lang==='fr'?'Afficher le panneau de propriétés':'Show properties panel')} onClick={()=>setInspectorExpanded((open)=>!open)}>{inspectorExpanded?<PanelRightClose size={15}/>:<PanelRightOpen size={15}/>}</button></div>
        {selectedNode?<><section className="inspector-section"><div className="selected-name"><span>{selectedNode.type==='text'?<Type size={14}/>:<Shapes size={14}/>}</span><b>{selectedNode.name}</b><button aria-label={selected.every((id)=>project.nodes.find((node)=>node.id===id)?.locked)?'Unlock selected objects':'Lock selected objects'} onClick={lockPicked}>{selectedNode.locked?<LockKeyhole size={14}/>:<UnlockKeyhole size={14}/>}</button><button onClick={deletePicked}><Trash2 size={14}/></button></div><label className="prop-label">{t('position')}</label><div className="field-row"><label>X<input type="number" value={Math.round(selectedNode.x)} onChange={(e)=>updatePicked({x:+e.target.value})}/></label><label>Y<input type="number" value={Math.round(selectedNode.y)} onChange={(e)=>updatePicked({y:+e.target.value})}/></label></div><label className="prop-label">{t('size')}</label><div className="field-row"><label>W<input type="number" value={Math.round(selectedNode.width)} onChange={(e)=>updatePicked({width:+e.target.value})}/></label><label>H<input type="number" value={Math.round(selectedNode.height)} onChange={(e)=>updatePicked({height:+e.target.value})}/></label></div><label className="prop-label">{t('rotation')}<input className="full-input" type="number" value={selectedNode.rotation} onChange={(e)=>updatePicked({rotation:+e.target.value})}/></label></section>
        {selectedNode.type==='text'&&<section className="inspector-section"><h3>{t('text')}</h3><textarea className="text-content-field" value={selectedNode.text||''} onChange={(e)=>updatePicked({text:e.target.value})}/><div className="field-row"><select value={selectedNode.fontFamily||'Arial'} onChange={(e)=>updatePicked({fontFamily:e.target.value})}><option>Georgia</option><option>Arial</option><option>Inter</option><option>Times New Roman</option></select><label><input type="number" value={selectedNode.fontSize||24} onChange={(e)=>updatePicked({fontSize:+e.target.value})}/> px</label></div></section>}
        {selectedNode.type==='image'&&<section className="inspector-section"><button className="secondary-action crop-open" aria-label="Crop selected image" onClick={()=>setCropTarget(selectedNode)}><Crop size={14}/>Crop image{selectedNode.crop?' · edited':''}</button><h3><Scissors size={14}/>AI background removal</h3><p className="panel-copy">BiRefNet Lite handles general subjects locally at 512px input resolution. MODNet remains available for portraits.</p><label className="prop-label">Segmentation model<select aria-label="Segmentation model" value={cutoutModel} onChange={(event)=>setCutoutModel(event.target.value as 'universal'|'portrait')}><option value="universal">Universal objects · BiRefNet Lite</option><option value="portrait">Portraits · MODNet</option></select></label><button className="secondary-action" disabled={busy} onClick={()=>void removeBackground()}><Scissors size={14}/>{busy?(cutoutProgress||'Running local AI…'):(selected.length>1?`Remove background (${selected.length} images)`:'Remove background')}</button>{selectedNode.originalSrc&&<><button className="secondary-action" disabled={busy} onClick={()=>setMaskTarget(selectedNode)}><Paintbrush size={14}/>Refine mask</button><button className="secondary-action" disabled={busy} onClick={()=>update(selectedNode.id,{src:selectedNode.originalSrc,originalSrc:undefined,maskSrc:undefined,name:selectedNode.name.replace(/ · (?:BiRefNet Lite|MODNet)$/,'')})}><Undo2 size={14}/>Restore original</button></>}</section>}
        <section className="inspector-section"><h3>{t('color')}</h3><div className="color-field"><input type="color" value={selectedNode.fill} onChange={(e)=>updatePicked({fill:e.target.value})}/><span>{selectedNode.fill.toUpperCase()}</span></div><label className="prop-label">{t('opacity')} {Math.round(selectedNode.opacity*100)}%</label><input className="range-input" type="range" min="0" max="100" value={selectedNode.opacity*100} onChange={(e)=>updatePicked({opacity:+e.target.value/100})}/></section></>:<><section className="inspector-section document-settings"><h3>{t('canvas')}</h3><label className="prop-label">{t('width')} (px)<input className="full-input" type="number" min="50" max="12000" value={project.width} onChange={(e)=>setProject((p)=>({...p,width:Math.max(50,Math.min(12000,+e.target.value||50))}))}/></label><label className="prop-label">{t('height')} (px)<input className="full-input" type="number" min="50" max="12000" value={project.height} onChange={(e)=>setProject((p)=>({...p,height:Math.max(50,Math.min(12000,+e.target.value||50))}))}/></label><small className="document-size-note">{format} · 300 DPI export</small></section><div className="inspector-empty"><Move size={18}/><p>{t('noSelection')}</p></div></>}
        <section className="inspector-section layer-section"><h3>{t('layers')} <span>{project.nodes.length}</span><button onClick={()=>addShape('rect')}><Plus size={14}/></button></h3><div className="layer-list">{[...project.nodes].reverse().map((n)=><div key={n.id} className={`layer-row ${selected.includes(n.id)?'selected':''}`} data-node-id={n.id} data-node-type={n.type} data-group-id={n.groupId??''} data-locked={n.locked} data-x={n.x} data-y={n.y} data-width={n.width} data-height={n.height} data-rotation={n.rotation} data-crop-x={n.crop?.x??''} data-crop-y={n.crop?.y??''} data-crop-width={n.crop?.width??''} data-crop-height={n.crop?.height??''} onClick={(event)=>setSelected(selectObjects(project.nodes,selected,n.id,event.shiftKey))}><span>{n.type==='text'?<Type size={13}/>:n.type==='image'?<ImagePlus size={13}/>:<Square size={13}/>}</span><b>{n.name}</b><button onClick={(e)=>{e.stopPropagation();update(n.id,{visible:!n.visible})}}><Eye size={13}/></button></div>)}</div>{selectedNode&&<div className="layer-order"><button title="Move up" aria-label="Move selected layers up" onClick={()=>moveLayer('up')}><ArrowUp size={14}/></button><button title="Move down" aria-label="Move selected layers down" onClick={()=>moveLayer('down')}><ArrowDown size={14}/></button><button title={t('duplicate')} aria-label="Duplicate selected objects" onClick={duplicatePicked}><Copy size={14}/></button>{selected.length>1&&<button title="Group objects" aria-label="Group selected objects" onClick={groupPicked}><Group size={14}/></button>}{selected.some((id)=>project.nodes.find((node)=>node.id===id)?.groupId)&&<button title="Ungroup objects" aria-label="Ungroup selected objects" onClick={ungroupPicked}><Ungroup size={14}/></button>}<button title="Delete selected objects" aria-label="Delete selected objects" onClick={deletePicked}><Trash2 size={14}/></button></div>}</section><div className="inspector-bottom"><span/> {lang==='fr'?'Prêt pour l’impression':'Print ready'}<Settings2 size={14}/></div>
      </aside>
    </main>
    {cropTarget&&<ImageCropEditor node={cropTarget} onCancel={()=>setCropTarget(null)} onApply={applyCrop}/>}
    {maskTarget?.maskSrc&&<MaskEditor sourceUrl={maskTarget.originalSrc??maskTarget.src!} maskUrl={maskTarget.maskSrc} title={maskTarget.name} onCancel={()=>setMaskTarget(null)} onApply={(blob,width,height)=>void saveRefinedMask(blob,width,height)}/>}
    {showOptimizer && <div className="modal-backdrop" data-testid="smart-layout-dialog" onMouseDown={(event)=>{if(event.target===event.currentTarget)closeOptimizer(true)}}><section className="optimizer-modal"><header><div><span>SMART LAYOUT · GEOMETRIC HEURISTICS</span><h2>{lang==='fr'?'Choisir une composition':'Choose a composition'}</h2></div><button aria-label="Close Smart Layout" onClick={()=>closeOptimizer(true)}><X size={17}/></button></header><p>{lang==='fr'?'Comparez les propositions validées avant de modifier votre document.':'Compare validated alternatives before changing your document.'} {layoutGeneration?`${alternatives.length} valid / 6 · ${layoutGeneration.generationMs.toFixed(1)} ms`:''}</p><p className="layout-analysis-note">{smartLayoutAnalysisDescription}</p>{layoutGeneration?.explanation&&<p className="layout-generation-status" role="status">{layoutGeneration.explanation}</p>}<div className="optimizer-grid">{alternatives.map((alternative)=><article key={alternative.mode} data-testid={`layout-card-${alternative.mode}`} className={selectedLayoutMode===alternative.mode?'layout-card-selected':''}><button className="layout-card-select" data-testid={`layout-preview-${alternative.mode}`} aria-pressed={selectedLayoutMode===alternative.mode} onClick={()=>setSelectedLayoutMode(alternative.mode)}><div className="optimizer-card-preview"><LayoutPreview project={alternative.project}/></div><div className="optimizer-card-info"><b>{alternative.label}</b><small>Score {alternative.metrics.layoutScore} · {alternative.metrics.preservedObjects} preserved</small><small>{alternative.metrics.unintendedCollisions} collisions · {alternative.metrics.minimumSpacingViolations} spacing · {alternative.metrics.safeAreaViolations} safe-area · {alternative.metrics.outOfBoundsObjects} out-of-bounds</small></div></button></article>)}</div>{selectedLayoutMode&&alternatives.find((alternative)=>alternative.mode===selectedLayoutMode)&&<div className="layout-selected-preview" data-testid="selected-layout-preview"><div className="layout-selected-art"><LayoutPreview project={alternatives.find((alternative)=>alternative.mode===selectedLayoutMode)!.project}/></div><div><b>{alternatives.find((alternative)=>alternative.mode===selectedLayoutMode)!.label}</b><small>{alternatives.find((alternative)=>alternative.mode===selectedLayoutMode)!.metrics.valid?'Valid for the current printable regions and safe margins.':'Invalid layouts cannot be applied.'}</small><button data-testid="apply-selected-layout" disabled={!alternatives.find((alternative)=>alternative.mode===selectedLayoutMode)!.metrics.valid} onClick={()=>applyLayout(alternatives.find((alternative)=>alternative.mode===selectedLayoutMode)!)}>{layoutApplied&&layoutGeneration?.alternatives.find((alternative)=>alternative.mode===selectedLayoutMode)?.project===project?(lang==='fr'?'Composition appliquée':'Applied'):lang==='fr'?'Appliquer cette composition':'Apply selected layout'}</button></div></div>}{!alternatives.length&&<div className="layout-generation-empty" role="status">{layoutGeneration?.explanation??'No valid layout alternatives were generated.'}</div>}<footer className="layout-modal-footer"><span>{lang==='fr'?'Les objets restent modifiables. Annuler restaure la composition d’origine.':'Objects remain editable. Reject restores the original composition.'}</span><div><button data-testid="reject-layout" onClick={()=>closeOptimizer(true)}>{layoutApplied?(lang==='fr'?'Restaurer l’original':'Restore original'):(lang==='fr'?'Rejeter':'Reject')}</button><button data-testid="keep-layout" disabled={!layoutApplied} onClick={()=>closeOptimizer(false)}>{lang==='fr'?'Garder la composition':'Keep layout'}</button></div></footer></section></div>}
    {show3d && <ProductPreview project={project} template={templates.find((item)=>item.id===project.productTemplateId)??getProductTemplate(project.productTemplateId)} onClose={()=>setShow3d(false)}/>}
    {showAi&&<div className="modal-backdrop" onMouseDown={(e)=>{if(e.target===e.currentTarget)setShowAi(false)}}><section className="assistant-modal"><div className="modal-top"><span><Sparkles size={14}/>{t('aiLabel')}</span><button onClick={()=>setShowAi(false)}><X size={17}/></button></div><h2>{t('askAi')}</h2><p>{aiMode==='local'?'Local mode uses Ollama for text and ComfyUI for image generation. Image editing and variations require remote provider mode.':'Use your configured provider for image generation, image editing, variations, or marketing text. Prompts and selected edit images are sent to that provider.'}</p><label className="prop-label">AI task<select value={aiTask} onChange={(event)=>setAITask(event.target.value as typeof aiTask)}><option value="image">Generate image</option><option value="edit">Edit selected image</option><option value="variation">Create variation</option><option value="marketing">Marketing copy</option><option value="layout">Composition advice</option></select></label><textarea autoFocus value={prompt} onChange={(e)=>setPrompt(e.target.value)} placeholder={t('writePrompt')}/><div className="modal-actions"><button onClick={()=>{setShowAi(false);setAISettingsOpen(true)}}>Provider settings</button><button className="assistant-generate" disabled={!prompt.trim()||busy} onClick={()=>void runConfiguredAI()}><Sparkles size={15}/>{busy?'Working…':'Run AI'}</button></div><button className="secondary-action" onClick={generateLayout} disabled={!prompt.trim()}>Create local editable layout</button><small>{aiMode==='local'?'Local services handle your prompt; no provider receives it.':aiConfigured?'Prompts go to the configured service; selected images are sent only for image edit/variation.':'Choose local AI or configure a provider in AI settings.'}</small></section></div>}
    {aiSettingsOpen&&<AISettings onClose={()=>setAISettingsOpen(false)} onSaved={(settings: AIProviderSettings)=>{setAIConfigured(settings.apiKeyConfigured);setAIMode(settings.mode)}}/>}{backupOpen&&<BackupManager lang={lang} onClose={()=>setBackupOpen(false)} onPrepare={flushProjectSave}/>}{productionAssistantOpen&&<ProductionAssistant project={project} templates={templates} lang={lang} onClose={()=>setProductionAssistantOpen(false)} onPrepare={removeBackground} onComplete={completeProductionAutomation} aiConfigured={aiConfigured} aiMode={aiMode} onConfigureAI={() => setAISettingsOpen(true)}/>}
    <footer className="app-status"><span>● &nbsp;{saved?t('saved'):t('saving')}　·　{project.nodes.length} {t('layers').toLowerCase()}</span><button onClick={()=>void exportPdf()}><FileImage size={13}/>{t('exportPdf')}</button></footer><div className={`export-menu ${exportOpen?'open':''}`}><button onClick={()=>{setExportOpen(false);exportPng()}}><FileImage size={14}/>{t('exportPng')}<span>300 DPI</span></button><button onClick={()=>{setExportOpen(false);exportSvg()}}><Shapes size={14}/>{t('exportSvg')}<span>Vector</span></button><button onClick={()=>{setExportOpen(false);void exportPdf()}}><ArrowDownToLine size={14}/>{t('exportPdf')}<span>Print</span></button></div>
  </div>;
}
export default App;

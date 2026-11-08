import { useEffect, useState } from 'react';
import { AlertTriangle, Check, LoaderCircle, Sparkles, X } from 'lucide-react';
import { createProject, deleteProject, getLocalAISettings, requestAIImage, requestAIText, requestLocalPosterImage, requestLocalPosterPlan, saveProject, storeAsset } from './api';
import type { LocalAIStatus } from './api';
import type { ProductTemplate } from './product-templates';
import { applyProductTemplate, getProductTemplate } from './product-templates';
import { adaptProjectToTemplate, createPosterDraft, parsePosterBrief } from './production-automation';
import type { DesignProject } from './types';

export type ProductionMode = 'poster' | 'adapt' | 'prepare';
export type ProductionAssistantResult = { project: DesignProject; createdProjects: DesignProject[]; warnings?: string[] };

async function readAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read the image asset.'));
    reader.readAsDataURL(blob);
  });
}

async function cloneLocalAssets(project: DesignProject, projectId: string): Promise<DesignProject> {
  const remapped = new Map<string, string>();
  for (const node of project.nodes) {
    for (const source of [node.src, node.originalSrc, node.maskSrc]) {
      if (!source || remapped.has(source) || !/^\/api\/assets\/[0-9a-f-]{36}$/i.test(source)) continue;
      const response = await fetch(source);
      if (!response.ok) throw new Error(`Unable to copy a linked project image (${response.status}).`);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      const asset = await storeAsset({ projectId, name: node.sourceName ?? node.name, dataUrl: await readAsDataUrl(blob), width: bitmap.width, height: bitmap.height, sourceName: node.sourceName });
      bitmap.close();
      remapped.set(source, asset.src);
    }
  }
  return {
    ...project,
    nodes: project.nodes.map((node) => ({
      ...node,
      src: node.src ? remapped.get(node.src) ?? node.src : undefined,
      originalSrc: node.originalSrc ? remapped.get(node.originalSrc) ?? node.originalSrc : undefined,
      maskSrc: node.maskSrc ? remapped.get(node.maskSrc) ?? node.maskSrc : undefined,
    })),
  };
}

export function ProductionAssistant({ project, templates, lang, onClose, onPrepare, onComplete, aiConfigured, aiMode, onConfigureAI }: {
  project: DesignProject;
  templates: ProductTemplate[];
  lang: 'fr' | 'en';
  onClose: () => void;
  onPrepare: (imageIds: string[], model: 'universal' | 'portrait', onProgress: (message: string) => void) => Promise<DesignProject>;
  onComplete: (result: ProductionAssistantResult) => void;
  aiConfigured: boolean;
  aiMode: 'local' | 'provider';
  onConfigureAI: () => void;
}) {
  const french = lang === 'fr';
  const [mode, setMode] = useState<ProductionMode>('poster');
  const [prompt, setPrompt] = useState('');
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>(() => [project.productTemplateId ?? 'poster']);
  const [selectedImages, setSelectedImages] = useState<string[]>(() => project.nodes.filter((node) => node.type === 'image' && node.src).map((node) => node.id));
  const [model, setModel] = useState<'universal' | 'portrait'>('universal');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [localStatus, setLocalStatus] = useState<LocalAIStatus | null>(null);
  const imageNodes = project.nodes.filter((node) => node.type === 'image' && node.src);
  const availableTemplates = templates.length ? templates : [getProductTemplate('poster')];
  const localPosterReady = !!localStatus?.selectedTextModelAvailable && !!localStatus.selectedCheckpointAvailable;

  useEffect(() => {
    if (aiMode !== 'local') return;
    void getLocalAISettings().then((settings) => setLocalStatus(settings.status ?? null)).catch(() => setLocalStatus(null));
  }, [aiMode]);
  const toggleTemplate = (id: string) => setSelectedTemplates((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleImage = (id: string) => setSelectedImages((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const run = async () => {
    setBusy(true);
    setError('');
    const created: DesignProject[] = [];
    try {
      if (mode === 'prepare') {
        if (!selectedImages.length) throw new Error(french ? 'Sélectionnez au moins une image.' : 'Select at least one image.');
        setProgress(french ? 'Détourage local des images sélectionnées…' : 'Locally removing backgrounds from selected images…');
        const preparedProject = await onPrepare(selectedImages, model, setProgress);
        onComplete({ project: preparedProject, createdProjects: [] });
        setProgress(french ? 'Images préparées.' : 'Images prepared.');
        return;
      }
      const selectedTargetTemplates = availableTemplates.filter((template) => selectedTemplates.includes(template.id));
      const targetTemplates = mode === 'poster' ? [getProductTemplate('poster'), ...selectedTargetTemplates.filter((template) => template.id !== 'poster')] : selectedTargetTemplates;
      if (!targetTemplates.length) throw new Error(french ? 'Choisissez au moins un produit ou format.' : 'Choose at least one product or format.');
      let sourceForTargets = project;
      if (mode === 'poster') {
        if (!prompt.trim()) throw new Error(french ? 'Décrivez l’affiche souhaitée.' : 'Describe the poster you want.');
        setProgress(french ? 'Création du brief et des textes…' : 'Creating the brief and poster copy…');
        const planResponse = aiMode === 'local' ? await requestLocalPosterPlan(prompt.trim()) : await requestAIText('poster-plan', prompt.trim());
        const brief = parsePosterBrief(planResponse.text);
        const posterTemplate = getProductTemplate('poster');
        const posterBase = applyProductTemplate({ ...project, id: crypto.randomUUID(), nodes: [] }, posterTemplate);
        const draft = createPosterDraft(posterBase, brief, () => crypto.randomUUID(), project.id);
        setProgress(french ? 'Préparation de l’illustration…' : 'Generating the poster artwork…');
        const createdBase = await createProject(draft);
        created.push(createdBase);
        const image = aiMode === 'local' ? await requestLocalPosterImage({ projectId: createdBase.id, prompt: brief.imagePrompt }) : await requestAIImage({ projectId: createdBase.id, task: 'generate', prompt: brief.imagePrompt });
        const completedDraft = await saveProject({
          ...createdBase,
          nodes: createdBase.nodes.map((node) => node.name === 'Generated artwork' ? { ...node, src: image.src, sourceWidth: image.width, sourceHeight: image.height, sourceName: image.sourceName } : node),
        });
        created[0] = completedDraft;
        sourceForTargets = completedDraft;
      }
      const outputs: DesignProject[] = [];
      const warnings: string[] = [];
      for (const template of targetTemplates) {
        setProgress(french ? `Adaptation : ${template.name}…` : `Adapting to ${template.name}…`);
        if (mode === 'poster' && template.id === 'poster') {
          outputs.push(sourceForTargets);
          continue;
        }
        let shell: DesignProject | undefined;
        try {
          const id = crypto.randomUUID();
          let candidate: DesignProject = adaptProjectToTemplate(sourceForTargets, template, id, () => crypto.randomUUID());
          shell = await createProject(candidate);
          created.push(shell);
          candidate = await cloneLocalAssets(candidate, shell.id);
          const saved = await saveProject({ ...candidate, id: shell.id });
          created[created.length - 1] = saved;
          outputs.push(saved);
        } catch (reason) {
          if (shell) {
            await deleteProject(shell.id, project.id).catch(() => undefined);
            const createdIndex = created.findIndex((item) => item.id === shell!.id);
            if (createdIndex >= 0) created.splice(createdIndex, 1);
          }
          const message = reason instanceof Error ? reason.message : 'The format could not be adapted.';
          warnings.push(`${template.name}: ${message}`);
        }
      }
      const selected = outputs[0];
      if (!selected) throw new Error(french ? 'Aucune déclinaison valide n’a été créée.' : 'No valid format variant was created.');
      onComplete({ project: selected, createdProjects: created, warnings });
      setProgress(french ? `${outputs.length} projet(s) éditable(s) prêt(s).` : `${outputs.length} editable project(s) ready.`);
    } catch (reason) {
      await Promise.all(created.map((item) => deleteProject(item.id, project.id).catch(() => undefined)));
      setError(reason instanceof Error ? reason.message : (french ? 'L’automatisation a échoué.' : 'Automation failed.'));
      setProgress('');
    } finally {
      setBusy(false);
    }
  };

  return <div className="modal-backdrop" data-testid="production-assistant" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}><section className="production-modal"><header><div><span><Sparkles size={14}/>{french ? 'ASSISTANT DE PRODUCTION IA' : 'AI PRODUCTION ASSISTANT'}</span><h2>{french ? 'Automatiser la production' : 'Automate production'}</h2></div><button aria-label={french ? 'Fermer' : 'Close'} disabled={busy} onClick={onClose}><X size={17}/></button></header><div className="production-modes"><button className={mode === 'poster' ? 'active' : ''} onClick={() => setMode('poster')}>{french ? 'Créer une affiche' : 'Create a poster'}</button><button className={mode === 'adapt' ? 'active' : ''} onClick={() => setMode('adapt')}>{french ? 'Décliner les formats' : 'Adapt formats'}</button><button className={mode === 'prepare' ? 'active' : ''} onClick={() => setMode('prepare')}>{french ? 'Préparer les images' : 'Prepare images'}</button></div>{mode === 'poster' && (aiMode === 'provider' ? !aiConfigured : !localPosterReady) && <div className="production-message error production-ai-warning" role="alert"><AlertTriangle size={14}/><span>{aiMode === 'local' ? (french ? 'Démarrez Ollama et ComfyUI, installez les modèles locaux et vérifiez leur disponibilité dans les réglages IA.' : 'Start Ollama and ComfyUI, install the local models, and check their status in AI settings.') : (french ? 'Ajoutez une clé API de fournisseur IA pour créer une affiche.' : 'Add an AI provider API key to create a poster.')}</span><button onClick={onConfigureAI}>{french ? 'Réglages IA' : 'AI settings'}</button></div>}<div className="production-content">{mode !== 'prepare' && <><label className="production-label">{french ? 'Votre consigne' : 'Your brief'}{mode === 'poster' && <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={french ? 'Ex. Affiche de concert jazz, élégante, couleurs chaudes…' : 'E.g. elegant jazz concert poster in warm colors…'}/>}</label><div className="production-template-title">{mode === 'poster' ? (french ? 'Créer une copie dans les formats' : 'Create a copy in these formats') : (french ? 'Formats à créer à partir du projet courant' : 'Formats to create from the current project')}</div><div className="production-template-list">{availableTemplates.map((template) => <label key={template.id}><input type="checkbox" checked={selectedTemplates.includes(template.id)} onChange={() => toggleTemplate(template.id)}/><span>{template.name}</span><small>{template.widthMm} × {template.heightMm} mm</small></label>)}</div></>}{mode === 'prepare' && <><p>{french ? 'Les fonds sont supprimés localement. Les originaux et masques restent modifiables.' : 'Backgrounds are removed locally. Originals and editable masks are preserved.'}</p><label className="production-label">{french ? 'Modèle de détourage' : 'Background removal model'}<select value={model} onChange={(event) => setModel(event.target.value as typeof model)}><option value="universal">BiRefNet Lite · {french ? 'objets généraux' : 'general objects'}</option><option value="portrait">MODNet · {french ? 'portraits' : 'portraits'}</option></select></label><div className="production-template-title">{french ? 'Images du projet' : 'Project images'}</div><div className="production-template-list">{imageNodes.map((node) => <label key={node.id}><input type="checkbox" checked={selectedImages.includes(node.id)} onChange={() => toggleImage(node.id)}/><span>{node.name}</span></label>)}</div>{!imageNodes.length && <p>{french ? 'Ce projet ne contient aucune image.' : 'This project has no images.'}</p>}</>}{error && <div className="production-message error"><AlertTriangle size={14}/>{error}</div>}{progress && <div className="production-message" role="status">{busy ? <LoaderCircle className="production-spinner" size={14}/> : <Check size={14}/>}<span>{progress}</span></div>}<div className="production-privacy"><AlertTriangle size={13}/><span>{mode === 'prepare' ? (french ? 'Détourage et mise en page exécutés localement. Une étape en cours n’est pas annulable ; les modifications appliquées restent réversibles.' : 'Background removal and layout run locally. An in-progress run cannot be cancelled; applied changes remain reversible.') : mode === 'adapt' ? (french ? 'Les déclinaisons et contrôles de mise en page sont exécutés localement. Le projet source reste intact.' : 'Format adaptation and layout checks run locally. The source project stays unchanged.') : aiMode === 'local' ? (french ? 'Brief et illustration générés sur ce PC via Ollama et ComfyUI. Aucun prompt ou image n’est envoyé à un fournisseur distant.' : 'Brief and artwork are generated on this PC through Ollama and ComfyUI. No prompts or images are sent to a remote provider.') : (french ? 'Prompts et images envoyés au fournisseur IA configuré. L’original est conservé ; les nouveaux projets peuvent être annulés.' : 'Prompts and images are sent to the configured AI provider. The original is preserved; generated projects can be undone.')}</span></div></div><footer><button disabled={busy} onClick={onClose}>{french ? 'Fermer' : 'Close'}</button><button className="assistant-generate" data-testid="run-production-automation" disabled={busy || (mode === 'poster' && (!prompt.trim() || (aiMode === 'provider' ? !aiConfigured : !localPosterReady))) || (mode === 'prepare' && (!selectedImages.length || !imageNodes.length))} onClick={() => void run()}><Sparkles size={14}/>{busy ? (french ? 'En cours…' : 'Running…') : mode === 'prepare' ? (french ? 'Préparer' : 'Prepare images') : mode === 'adapt' ? (french ? 'Créer les déclinaisons' : 'Create variants') : (french ? 'Créer l’affiche' : 'Create poster')}</button></footer></section></div>;
}

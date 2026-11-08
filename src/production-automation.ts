import { createLayoutAlternatives } from './optimizer';
import { applyProductTemplate, type ProductTemplate } from './product-templates';
import type { DesignNode, DesignProject } from './types';

export type PosterBrief = {
  title: string;
  subtitle: string;
  body: string;
  callToAction: string;
  imagePrompt: string;
  backgroundColor: string;
  accentColor: string;
  textColor: string;
};

const hexColor = /^#[0-9a-f]{6}$/i;

function boundedText(value: unknown, field: string, maxLength: number, required = true) {
  if (typeof value !== 'string') throw new Error(`The AI poster plan is missing ${field}.`);
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > maxLength) throw new Error(`The AI poster plan has invalid ${field}.`);
  return normalized;
}

export function parsePosterBrief(response: string): PosterBrief {
  const jsonStart = response.indexOf('{');
  const jsonEnd = response.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd <= jsonStart) throw new Error('The AI provider did not return a valid structured poster plan.');
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(response.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
  } catch {
    throw new Error('The AI provider returned malformed poster plan data.');
  }
  const backgroundColor = boundedText(value.backgroundColor, 'background color', 7);
  const accentColor = boundedText(value.accentColor, 'accent color', 7);
  const textColor = boundedText(value.textColor, 'text color', 7);
  if (![backgroundColor, accentColor, textColor].every((color) => hexColor.test(color))) throw new Error('The AI poster plan contains an invalid color.');
  return {
    title: boundedText(value.title, 'title', 100),
    subtitle: boundedText(value.subtitle, 'subtitle', 140, false),
    body: boundedText(value.body, 'body copy', 300, false),
    callToAction: boundedText(value.callToAction, 'call to action', 100, false),
    imagePrompt: boundedText(value.imagePrompt, 'image prompt', 1200),
    backgroundColor,
    accentColor,
    textColor,
  };
}

export function createPosterDraft(source: DesignProject, brief: PosterBrief, createId: () => string, automationParentId = source.id): DesignProject {
  const width = source.width;
  const height = source.height;
  const groupId = `automation-${source.id}`;
  const node = (name: string, type: DesignNode['type'], x: number, y: number, nodeWidth: number, nodeHeight: number, fill: string, extra: Partial<DesignNode> = {}): DesignNode => ({
    id: createId(), name, type, x, y, width: nodeWidth, height: nodeHeight, rotation: 0, fill,
    visible: true, locked: false, opacity: 1, groupId, ...extra,
  });
  const nodes: DesignNode[] = [
    node('Accent', 'rect', width * 0.08, height * 0.065, width * 0.11, Math.max(4, height * 0.006), brief.accentColor),
    ...(brief.subtitle ? [node('Subtitle', 'text', width * 0.08, height * 0.085, width * 0.84, height * 0.035, brief.textColor, { text: brief.subtitle, fontSize: Math.max(12, height * 0.014), fontFamily: 'Arial' })] : []),
    node('Title', 'text', width * 0.08, height * 0.13, width * 0.84, height * 0.17, brief.textColor, { text: brief.title, fontSize: Math.max(30, height * 0.056), fontFamily: 'Georgia', fontStyle: 'bold' }),
    node('Generated artwork', 'image', width * 0.08, height * 0.33, width * 0.84, height * 0.42, 'transparent', { sourceName: 'AI generated artwork' }),
    ...(brief.body ? [node('Description', 'text', width * 0.08, height * 0.78, width * 0.84, height * 0.075, brief.textColor, { text: brief.body, fontSize: Math.max(13, height * 0.018), fontFamily: 'Arial' })] : []),
    ...(brief.callToAction ? [node('Call to action', 'text', width * 0.08, height * 0.91, width * 0.84, height * 0.04, brief.accentColor, { text: brief.callToAction, fontSize: Math.max(12, height * 0.016), fontFamily: 'Arial', fontStyle: 'bold' })] : []),
  ];
  return {
    ...source,
    automationParentId,
    name: brief.title.slice(0, 180),
    background: brief.backgroundColor,
    nodes,
    updatedAt: new Date().toISOString(),
  };
}

export function adaptProjectToTemplate(source: DesignProject, template: ProductTemplate, projectId: string, createId: () => string) {
  const candidate = applyProductTemplate({ ...source, id: projectId, name: `${source.name} · ${template.name}`.slice(0, 180), updatedAt: new Date().toISOString() }, template);
  const layoutGroup = `automation-layout-${createId()}`;
  const grouped = { ...candidate, nodes: candidate.nodes.map((node) => ({ ...node, groupId: layoutGroup })) };
  const layouts = createLayoutAlternatives(grouped).alternatives;
  const layout = layouts.find((alternative) => alternative.mode === 'balanced') ?? layouts[0];
  if (!layout?.metrics.valid) throw new Error(`A safe layout could not be created for ${template.name}.`);
  const originalGroups = new Map(candidate.nodes.map((node) => [node.id, node.groupId]));
  const nodes = layout.project.nodes.map((node) => {
    const groupId = originalGroups.get(node.id);
    if (groupId) return { ...node, groupId };
    const { groupId: _groupId, ...ungrouped } = node;
    return ungrouped;
  });
  return { ...layout.project, id: projectId, automationParentId: source.id, name: `${source.name} · ${template.name}`.slice(0, 180), nodes, updatedAt: new Date().toISOString() };
}

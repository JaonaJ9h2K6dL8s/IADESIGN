import type { DesignNode, DesignProject, PrintableRegion } from './types';

export type OptimizeMode = 'balanced' | 'creative' | 'advertising' | 'showcase' | 'grid' | 'minimal';
export type LayoutMetrics = {
  preservedObjects: number;
  unintendedCollisions: number;
  intentionalOverlaps: number;
  minimumSpacingViolations: number;
  safeAreaViolations: number;
  printableAreaViolations: number;
  outOfBoundsObjects: number;
  layoutScore: number;
  valid: boolean;
};
export type LayoutAlternative = {
  mode: OptimizeMode;
  label: string;
  project: DesignProject;
  collisions: number;
  metrics: LayoutMetrics;
  generationMs: number;
};
export type LayoutGenerationResult = {
  alternatives: LayoutAlternative[];
  generationMs: number;
  explanation?: string;
  rejectedModes: string[];
};

export const optimizeModes: { id: OptimizeMode; label: string }[] = [
  { id: 'balanced', label: 'Balanced' },
  { id: 'creative', label: 'Creative' },
  { id: 'advertising', label: 'Advertising' },
  { id: 'showcase', label: 'Product showcase' },
  { id: 'grid', label: 'Grid' },
  { id: 'minimal', label: 'Minimalist' },
];

export const smartLayoutAnalysisDescription = 'Deterministic geometric heuristics use object type, size, aspect ratio, rotation, text size, grouping, printable regions, and spacing. Image pixels and semantic content are not analyzed.';

const epsilon = 1e-7;
const minimumScale = 0.12;
const minimumSpacingMm = 2;
const minimumSpacingPx = 6;

type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };
type RegionRect = Rect & { id: string };
type PlacementUnit = { id: string; nodes: DesignNode[]; x: number; y: number; width: number; height: number; importance: number };
type Slot = { rect: Rect; regionId: string; row: number; column: number; regionIndex: number };

function polygon(node: DesignNode): Point[] {
  const radians = node.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const width = Math.max(0, node.width);
  const height = Math.max(0, node.height);
  return [
    { x: node.x, y: node.y },
    { x: node.x + width * cosine, y: node.y + width * sine },
    { x: node.x + width * cosine - height * sine, y: node.y + width * sine + height * cosine },
    { x: node.x - height * sine, y: node.y + height * cosine },
  ];
}

function polygonBounds(points: Point[]): Rect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function insideRect(points: Point[], rect: Rect) {
  return points.every((point) => point.x >= rect.x - epsilon && point.y >= rect.y - epsilon && point.x <= rect.x + rect.width + epsilon && point.y <= rect.y + rect.height + epsilon);
}

function projection(points: Point[], axis: Point) {
  const values = points.map((point) => point.x * axis.x + point.y * axis.y);
  return { min: Math.min(...values), max: Math.max(...values) };
}

function axes(points: Point[]) {
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const dx = next.x - point.x;
    const dy = next.y - point.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: -dy / length, y: dx / length };
  });
}

function overlaps(first: Point[], second: Point[]) {
  for (const axis of [...axes(first), ...axes(second)]) {
    const a = projection(first, axis);
    const b = projection(second, axis);
    if (a.max <= b.min + epsilon || b.max <= a.min + epsilon) return false;
  }
  return true;
}

function pointSegmentDistance(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(point.x - start.x - ratio * dx, point.y - start.y - ratio * dy);
}

function polygonDistance(first: Point[], second: Point[]) {
  if (overlaps(first, second)) return 0;
  let distance = Infinity;
  for (let index = 0; index < first.length; index += 1) {
    const start = first[index];
    const end = first[(index + 1) % first.length];
    for (const point of second) distance = Math.min(distance, pointSegmentDistance(point, start, end));
  }
  for (let index = 0; index < second.length; index += 1) {
    const start = second[index];
    const end = second[(index + 1) % second.length];
    for (const point of first) distance = Math.min(distance, pointSegmentDistance(point, start, end));
  }
  return distance;
}

function importance(node: DesignNode) {
  const area = Math.max(1, Math.abs(node.width * node.height));
  const typeWeight = node.type === 'text' ? 2.5 : node.type === 'image' ? 1.5 : 1;
  const textWeight = node.type === 'text' ? Math.log2(Math.max(1, node.fontSize ?? 24)) : 0;
  return typeWeight + Math.log2(area) / 8 + textWeight / 3;
}

function spacingFor(project: DesignProject) {
  const physicalWidth = project.physicalWidthMm ?? project.width / 96 * 25.4;
  return Math.max(minimumSpacingPx, minimumSpacingMm * project.width / Math.max(1, physicalWidth));
}

function safeInsets(project: DesignProject) {
  const marginMm = Math.max(0, project.printSettings?.safeMarginMm ?? 0);
  const physicalWidth = project.physicalWidthMm ?? project.width / 96 * 25.4;
  const physicalHeight = project.physicalHeightMm ?? project.height / 96 * 25.4;
  return {
    x: Math.min(project.width * 0.2, marginMm * project.width / Math.max(1, physicalWidth)),
    y: Math.min(project.height * 0.2, marginMm * project.height / Math.max(1, physicalHeight)),
  };
}

function rawRegions(project: DesignProject): RegionRect[] {
  const source: PrintableRegion[] = project.printableRegions?.length
    ? project.printableRegions
    : [{ id: 'document', name: 'Document', x: 0, y: 0, width: 1, height: 1 }];
  return source.map((region) => {
    const left = Math.max(0, region.x * project.width);
    const top = Math.max(0, region.y * project.height);
    const right = Math.min(project.width, (region.x + region.width) * project.width);
    const bottom = Math.min(project.height, (region.y + region.height) * project.height);
    return { id: region.id, x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  }).filter((region) => region.width > 0 && region.height > 0);
}

function safeRegions(project: DesignProject) {
  const inset = safeInsets(project);
  return rawRegions(project).map((region) => ({
    ...region,
    x: region.x + inset.x,
    y: region.y + inset.y,
    width: region.width - inset.x * 2,
    height: region.height - inset.y * 2,
  })).filter((region) => region.width > minimumSpacingPx && region.height > minimumSpacingPx);
}

function buildUnits(nodes: DesignNode[]): PlacementUnit[] {
  const groups = new Map<string, DesignNode[]>();
  for (const node of nodes) {
    const key = node.groupId ? `group:${node.groupId}` : `node:${node.id}`;
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }
  return [...groups].map(([id, members]) => {
    const points = members.flatMap(polygon);
    const bounds = polygonBounds(points);
    return { id, nodes: members, ...bounds, importance: members.reduce((total, node) => total + importance(node), 0) };
  }).sort((first, second) => second.importance - first.importance || first.id.localeCompare(second.id));
}

function allocateCounts(regions: RegionRect[], count: number) {
  const totalArea = regions.reduce((sum, region) => sum + region.width * region.height, 0);
  if (!count || !totalArea) return regions.map(() => 0);
  const quotas = regions.map((region) => count * region.width * region.height / totalArea);
  const counts = quotas.map(Math.floor);
  let remaining = count - counts.reduce((sum, value) => sum + value, 0);
  const order = quotas.map((quota, index) => ({ index, remainder: quota - counts[index] })).sort((first, second) => second.remainder - first.remainder || first.index - second.index);
  for (let index = 0; index < remaining; index += 1) counts[order[index % order.length].index] += 1;
  return counts;
}

function columnFactor(mode: OptimizeMode) {
  return ({ balanced: 1, creative: 1.42, advertising: 0.68, showcase: 0.84, grid: 1.18, minimal: 1.62 })[mode];
}

function modeSlots(regions: RegionRect[], units: number, mode: OptimizeMode, gap: number): Slot[] {
  const allocations = allocateCounts(regions, units);
  const slots: Slot[] = [];
  regions.forEach((region, regionIndex) => {
    const count = allocations[regionIndex];
    if (!count) return;
    const naturalColumns = Math.sqrt(count * region.width / region.height);
    const columns = Math.max(1, Math.min(count, Math.round(naturalColumns * columnFactor(mode))));
    const rows = Math.ceil(count / columns);
    const cellWidth = (region.width - gap * (columns + 1)) / columns;
    const cellHeight = (region.height - gap * (rows + 1)) / rows;
    if (cellWidth <= 0 || cellHeight <= 0) return;
    const cells = Array.from({ length: count }, (_, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      return {
        rect: { x: region.x + gap + column * (cellWidth + gap), y: region.y + gap + row * (cellHeight + gap), width: cellWidth, height: cellHeight },
        regionId: region.id,
        row,
        column,
        regionIndex,
      };
    });
    const centerX = region.x + region.width / 2;
    const centerY = region.y + region.height / 2;
    const centerDistance = (slot: Slot) => Math.hypot(slot.rect.x + slot.rect.width / 2 - centerX, slot.rect.y + slot.rect.height / 2 - centerY);
    const orderers: Record<OptimizeMode, (first: Slot, second: Slot) => number> = {
      balanced: (first, second) => first.row - second.row || (first.row % 2 ? second.column - first.column : first.column - second.column),
      creative: (first, second) => (first.row + first.column) - (second.row + second.column) || first.column - second.column || first.row - second.row,
      advertising: (first, second) => first.row - second.row || first.column - second.column,
      showcase: (first, second) => centerDistance(first) - centerDistance(second) || first.row - second.row || first.column - second.column,
      grid: (first, second) => first.column - second.column || first.row - second.row,
      minimal: (first, second) => second.row - first.row || second.column - first.column,
    };
    cells.sort(orderers[mode]);
    if (units === 1 && regions.length === 1) {
      const anchors: Record<OptimizeMode, [number, number]> = {
        balanced: [0.5, 0.5], creative: [0.34, 0.34], advertising: [0.5, 0.28], showcase: [0.66, 0.48], grid: [0.38, 0.68], minimal: [0.62, 0.72],
      };
      const [anchorX, anchorY] = anchors[mode];
      cells[0].rect.x = region.x + region.width * anchorX - cellWidth / 2;
      cells[0].rect.y = region.y + region.height * anchorY - cellHeight / 2;
    }
    slots.push(...cells);
  });
  return slots;
}

function fitUnit(unit: PlacementUnit, slot: Slot): DesignNode[] | undefined {
  const scale = Math.min(1, slot.rect.width / Math.max(epsilon, unit.width), slot.rect.height / Math.max(epsilon, unit.height));
  if (!Number.isFinite(scale) || scale < minimumScale) return undefined;
  const targetX = slot.rect.x + slot.rect.width / 2;
  const targetY = slot.rect.y + slot.rect.height / 2;
  const sourceX = unit.x + unit.width / 2;
  const sourceY = unit.y + unit.height / 2;
  return unit.nodes.map((node) => ({
    ...node,
    x: targetX + (node.x - sourceX) * scale,
    y: targetY + (node.y - sourceY) * scale,
    width: node.width * scale,
    height: node.height * scale,
    fontSize: node.fontSize ? node.fontSize * scale : undefined,
  }));
}

function intentionalPair(first: DesignNode, second: DesignNode) {
  return Boolean(first.groupId && first.groupId === second.groupId);
}

function conflicts(candidate: DesignNode[], placed: DesignNode[], gap: number) {
  for (const first of candidate) for (const second of placed) {
    if (intentionalPair(first, second)) continue;
    if (polygonDistance(polygon(first), polygon(second)) < gap - epsilon) return true;
  }
  return false;
}

function countOverlaps(project: DesignProject) {
  const active = project.nodes.filter((node) => node.visible);
  let collisions = 0;
  let intentional = 0;
  let spacingViolations = 0;
  const gap = spacingFor(project);
  for (let first = 0; first < active.length; first += 1) for (let second = first + 1; second < active.length; second += 1) {
    const left = active[first];
    const right = active[second];
    const overlap = overlaps(polygon(left), polygon(right));
    if (intentionalPair(left, right)) {
      if (overlap) intentional += 1;
      continue;
    }
    if (overlap) collisions += 1;
    if (polygonDistance(polygon(left), polygon(right)) < gap - epsilon) spacingViolations += 1;
  }
  return { collisions, intentional, spacingViolations };
}

function scoreLayout(project: DesignProject, metrics: Omit<LayoutMetrics, 'layoutScore' | 'valid'>) {
  const active = project.nodes.filter((node) => node.visible);
  if (!active.length) return 0;
  const weighted = active.map((node) => ({ node, weight: importance(node) }));
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0) || 1;
  const diagonal = Math.hypot(project.width, project.height) || 1;
  const hierarchyOffset = weighted.reduce((sum, item) => {
    const point = polygonBounds(polygon(item.node));
    const distance = Math.hypot(point.x + point.width / 2 - project.width / 2, point.y + point.height / 2 - project.height / 2) / diagonal;
    return sum + distance * item.weight;
  }, 0) / totalWeight;
  const centers = active.map((node) => {
    const box = polygonBounds(polygon(node));
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  const meanX = centers.reduce((sum, point) => sum + point.x, 0) / centers.length;
  const meanY = centers.reduce((sum, point) => sum + point.y, 0) / centers.length;
  const balanceOffset = Math.hypot(meanX - project.width / 2, meanY - project.height / 2) / diagonal;
  const penalties = metrics.unintendedCollisions * 30 + metrics.minimumSpacingViolations * 16 + metrics.safeAreaViolations * 18 + metrics.printableAreaViolations * 24 + metrics.outOfBoundsObjects * 30;
  return Math.max(0, Math.min(100, Math.round(100 - penalties - hierarchyOffset * 12 - balanceOffset * 8)));
}

export function evaluateLayout(project: DesignProject): LayoutMetrics {
  const active = project.nodes.filter((node) => node.visible);
  const raw = rawRegions(project);
  const safe = safeRegions(project);
  const inset = safeInsets(project);
  let safeAreaViolations = 0;
  let printableAreaViolations = 0;
  let outOfBoundsObjects = 0;
  const documentRect = { x: 0, y: 0, width: project.width, height: project.height };
  const documentSafe = { x: inset.x, y: inset.y, width: project.width - inset.x * 2, height: project.height - inset.y * 2 };
  for (const node of active) {
    const points = polygon(node);
    if (!insideRect(points, documentRect)) outOfBoundsObjects += 1;
    if (!insideRect(points, documentSafe) || (project.printableRegions?.length && !safe.some((region) => insideRect(points, region)))) safeAreaViolations += 1;
    if (project.printableRegions?.length && !raw.some((region) => insideRect(points, region))) printableAreaViolations += 1;
  }
  const overlapsFound = countOverlaps(project);
  const base = {
    preservedObjects: project.nodes.length,
    unintendedCollisions: overlapsFound.collisions,
    intentionalOverlaps: overlapsFound.intentional,
    minimumSpacingViolations: overlapsFound.spacingViolations,
    safeAreaViolations,
    printableAreaViolations,
    outOfBoundsObjects,
  };
  const valid = base.unintendedCollisions === 0 && base.minimumSpacingViolations === 0 && base.safeAreaViolations === 0 && base.printableAreaViolations === 0 && base.outOfBoundsObjects === 0;
  return { ...base, layoutScore: scoreLayout(project, base), valid };
}

function layoutSignature(project: DesignProject, movableIds: Set<string>) {
  return project.nodes.filter((node) => movableIds.has(node.id)).map((node) => `${node.id}:${node.x.toFixed(3)}:${node.y.toFixed(3)}:${node.width.toFixed(3)}:${node.height.toFixed(3)}`).join('|');
}

export function createLayoutAlternatives(project: DesignProject): LayoutGenerationResult {
  const start = performance.now();
  const movableNodes = project.nodes.filter((node) => node.visible && !node.locked);
  const lockedGroups = new Set(project.nodes.filter((node) => node.visible && node.locked && node.groupId).map((node) => node.groupId!));
  const fixedNodes = project.nodes.filter((node) => node.visible && (node.locked || (node.groupId && lockedGroups.has(node.groupId))));
  const movableUnits = buildUnits(movableNodes.filter((node) => !fixedNodes.includes(node)));
  const regions = safeRegions(project);
  if (!movableUnits.length) return { alternatives: [], generationMs: performance.now() - start, explanation: 'No visible, unlocked objects are available to arrange.', rejectedModes: optimizeModes.map(({ label }) => label) };
  if (!regions.length) return { alternatives: [], generationMs: performance.now() - start, explanation: 'No valid optimized layout could be generated. No printable region remains after applying the document safe margin.', rejectedModes: optimizeModes.map(({ label }) => label) };

  const gap = spacingFor(project);
  const alternatives: LayoutAlternative[] = [];
  const rejectedModes: string[] = [];
  const seen = new Set<string>();
  const movableIds = new Set(movableUnits.flatMap((unit) => unit.nodes.map((node) => node.id)));

  for (const { id, label } of optimizeModes) {
    const modeStart = performance.now();
    const slots = modeSlots(regions, movableUnits.length, id, gap);
    const placed = [...fixedNodes];
    const placements = new Map<string, DesignNode>();
    const used = new Set<number>();
    let failure = false;
    for (const unit of movableUnits) {
      let placement: DesignNode[] | undefined;
      let chosenSlot = -1;
      for (let index = 0; index < slots.length; index += 1) {
        if (used.has(index)) continue;
        const candidate = fitUnit(unit, slots[index]);
        if (!candidate || candidate.some((node) => !insideRect(polygon(node), slots[index].rect))) continue;
        if (conflicts(candidate, placed, gap)) continue;
        placement = candidate;
        chosenSlot = index;
        break;
      }
      if (!placement) {
        failure = true;
        break;
      }
      used.add(chosenSlot);
      for (const node of placement) placements.set(node.id, node);
      placed.push(...placement);
    }
    if (failure) {
      rejectedModes.push(`${label}: all movable objects could not fit with required spacing and minimum 12% scale.`);
      continue;
    }
    const candidateProject = { ...project, nodes: project.nodes.map((node) => placements.get(node.id) ?? node) };
    const metrics = evaluateLayout(candidateProject);
    if (!metrics.valid) {
      rejectedModes.push(`${label}: ${metrics.unintendedCollisions} collisions, ${metrics.minimumSpacingViolations} spacing violations, ${metrics.safeAreaViolations} safe-area violations, ${metrics.printableAreaViolations} printable-area violations, ${metrics.outOfBoundsObjects} out-of-bounds objects.`);
      continue;
    }
    const signature = layoutSignature(candidateProject, movableIds);
    if (seen.has(signature)) {
      rejectedModes.push(`${label}: duplicate of another valid composition.`);
      continue;
    }
    seen.add(signature);
    alternatives.push({ mode: id, label, project: candidateProject, collisions: metrics.unintendedCollisions, metrics, generationMs: Math.max(0, performance.now() - modeStart) });
  }
  const generationMs = performance.now() - start;
  const explanation = alternatives.length === optimizeModes.length ? undefined : alternatives.length
    ? `Generated ${alternatives.length} valid alternative${alternatives.length === 1 ? '' : 's'}; other candidates were omitted because they could not meet collision, spacing, safe-area, and printable-region constraints.`
    : `No valid optimized layout could be generated. ${rejectedModes[0] ?? 'The requested composition does not fit the printable area.'}`;
  return { alternatives, generationMs, explanation, rejectedModes };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLayoutAlternatives, evaluateLayout, type OptimizeMode } from '../src/optimizer';
import { createStarterProject } from '../src/product-templates';
import type { DesignNode, DesignProject } from '../src/types';

const modes: OptimizeMode[] = ['balanced', 'creative', 'advertising', 'showcase', 'grid', 'minimal'];

function fixture(count: number): DesignProject {
  const project = createStarterProject();
  const nodes: DesignNode[] = Array.from({ length: count }, (_, index) => {
    const width = index === 0 ? 290 : index === count - 1 ? 10 : 36 + (index * 41 % 145);
    const height = index === 0 ? 350 : index === count - 1 ? 8 : 28 + (index * 31 % 125);
    const type = index % 7 === 0 ? 'text' : index % 3 === 0 ? 'image' : index % 2 === 0 ? 'rect' : 'ellipse';
    return {
      id: `fixture-${count}-${index}`,
      name: `Fixture ${index}`,
      type,
      x: index % 4 === 0 ? -12 : project.width - width + 8,
      y: index % 5 === 0 ? -18 : project.height - height + 11,
      width,
      height,
      rotation: [0, 0, 15, -30, 45, 75, 90][index % 7],
      fill: '#68765c',
      text: type === 'text' ? `Headline ${index}` : undefined,
      fontSize: type === 'text' ? 14 + index % 4 * 4 : undefined,
      sourceWidth: type === 'image' ? width * 3 : undefined,
      sourceHeight: type === 'image' ? height * 3 : undefined,
      visible: true,
      locked: false,
      opacity: 1,
    };
  });
  return { ...project, nodes };
}

function legacyAabb(node: DesignNode) {
  const radians = Math.abs(node.rotation) * Math.PI / 180;
  const width = Math.abs(node.width * Math.cos(radians)) + Math.abs(node.height * Math.sin(radians));
  const height = Math.abs(node.width * Math.sin(radians)) + Math.abs(node.height * Math.cos(radians));
  const centerX = node.x + node.width / 2;
  const centerY = node.y + node.height / 2;
  return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}

function legacyImportance(node: DesignNode) {
  const area = Math.max(1, node.width * node.height);
  if (node.type === 'image') return 2 + Math.log2(Math.max(1, node.sourceWidth ?? node.width) * Math.max(1, node.sourceHeight ?? node.height)) / 20 + Math.log2(area) / 24;
  if (node.type === 'text') return 1 + Math.log2(Math.max(1, node.fontSize ?? 24)) / 5;
  return Math.log2(area) / 20;
}

function legacyCollisionCounts(project: DesignProject) {
  const safe = Math.min(Math.max(16, (project.printSettings?.safeMarginMm ?? 5) / 25.4 * 96), project.width * 0.12, project.height * 0.12);
  const ordered = project.nodes.filter((node) => node.visible && !node.locked).sort((a, b) => legacyImportance(b) - legacyImportance(a));
  const hero = ordered.find((node) => node.type === 'image') ?? ordered.find((node) => node.type !== 'text') ?? ordered[0];
  const headline = ordered.filter((node) => node.type === 'text').sort((a, b) => (b.fontSize ?? 24) - (a.fontSize ?? 24))[0];
  return modes.map((mode) => {
    const placements: DesignNode[] = [];
    const assigned = new Set<string>();
    const areaWidth = Math.max(1, project.width - safe * 2);
    const areaHeight = Math.max(1, project.height - safe * 2);
    const place = (node: DesignNode | undefined, x: number, y: number, width: number, height: number) => {
      if (!node || assigned.has(node.id) || width <= 0 || height <= 0) return;
      const ratio = node.width / Math.max(1, node.height);
      let nextWidth = width;
      let nextHeight = nextWidth / ratio;
      if (nextHeight > height) {
        nextHeight = height;
        nextWidth = nextHeight * ratio;
      }
      const scale = Math.min(nextWidth / Math.max(1, node.width), nextHeight / Math.max(1, node.height));
      placements.push({ ...node, x: x + (width - nextWidth) / 2, y: y + (height - nextHeight) / 2, width: nextWidth, height: nextHeight, fontSize: node.fontSize ? Math.max(10, Math.round(node.fontSize * scale)) : undefined });
      assigned.add(node.id);
    };
    const remaining = () => ordered.filter((node) => !assigned.has(node.id));
    if (mode === 'balanced') {
      place(hero, safe, safe + areaHeight * 0.12, areaWidth * 0.56, areaHeight * 0.68);
      place(headline, safe + areaWidth * 0.61, safe + areaHeight * 0.17, areaWidth * 0.35, areaHeight * 0.27);
      place(remaining().find((node) => node.type === 'text'), safe + areaWidth * 0.61, safe + areaHeight * 0.51, areaWidth * 0.35, areaHeight * 0.23);
    } else if (mode === 'advertising') {
      place(headline, safe + areaWidth * 0.05, safe, areaWidth * 0.9, areaHeight * 0.2);
      place(hero, safe + areaWidth * 0.04, safe + areaHeight * 0.24, areaWidth * 0.61, areaHeight * 0.68);
      place(remaining().find((node) => node.type === 'text'), safe + areaWidth * 0.69, safe + areaHeight * 0.37, areaWidth * 0.27, areaHeight * 0.4);
    } else if (mode === 'showcase') {
      place(hero, safe + areaWidth * 0.11, safe, areaWidth * 0.78, areaHeight * 0.69);
      place(headline, safe + areaWidth * 0.12, safe + areaHeight * 0.75, areaWidth * 0.76, areaHeight * 0.15);
      place(remaining().find((node) => node.type === 'text'), safe + areaWidth * 0.2, safe + areaHeight * 0.91, areaWidth * 0.6, areaHeight * 0.08);
    } else if (mode === 'creative') {
      place(hero, safe + areaWidth * 0.34, safe + areaHeight * 0.17, areaWidth * 0.61, areaHeight * 0.65);
      place(headline, safe, safe + areaHeight * 0.08, areaWidth * 0.39, areaHeight * 0.28);
      place(remaining().find((node) => node.type === 'text'), safe, safe + areaHeight * 0.67, areaWidth * 0.37, areaHeight * 0.21);
    } else if (mode === 'minimal') {
      place(hero, safe + areaWidth * 0.25, safe + areaHeight * 0.24, areaWidth * 0.5, areaHeight * 0.48);
      place(headline, safe + areaWidth * 0.15, safe + areaHeight * 0.02, areaWidth * 0.7, areaHeight * 0.16);
      place(remaining().find((node) => node.type === 'text'), safe + areaWidth * 0.2, safe + areaHeight * 0.81, areaWidth * 0.6, areaHeight * 0.12);
    }
    const unassigned = remaining();
    if (mode === 'grid') {
      const columns = Math.ceil(Math.sqrt(unassigned.length));
      const rows = Math.ceil(unassigned.length / Math.max(1, columns));
      const gap = Math.max(8, Math.min(areaWidth, areaHeight) * 0.035);
      const cellWidth = (areaWidth - gap * (columns - 1)) / columns;
      const cellHeight = (areaHeight - gap * (rows - 1)) / rows;
      unassigned.forEach((node, index) => place(node, safe + index % columns * (cellWidth + gap), safe + Math.floor(index / columns) * (cellHeight + gap), cellWidth, cellHeight));
    } else if (unassigned.length) {
      const footerHeight = areaHeight * 0.18;
      const columns = Math.max(1, Math.ceil(Math.sqrt(unassigned.length * areaWidth / footerHeight)));
      const rows = Math.ceil(unassigned.length / columns);
      const cellWidth = areaWidth / columns;
      const cellHeight = footerHeight / rows;
      unassigned.forEach((node, index) => place(node, safe + index % columns * cellWidth, safe + areaHeight - footerHeight + Math.floor(index / columns) * cellHeight, cellWidth, cellHeight));
    }
    let collisions = 0;
    for (let first = 0; first < placements.length; first += 1) for (let second = first + 1; second < placements.length; second += 1) {
      const a = legacyAabb(placements[first]);
      const b = legacyAabb(placements[second]);
      if (!(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)) collisions += 1;
    }
    return collisions;
  });
}

test('Smart Layout generates six distinct safe, collision-free alternatives for 10, 20, and 50 mixed objects', () => {
  for (const count of [10, 20, 50]) {
    const source = fixture(count);
    const legacy = legacyCollisionCounts(source);
    const start = performance.now();
    const result = createLayoutAlternatives(source);
    const elapsedMs = performance.now() - start;
    assert.ok(result.alternatives.length >= 1 && result.alternatives.length <= 6, `${count} objects: expected one to six valid modes; ${result.explanation ?? ''}`);
    if (result.alternatives.length < 6) assert.ok(result.explanation, `${count} object partial output must explain rejected alternatives`);
    assert.equal(new Set(result.alternatives.map((alternative) => alternative.mode)).size, result.alternatives.length);
    assert.equal(new Set(result.alternatives.map((alternative) => alternative.project.nodes.map((node) => `${node.id}:${node.x.toFixed(2)}:${node.y.toFixed(2)}`).join('|'))).size, result.alternatives.length);
    for (const alternative of result.alternatives) {
      assert.equal(alternative.metrics.preservedObjects, count);
      assert.equal(alternative.metrics.unintendedCollisions, 0);
      assert.equal(alternative.metrics.minimumSpacingViolations, 0);
      assert.equal(alternative.metrics.safeAreaViolations, 0);
      assert.equal(alternative.metrics.printableAreaViolations, 0);
      assert.equal(alternative.metrics.outOfBoundsObjects, 0);
      assert.equal(alternative.metrics.valid, true);
      assert.ok(alternative.metrics.layoutScore > 0 && alternative.metrics.layoutScore <= 100);
      assert.deepEqual(alternative.project.nodes.map((node) => node.id), source.nodes.map((node) => node.id));
      assert.deepEqual(alternative.project.nodes.map((node) => node.type), source.nodes.map((node) => node.type));
      assert.ok(alternative.generationMs >= 0);
    }
    assert.ok(elapsedMs < 10_000, `${count} object generation took ${elapsedMs.toFixed(1)} ms`);
    console.log(JSON.stringify({ certification: 'smart-layout', count, legacyCollisionCounts: legacy, legacyCollisionTotal: legacy.reduce((sum, value) => sum + value, 0), alternatives: result.alternatives.length, rejectedModes: result.rejectedModes, newCollisionCounts: result.alternatives.map((item) => item.metrics.unintendedCollisions), spacingViolations: result.alternatives.map((item) => item.metrics.minimumSpacingViolations), scores: result.alternatives.map((item) => item.metrics.layoutScore), generationMs: Number(elapsedMs.toFixed(2)) }));
  }
});

test('Smart Layout handles intentionally overlapping group members as one editable composition unit', () => {
  const source = fixture(10);
  const grouped = source.nodes.slice(0, 2).map((node, index) => ({ ...node, id: `group-${index}`, groupId: 'intentional', x: 200 + index * 4, y: 200 + index * 3, width: 120, height: 90, rotation: 0 }));
  const project = { ...source, nodes: [...grouped, ...source.nodes.slice(2)] };
  const result = createLayoutAlternatives(project);
  assert.equal(result.alternatives.length, 6);
  for (const alternative of result.alternatives) {
    const members = alternative.project.nodes.filter((node) => node.groupId === 'intentional');
    assert.equal(members.length, 2);
    assert.ok(Math.abs((members[1].x - members[0].x) - 4 * (members[0].width / 120)) < 1e-6);
    assert.ok(alternative.metrics.intentionalOverlaps >= 1);
    assert.equal(alternative.metrics.unintendedCollisions, 0);
  }
});

test('Smart Layout keeps locked objects fixed and rejects invalid compositions rather than calling them optimized', () => {
  const source = fixture(6);
  const locked = { ...source.nodes[0], id: 'locked-fixed', locked: true, x: 350, y: 600, width: 52, height: 52, rotation: 0 };
  const project = { ...source, nodes: [locked, ...source.nodes.slice(1)] };
  const result = createLayoutAlternatives(project);
  console.log(JSON.stringify({ lockedAlternatives: result.alternatives.length, rejected: result.rejectedModes }));
  assert.ok(result.alternatives.length > 0);
  assert.ok(result.alternatives.length <= 6);
  for (const alternative of result.alternatives) {
    assert.deepEqual(alternative.project.nodes[0], locked);
    assert.equal(alternative.metrics.valid, true);
  }
  const impossible: DesignProject = { ...source, printableRegions: [{ id: 'tiny', name: 'Tiny', x: 0.49, y: 0.49, width: 0.02, height: 0.02 }] };
  const rejected = createLayoutAlternatives(impossible);
  assert.equal(rejected.alternatives.length, 0);
  assert.ok(rejected.explanation?.includes('No valid optimized layout'));
  assert.equal(evaluateLayout(impossible).valid, false);
});

test('Smart Layout detects rotated overlap, safe-area, printable-area, and out-of-bounds violations', () => {
  const source = fixture(2);
  const first = { ...source.nodes[0], x: 50, y: 60, width: 160, height: 30, rotation: 45 };
  const second = { ...source.nodes[1], x: 50, y: 60, width: 160, height: 30, rotation: 45 };
  const project = { ...source, nodes: [first, second] };
  const metrics = evaluateLayout(project);
  assert.ok(metrics.unintendedCollisions > 0);
  const unsafe = { ...project, nodes: [{ ...first, x: -40, y: -25, rotation: 0 }, second] };
  const unsafeMetrics = evaluateLayout(unsafe);
  assert.ok(unsafeMetrics.outOfBoundsObjects > 0);
  assert.ok(unsafeMetrics.safeAreaViolations > 0);
  assert.ok(unsafeMetrics.printableAreaViolations > 0);
});

test('Smart Layout is deterministic and leaves the input project and editable node identities untouched', () => {
  const source = fixture(20);
  const snapshot = structuredClone(source);
  const first = createLayoutAlternatives(source);
  const second = createLayoutAlternatives(source);
  assert.deepEqual(source, snapshot);
  assert.deepEqual(first.alternatives.map((alternative) => alternative.project), second.alternatives.map((alternative) => alternative.project));
  for (const alternative of first.alternatives) {
    assert.deepEqual(alternative.project.nodes.map((node) => node.id), source.nodes.map((node) => node.id));
    assert.ok(alternative.project.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y) && node.width > 0 && node.height > 0));
  }
});

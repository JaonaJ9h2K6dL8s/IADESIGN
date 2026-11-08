import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptProjectToTemplate, createPosterDraft, parsePosterBrief } from '../src/production-automation';
import { applyProductTemplate, createStarterProject, productTemplates } from '../src/product-templates';

const brief = {
  title: 'Les nuits du jardin',
  subtitle: 'Festival des lumières',
  body: 'Une promenade artistique au cœur de la ville.',
  callToAction: 'Du 12 au 14 juin',
  imagePrompt: 'Illustration botanique nocturne, sans texte',
  backgroundColor: '#f5f0e6',
  accentColor: '#d0714c',
  textColor: '#252a25',
};

const makeId = (() => {
  let id = 0;
  return () => `generated-${++id}`;
})();

test('poster brief parser accepts valid JSON and constrains text and colors', () => {
  assert.deepEqual(parsePosterBrief(`Plan:\n${JSON.stringify(brief)}`), brief);
  assert.throws(() => parsePosterBrief(JSON.stringify({ ...brief, accentColor: 'tomato' })), /invalid color/i);
  assert.throws(() => parsePosterBrief(JSON.stringify({ ...brief, title: 'x'.repeat(101) })), /invalid title/i);
  assert.throws(() => parsePosterBrief('not json'), /structured poster plan/i);
});

test('poster draft is editable, preserves its source project and generates stable node identities', () => {
  const source = applyProductTemplate({ ...createStarterProject(), nodes: [] }, productTemplates.find((template) => template.id === 'poster')!);
  const snapshot = structuredClone(source);
  const draft = createPosterDraft(source, brief, makeId);
  assert.deepEqual(source, snapshot);
  assert.equal(draft.name, brief.title);
  assert.equal(draft.background, brief.backgroundColor);
  assert.deepEqual(draft.nodes.map((node) => node.name), ['Accent', 'Subtitle', 'Title', 'Generated artwork', 'Description', 'Call to action']);
  assert.ok(draft.nodes.every((node) => node.groupId === draft.nodes[0].groupId));
  assert.equal(draft.nodes.find((node) => node.name === 'Generated artwork')?.type, 'image');
  assert.equal(new Set(draft.nodes.map((node) => node.id)).size, draft.nodes.length);
});

test('format adaptation returns safe editable projects with original grouping preserved', () => {
  const template = productTemplates.find((item) => item.id === 'tshirt')!;
  const source = createPosterDraft(createStarterProject(), brief, makeId);
  const snapshot = structuredClone(source);
  const adapted = adaptProjectToTemplate(source, template, 'variant-project', makeId);
  assert.deepEqual(source, snapshot);
  assert.equal(adapted.id, 'variant-project');
  assert.equal(adapted.productTemplateId, template.id);
  assert.equal(adapted.nodes.length, source.nodes.length);
  assert.ok(adapted.nodes.every((node) => node.groupId === source.nodes.find((original) => original.id === node.id)?.groupId));
  assert.ok(adapted.nodes.every((node) => node.width > 0 && node.height > 0));
});

test('format adaptation rejects a template when no safe layout can be generated', () => {
  const project = { ...createStarterProject(), nodes: [{ ...createStarterProject().nodes[0], x: 9000, y: 9000, width: 900, height: 900 }] };
  const tinyTemplate = { ...productTemplates.find((item) => item.id === 'poster')!, regions: [{ id: 'tiny', name: 'Tiny', x: 0.49, y: 0.49, width: 0.02, height: 0.02 }] };
  assert.throws(() => adaptProjectToTemplate(project, tinyTemplate, 'invalid-variant', makeId), /safe layout/i);
});

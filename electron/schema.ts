import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  content: text('content').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const designDocuments = sqliteTable('design_documents', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  productType: text('product_type').notNull(),
  unit: text('unit').notNull(),
  physicalWidthMm: real('physical_width_mm').notNull(),
  physicalHeightMm: real('physical_height_mm').notNull(),
  artworkWidth: integer('artwork_width').notNull(),
  artworkHeight: integer('artwork_height').notNull(),
  printableRegions: text('printable_regions').notNull(),
  printSettings: text('print_settings').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const layers = sqliteTable('layers', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  orderIndex: integer('order_index').notNull(),
  visible: integer('visible').notNull(),
  locked: integer('locked').notNull(),
});

export const designObjects = sqliteTable('design_objects', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  layerId: text('layer_id').notNull().references(() => layers.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  orderIndex: integer('order_index').notNull(),
  content: text('content').notNull(),
});

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  localPath: text('local_path').notNull(),
  mimeType: text('mime_type').notNull(),
  sourceName: text('source_name'),
  sourceUrl: text('source_url'),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  createdAt: text('created_at').notNull(),
});

export const productTemplates = sqliteTable('product_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  productType: text('product_type').notNull(),
  definition: text('definition').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const printableRegions = sqliteTable('printable_regions', {
  id: text('id').primaryKey(),
  templateId: text('template_id').notNull().references(() => productTemplates.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  x: real('x').notNull(),
  y: real('y').notNull(),
  width: real('width').notNull(),
  height: real('height').notNull(),
});

export const printProfiles = sqliteTable('print_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  resolutionDpi: integer('resolution_dpi').notNull(),
  bleedMm: real('bleed_mm').notNull(),
  colorProfile: text('color_profile').notNull(),
  settings: text('settings').notNull(),
});

export const exportJobs = sqliteTable('export_jobs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  format: text('format').notNull(),
  status: text('status').notNull(),
  outputPath: text('output_path'),
  createdAt: text('created_at').notNull(),
});

export const aiJobs = sqliteTable('ai_jobs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  request: text('request').notNull(),
  result: text('result'),
  createdAt: text('created_at').notNull(),
});

export const userSettings = sqliteTable('user_settings', {
  id: text('id').primaryKey(),
  content: text('content').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const assetAttributions = sqliteTable('asset_attributions', {
  id: text('id').primaryKey(),
  assetId: text('asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
  sourceName: text('source_name'),
  sourceUrl: text('source_url'),
  attributionText: text('attribution_text'),
  createdAt: text('created_at').notNull(),
});

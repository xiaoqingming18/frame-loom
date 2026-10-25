import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { CanvasDocument, CanvasView } from '@frame-loom/contracts';

export const canvasDocuments = sqliteTable('canvas_documents', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  revision: integer('revision').notNull(),
  document: text('document_json', { mode: 'json' }).$type<CanvasDocument>().notNull(),
  view: text('view_json', { mode: 'json' }).$type<CanvasView>(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

import { primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { CanvasView } from '@frame-loom/contracts';

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    rootPath: text('root_path').notNull(),
    locationKind: text('location_kind').$type<'local'>().notNull().default('local'),
    remoteId: text('remote_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    addedAt: text('added_at').notNull(),
    lastOpenedAt: text('last_opened_at').notNull(),
  },
  (table) => [uniqueIndex('projects_root_path').on(table.rootPath)],
);

export const pageViews = sqliteTable(
  'page_views',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    pageId: text('page_id').notNull(),
    view: text('view_json', { mode: 'json' }).$type<CanvasView>().notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.pageId] })],
);

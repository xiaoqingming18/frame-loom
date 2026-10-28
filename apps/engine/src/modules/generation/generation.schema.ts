import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type {
  SemanticRequest,
  GenerationStatus,
  GenerationErrorCategory,
  MediaFile,
} from '@frame-loom/contracts';
import type { JobSnapshot, OutputRef } from './protocols/types.js';

export const generationJobs = sqliteTable(
  'generation_jobs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id'),
    pageId: text('page_id'),
    kind: text('kind').$type<'image' | 'video' | 'tts'>().notNull(),
    // 不设级联删除：删除渠道后仍保留任务与产物，恢复时明确报配置不存在。
    modelId: text('model_id').notNull(),
    status: text('status').$type<GenerationStatus>().notNull(),
    request: text('request_json', { mode: 'json' }).$type<SemanticRequest>().notNull(),
    snapshot: text('snapshot_json', { mode: 'json' }).$type<JobSnapshot>().notNull(),
    remoteTaskId: text('remote_task_id'),
    remoteStatus: text('remote_status'),
    attempts: integer('attempts').notNull().default(0),
    nextPollAt: text('next_poll_at'),
    deadlineAt: text('deadline_at').notNull(),
    errorCategory: text('error_category').$type<GenerationErrorCategory>(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    diagnostic: text('diagnostic_json', { mode: 'json' }).$type<
      import('@frame-loom/contracts').GenerationJob['diagnostic']
    >(),
    usage: text('usage_json', { mode: 'json' }).$type<unknown>(),
    rawResponse: text('raw_response_json', { mode: 'json' }).$type<OutputRef[]>(),
    outputs: text('outputs_json', { mode: 'json' }).$type<string[]>().notNull(),
    stagedOutputs: text('staged_outputs_json', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default([]),
    source: text('source').$type<SemanticRequest['source']>().notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    finishedAt: text('finished_at'),
  },
  (table) => [
    index('generation_jobs_schedule').on(table.status, table.nextPollAt),
    index('generation_jobs_project_page').on(table.projectId, table.pageId),
  ],
);

export const mediaFiles = sqliteTable('media_files', {
  sha256: text('sha256').primaryKey(),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  width: integer('width'),
  height: integer('height'),
  durationMs: integer('duration_ms'),
  fps: real('fps'),
  codec: text('codec'),
  audioCodec: text('audio_codec'),
  sampleRate: integer('sample_rate'),
  channels: integer('channels'),
  createdAt: text('created_at').notNull(),
  ext: text('ext').notNull(),
});
export type JobRow = typeof generationJobs.$inferSelect;
export type StoredMedia = MediaFile & { ext: string };

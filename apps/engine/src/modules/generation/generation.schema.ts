import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type {
  GenerationRequest,
  GenerationStatus,
  GenerationErrorCategory,
  MediaFile,
  ModelProfile,
} from '@frame-loom/contracts';
import type { AdapterOutput } from './adapters/types.js';

export const generationJobs = sqliteTable(
  'generation_jobs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id'),
    pageId: text('page_id'),
    kind: text('kind').$type<'image' | 'video' | 'tts'>().notNull(),
    // 不设级联删除：删除渠道后仍保留任务与产物，恢复时明确报配置不存在。
    channelModelId: text('channel_model_id').notNull(),
    profileId: text('profile_id').notNull(),
    profile: text('profile_json', { mode: 'json' }).$type<ModelProfile>().notNull(),
    status: text('status').$type<GenerationStatus>().notNull(),
    request: text('request_json', { mode: 'json' }).$type<GenerationRequest>().notNull(),
    snapshot: text('snapshot_json', { mode: 'json' }).$type<{
      version: 1 | 2;
      definitionId?: string | null;
      connectionId?: string | null;
      definitionVersion?: string;
      capabilityVersion?: string;
      adapterVersion?: 'v1';
      requestVersion?: 'v1';
      configVersion?: string;
      preparedRequest?: GenerationRequest;
      completedDownloads?: number[];
      imageEditPostProcess?: { intermediateSha256?: string; finalSha256?: string };
      cancellation?: 'requested' | 'confirmed' | 'unknown';
      channelId: string;
      credentialFingerprint: string;
      baseUrl: string;
      model: string;
      connection: import('@frame-loom/contracts').ModelConnection;
      idempotencyKey: string;
      referenceUrls: Record<string, string>;
    }>(),
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
    rawResponse: text('raw_response_json', { mode: 'json' }).$type<AdapterOutput[]>(),
    outputs: text('outputs_json', { mode: 'json' }).$type<string[]>().notNull(),
    stagedOutputs: text('staged_outputs_json', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default([]),
    source: text('source').$type<GenerationRequest['source']>().notNull(),
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

export const providerUploads = sqliteTable('provider_uploads', {
  key: text('key').primaryKey(),
  status: text('status').$type<'uploading' | 'ready' | 'unknown'>().notNull(),
  url: text('url'),
  expiresAt: text('expires_at'),
});

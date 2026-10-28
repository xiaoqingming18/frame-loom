import { blob, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { Capability } from '@frame-loom/contracts';
import type {
  CatalogFormat,
  EndpointOverride,
  ExtraParam,
  FixedField,
  MediaTransport,
  ModelCheck,
  ModelKind,
} from '@frame-loom/contracts';

export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  catalogFormat: text('catalog_format').$type<CatalogFormat>().notNull(),
  concurrency: integer('concurrency').notNull(),
  apiKeyCipher: blob('api_key_cipher', { mode: 'buffer' }),
  keyHint: text('key_hint'),
  secretKeyCipher: blob('secret_key_cipher', { mode: 'buffer' }),
  headersCipher: blob('headers_cipher', { mode: 'buffer' }),
  headerNames: text('header_names', { mode: 'json' }).$type<string[]>().notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const models = sqliteTable(
  'models',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<ModelKind>().notNull(),
    upstreamModelId: text('upstream_model_id').notNull(),
    displayName: text('display_name').notNull(),
    // 空串表示未选协议，避免 NULL 绕过组合唯一约束。
    protocolId: text('protocol_id').notNull(),
    endpointOverride: text('endpoint_override_json', { mode: 'json' })
      .$type<EndpointOverride>()
      .notNull(),
    transport: text('transport_json', { mode: 'json' })
      .$type<Partial<Record<'image' | 'video' | 'audio', MediaTransport>>>()
      .notNull(),
    capability: text('capability_json', { mode: 'json' }).$type<Capability>().notNull(),
    extras: text('extras_json', { mode: 'json' }).$type<ExtraParam[]>().notNull(),
    fixedFields: text('fixed_fields_json', { mode: 'json' }).$type<FixedField[]>().notNull(),
    concurrency: integer('concurrency'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    lastCheck: text('last_check_json', { mode: 'json' }).$type<ModelCheck>(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('models_channel_upstream_protocol').on(
      table.channelId,
      table.upstreamModelId,
      table.protocolId,
    ),
  ],
);
export const modelDefaults = sqliteTable('model_defaults', {
  kind: text('kind').$type<ModelKind>().primaryKey(),
  modelId: text('model_id').references(() => models.id, { onDelete: 'set null' }),
});
export const ttsVoices = sqliteTable(
  'tts_voices',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    protocolId: text('protocol_id').notNull(),
    upstreamModelId: text('upstream_model_id').notNull(),
    voiceId: text('voice_id').notNull(),
    name: text('name').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('tts_voices_owner_protocol_model_voice').on(
      table.owner,
      table.protocolId,
      table.upstreamModelId,
      table.voiceId,
    ),
  ],
);

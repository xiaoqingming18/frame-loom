import { blob, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type {
  ConnectionCheck,
  LlmProtocol,
  ModelKind,
  ModelOverrides,
  ModelConnection,
} from '@frame-loom/contracts';

export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  apiFormat: text('api_format').$type<LlmProtocol>().notNull(),
  baseUrl: text('base_url').notNull(),
  apiKeyCipher: blob('api_key_cipher', { mode: 'buffer' }),
  keyHint: text('key_hint'),
  headersCipher: blob('headers_cipher', { mode: 'buffer' }),
  headerNames: text('header_names', { mode: 'json' }).$type<string[]>().notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(),
  lastCheck: text('last_check_json', { mode: 'json' }).$type<ConnectionCheck>(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const channelModels = sqliteTable(
  'channel_models',
  {
    id: text('id').primaryKey(),
    retired: text('retired'),
    definitionId: text('definition_id'),
    connectionId: text('connection_id'),
    lastMediaCheck: text('last_media_check_json', { mode: 'json' }).$type<
      import('@frame-loom/contracts').ChannelModel['lastMediaCheck']
    >(),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    upstreamModelId: text('upstream_model_id').notNull(),
    displayName: text('display_name').notNull(),
    kind: text('kind').$type<ModelKind>(),
    // 空字符串表示未选协议，避免 SQLite 的 NULL 绕过组合唯一约束。
    protocol: text('protocol').notNull(),
    profileId: text('profile_id'),
    overrides: text('overrides_json', { mode: 'json' }).$type<ModelOverrides>().notNull(),
    connection: text('connection_json', { mode: 'json' }).$type<ModelConnection>().notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    lastCheck: text('last_check_json', { mode: 'json' }).$type<ConnectionCheck>(),
  },
  (table) => [
    uniqueIndex('channel_models_channel_upstream_protocol').on(
      table.channelId,
      table.upstreamModelId,
      table.protocol,
    ),
  ],
);
export const modelDefaults = sqliteTable('model_defaults', {
  kind: text('kind').$type<ModelKind>().primaryKey(),
  channelModelId: text('channel_model_id').references(() => channelModels.id, {
    onDelete: 'set null',
  }),
});

export const modelCatalog = sqliteTable('model_catalog', {
  id: text('id').primaryKey(),
  package: text('package_json', { mode: 'json' })
    .$type<import('@frame-loom/contracts').ModelImportPackage>()
    .notNull(),
});

export const ttsVoices = sqliteTable('tts_voices', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  protocol: text('protocol').notNull(),
  model: text('model').notNull(),
  voiceId: text('voice_id').notNull(),
  name: text('name').notNull(),
});

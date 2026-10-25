import { blob, integer, sqliteTable, text, primaryKey } from 'drizzle-orm/sqlite-core';

export const objectStorageConfig = sqliteTable('object_storage_config', {
  id: text('id').primaryKey(),
  endpoint: text('endpoint').notNull(),
  region: text('region').notNull(),
  bucket: text('bucket').notNull(),
  accessKeyId: text('access_key_id').notNull(),
  secretCipher: blob('secret_cipher', { mode: 'buffer' }).notNull(),
  forcePathStyle: integer('force_path_style', { mode: 'boolean' }).notNull(),
  keyPrefix: text('key_prefix').notNull(),
  presignTtlSeconds: integer('presign_ttl_seconds').notNull(),
});
export const objectUploads = sqliteTable(
  'object_uploads',
  {
    sha256: text('sha256').notNull(),
    storageFingerprint: text('storage_fingerprint').notNull(),
    objectKey: text('object_key').notNull(),
    uploadedAt: text('uploaded_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.sha256, table.storageFingerprint] })],
);

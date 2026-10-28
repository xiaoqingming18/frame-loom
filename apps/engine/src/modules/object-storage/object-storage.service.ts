import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { AwsClient } from 'aws4fetch';
import {
  ObjectStorageWrite,
  type ObjectStorageConfig,
  type ObjectStorageCheck,
} from '@frame-loom/contracts';
import { DatabaseService } from '../../core/database/database.service.js';
import { MediaService } from '../generation/media.service.js';
import { SecretCipher } from '../../core/crypto/secret-cipher.js';
import { DomainError } from '../../core/http/domain-error.js';
import { objectStorageConfig, objectUploads } from './object-storage.schema.js';
import type { StoredMedia } from '../generation/generation.schema.js';

type StorageRow = typeof objectStorageConfig.$inferSelect;
const id = 'global';
@Injectable()
export class ObjectStorageService {
  private readonly uploads = new Map<string, Promise<void>>();
  constructor(
    private readonly database: DatabaseService,
    private readonly cipher: SecretCipher,
    private readonly mediaService: MediaService,
  ) {}
  private row() {
    return this.database.db
      .select()
      .from(objectStorageConfig)
      .where(eq(objectStorageConfig.id, id))
      .get();
  }
  get(): ObjectStorageConfig | null {
    const row = this.row();
    if (!row) return null;
    let secretNeedsUpdate = false;
    try {
      this.cipher.decrypt(row.secretCipher, 'object_storage_config', id);
    } catch {
      secretNeedsUpdate = true;
    }
    return {
      endpoint: row.endpoint,
      region: row.region,
      bucket: row.bucket,
      accessKeyId: row.accessKeyId,
      forcePathStyle: row.forcePathStyle,
      keyPrefix: row.keyPrefix,
      presignTtlSeconds: row.presignTtlSeconds,
      hasSecret: !secretNeedsUpdate,
      secretNeedsUpdate,
    };
  }
  save(input: ObjectStorageWrite) {
    const parsed = ObjectStorageWrite.parse(input);
    const existing = this.row();
    if (!parsed.secretAccessKey && !existing)
      throw new DomainError('STORAGE_SECRET_REQUIRED', 422, '请填写对象存储 Secret');
    const { secretAccessKey, ...fields } = parsed;
    const values = {
      id,
      ...fields,
      secretCipher: secretAccessKey
        ? this.cipher.encrypt(secretAccessKey, 'object_storage_config', id)
        : existing!.secretCipher,
    };
    this.database.db
      .insert(objectStorageConfig)
      .values(values)
      .onConflictDoUpdate({ target: objectStorageConfig.id, set: values })
      .run();
    return this.get();
  }
  remove() {
    this.database.db.delete(objectStorageConfig).where(eq(objectStorageConfig.id, id)).run();
    return null;
  }
  require() {
    const row = this.row();
    if (!row) throw new DomainError('OBJECT_STORAGE_REQUIRED', 422, '请先在设置中配置对象存储');
    const secretAccessKey = this.cipher.decrypt(row.secretCipher, 'object_storage_config', id);
    return {
      row,
      client: new AwsClient({
        accessKeyId: row.accessKeyId,
        secretAccessKey,
        region: row.region,
        service: 's3',
        retries: 0,
      }),
    };
  }
  private url(row: StorageRow, key: string) {
    const url = new URL(row.endpoint);
    if (!row.forcePathStyle) url.hostname = `${row.bucket}.${url.hostname}`;
    url.pathname =
      '/' +
      (row.forcePathStyle ? `${encodeURIComponent(row.bucket)}/` : '') +
      key.split('/').map(encodeURIComponent).join('/');
    return url;
  }
  private async request(
    client: AwsClient,
    url: URL,
    method: string,
    body?: Blob,
    sha256?: string,
    signal?: AbortSignal,
  ) {
    const signed = await client.sign(url, {
      method,
      body,
      headers: sha256 ? { 'X-Amz-Content-Sha256': sha256, 'Content-Type': body!.type } : undefined,
    });
    const response = await fetch(signed, {
      redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(120_000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new DomainError(
        'OBJECT_STORAGE_FAILED',
        422,
        `对象存储 ${method} 失败（${response.status}）`,
      );
    }
    await response.body?.cancel();
  }
  private async presign(row: StorageRow, client: AwsClient, key: string) {
    const url = this.url(row, key);
    url.searchParams.set('X-Amz-Expires', String(row.presignTtlSeconds));
    url.searchParams.set('x-frame-loom-request', randomUUID());
    return (await client.sign(url, { method: 'GET', aws: { signQuery: true } })).url;
  }
  async reference(
    media: StoredMedia,
    signal?: AbortSignal,
    projectId?: string,
    root?: string,
  ): Promise<string> {
    const { row, client } = this.require();
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          row.endpoint,
          row.region,
          row.bucket,
          row.accessKeyId,
          row.forcePathStyle,
          row.keyPrefix,
        ]),
      )
      .digest('hex');
    const key = [row.keyPrefix.replace(/\/+$/, ''), `${media.sha256}.${media.ext}`]
      .filter(Boolean)
      .join('/');
    const cacheKey = `${fingerprint}/${media.sha256}`;
    let uploading = this.uploads.get(cacheKey);
    if (!uploading) {
      uploading = (async () => {
        const cached = this.database.db
          .select()
          .from(objectUploads)
          .where(
            and(
              eq(objectUploads.sha256, media.sha256),
              eq(objectUploads.storageFingerprint, fingerprint),
            ),
          )
          .get();
        // 生命周期可能删除旧对象；缓存一天后重传，兼容推荐的七天过期规则。
        if (cached && Date.now() - Date.parse(cached.uploadedAt) < 86_400_000) return;
        const blob = await openAsBlob(
          (root
            ? await this.mediaService.resolveAt(media.sha256, root)
            : await this.mediaService.resolve(media.sha256, projectId)
          ).path,
          { type: media.mime },
        );
        await this.request(client, this.url(row, key), 'PUT', blob, media.sha256, signal);
        const record = {
          sha256: media.sha256,
          storageFingerprint: fingerprint,
          objectKey: key,
          uploadedAt: new Date().toISOString(),
        };
        this.database.db
          .insert(objectUploads)
          .values(record)
          .onConflictDoUpdate({
            target: [objectUploads.sha256, objectUploads.storageFingerprint],
            set: record,
          })
          .run();
      })().finally(() => this.uploads.delete(cacheKey));
      this.uploads.set(cacheKey, uploading);
    }
    await uploading;
    return this.presign(row, client, key);
  }
  async test(): Promise<ObjectStorageCheck> {
    const steps = { upload: false, sign: false, download: false, delete: false };
    const { row, client } = this.require();
    const key = [row.keyPrefix, `.connection-test-${randomUUID()}.txt`].filter(Boolean).join('/');
    const data = randomUUID();
    let message = '上传、预签名、无凭据下载比对和删除均通过';
    try {
      await this.request(
        client,
        this.url(row, key),
        'PUT',
        new Blob([data], { type: 'text/plain' }),
      );
      steps.upload = true;
      const url = await this.presign(row, client, key);
      steps.sign = true;
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
      const bytes = response.body?.getReader();
      let result = '';
      if (bytes) {
        try {
          for (;;) {
            const chunk = await bytes.read();
            if (chunk.done) break;
            result += new TextDecoder().decode(chunk.value);
            if (result.length > 1024) break;
          }
        } finally {
          await bytes.cancel();
        }
      }
      if (!response.ok || result !== data) throw new Error('下载比对失败');
      steps.download = true;
    } catch {
      message = '连接测试失败，请检查端点、地域、权限与公网访问配置';
    } finally {
      try {
        await this.request(client, this.url(row, key), 'DELETE');
        steps.delete = true;
      } catch {
        message = '测试对象删除失败，请在存储桶中清理 .connection-test- 对象';
      }
    }
    return { ok: Object.values(steps).every(Boolean), steps, message };
  }
}

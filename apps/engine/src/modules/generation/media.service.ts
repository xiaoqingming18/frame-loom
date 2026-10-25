import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { imageSize } from 'image-size';
import { Sha256 } from '@frame-loom/contracts';
import { EngineConfig } from '../../core/config/config.js';
import { DatabaseService } from '../../core/database/database.service.js';
import { DomainError } from '../../core/http/domain-error.js';
import { mediaFiles, type StoredMedia } from './generation.schema.js';
import { GenerationFailure, type AdapterOutput } from './adapters/types.js';

const formats: Record<string, { mime: string; ext: string }> = {
  png: { mime: 'image/png', ext: 'png' },
  jpg: { mime: 'image/jpeg', ext: 'jpg' },
  webp: { mime: 'image/webp', ext: 'webp' },
};
const maxBytes = 64 * 1024 * 1024;

@Injectable()
export class MediaService {
  constructor(
    private readonly config: EngineConfig,
    private readonly database: DatabaseService,
  ) {}
  get(sha256: string): StoredMedia {
    Sha256.parse(sha256);
    const row = this.database.db
      .select()
      .from(mediaFiles)
      .where(eq(mediaFiles.sha256, sha256))
      .get();
    if (!row) throw new DomainError('MEDIA_NOT_FOUND', 404, '参考素材不存在');
    return row;
  }
  async inline(sha256: string): Promise<string> {
    const media = this.get(sha256);
    const bytes = await readFile(join(this.config.dataDir, 'media', `${sha256}.${media.ext}`));
    return `data:${media.mime};base64,${bytes.toString('base64')}`;
  }
  async save(output: AdapterOutput, signal?: AbortSignal): Promise<StoredMedia> {
    const temporary = join(this.config.dataDir, 'media', `.partial-${randomUUID()}`);
    const hash = createHash('sha256');
    let bytes = 0;
    const file = await open(temporary, 'wx');
    try {
      let chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
      if (output.data) {
        if (
          output.data.length > Math.ceil((maxBytes * 4) / 3) ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(output.data)
        )
          throw new GenerationFailure('upstream', 'INVALID_IMAGE', '图片数据无效或超过 64 MiB');
        chunks = [Buffer.from(output.data, 'base64')];
      } else {
        const url = new URL(output.url ?? '');
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
          throw new GenerationFailure(
            'input_unreachable',
            'INVALID_MEDIA_URL',
            '结果地址必须为 HTTP(S)',
          );
        // 结果下载不携带渠道鉴权，防止凭据被转发到 CDN。
        const response = await fetch(url, {
          signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]),
          redirect: 'follow',
        });
        if (!response.ok || !response.body)
          throw new GenerationFailure(
            'input_unreachable',
            `DOWNLOAD_${response.status}`,
            '产物下载失败',
          );
        chunks = response.body;
      }
      for await (const chunk of chunks) {
        signal?.throwIfAborted();
        bytes += chunk.byteLength;
        if (bytes > maxBytes)
          throw new GenerationFailure('upstream', 'MEDIA_TOO_LARGE', '产物超过 64 MiB');
        hash.update(chunk);
        await file.writeFile(chunk);
      }
      await file.sync();
      await file.close();
      const data = await readFile(temporary);
      let size: ReturnType<typeof imageSize>;
      try {
        size = imageSize(data);
      } catch {
        throw new GenerationFailure('upstream', 'INVALID_IMAGE', '产物不是有效图片');
      }
      const format = size.type ? formats[size.type] : undefined;
      if (!format || !size.width || !size.height)
        throw new GenerationFailure('upstream', 'INVALID_IMAGE', '只接受 PNG、JPEG 和 WebP 图片');
      const sha256 = hash.digest('hex');
      const row: StoredMedia = {
        sha256,
        ...format,
        bytes,
        width: size.width,
        height: size.height,
        durationMs: null,
        createdAt: new Date().toISOString(),
      };
      await rename(temporary, join(this.config.dataDir, 'media', `${sha256}.${format.ext}`));
      this.database.db.insert(mediaFiles).values(row).onConflictDoNothing().run();
      return this.get(sha256);
    } finally {
      await file.close();
      await rm(temporary, { force: true });
    }
  }
}

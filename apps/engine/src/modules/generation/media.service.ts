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
import { probeMedia } from './media-probe.js';

const formats: Record<string, { mime: string; ext: string }> = {
  png: { mime: 'image/png', ext: 'png' },
  jpg: { mime: 'image/jpeg', ext: 'jpg' },
  webp: { mime: 'image/webp', ext: 'webp' },
  mp3: { mime: 'audio/mpeg', ext: 'mp3' },
  wav: { mime: 'audio/wav', ext: 'wav' },
  ogg: { mime: 'audio/ogg', ext: 'ogg' },
};
const maxBytes = 256 * 1024 * 1024;

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
    if (!media.mime.startsWith('image/'))
      throw new DomainError('INVALID_REFERENCE', 422, '仅图片允许内联');
    const bytes = await readFile(join(this.config.dataDir, 'media', `${sha256}.${media.ext}`));
    return `data:${media.mime};base64,${bytes.toString('base64')}`;
  }
  async save(
    output: AdapterOutput,
    signal?: AbortSignal,
    headers?: Record<string, string>,
  ): Promise<StoredMedia> {
    let chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
    if (output.data) {
      if (
        output.data.length > Math.ceil((64 * 1024 * 1024 * 4) / 3) ||
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
      // 仅受控的厂商内容端点带鉴权，且拒绝重定向；公开 CDN 不携带渠道凭据。
      const response = await fetch(url, {
        signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]),
        redirect: headers ? 'error' : 'follow',
        headers,
      });
      if (!response.ok || !response.body)
        throw new GenerationFailure(
          'input_unreachable',
          `DOWNLOAD_${response.status}`,
          '产物下载失败',
        );
      chunks = response.body;
    }
    return this.saveStream(chunks, signal, output.mime.split('/')[0], output.mime);
  }
  async saveStream(
    chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
    signal?: AbortSignal,
    expectedKind?: string,
    expectedMime?: string,
  ): Promise<StoredMedia> {
    const temporary = join(this.config.dataDir, 'media', `.partial-${randomUUID()}`);
    const hash = createHash('sha256');
    let bytes = 0;
    const file = await open(temporary, 'wx');
    try {
      for await (const chunk of chunks) {
        signal?.throwIfAborted();
        bytes += chunk.byteLength;
        if (bytes > maxBytes)
          throw new GenerationFailure('invalid_params', 'MEDIA_TOO_LARGE', '素材超过 256 MiB');
        hash.update(chunk);
        await file.writeFile(chunk);
      }
      await file.sync();
      await file.close();
      let metadata: Omit<StoredMedia, 'sha256' | 'bytes' | 'createdAt'>;
      const headerFile = await open(temporary, 'r');
      const header = Buffer.alloc(12);
      try {
        await headerFile.read(header, 0, header.length, 0);
      } finally {
        await headerFile.close();
      }
      const isImage =
        header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
        header.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) ||
        (header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP');
      if (expectedKind === 'image' && !isImage)
        throw new GenerationFailure('invalid_params', 'INVALID_IMAGE', '请提供有效图片');
      if (isImage) {
        if (bytes > 64 * 1024 * 1024)
          throw new GenerationFailure('invalid_params', 'MEDIA_TOO_LARGE', '图片超过 64 MiB');
        // 先辨认文件头，避免将整段音视频读入内存。
        const size = imageSize(await readFile(temporary));
        const format = size.type ? formats[size.type] : undefined;
        if (!format || !size.width || !size.height) throw new Error('非支持图片');
        metadata = {
          ...format,
          width: size.width,
          height: size.height,
          durationMs: null,
          fps: null,
          codec: null,
          audioCodec: null,
        };
      } else if (
        expectedMime === 'audio/mpeg' ||
        expectedMime === 'audio/wav' ||
        expectedMime === 'audio/ogg'
      ) {
        const ext =
          expectedMime === 'audio/mpeg' ? 'mp3' : expectedMime === 'audio/wav' ? 'wav' : 'ogg';
        const valid =
          ext === 'mp3'
            ? header[0] === 0xff && (header[1] & 0xe0) === 0xe0
            : ext === 'wav'
              ? header.toString('ascii', 0, 4) === 'RIFF' &&
                header.toString('ascii', 8, 12) === 'WAVE'
              : header.toString('ascii', 0, 4) === 'OggS';
        if (!valid)
          throw new GenerationFailure('invalid_params', 'INVALID_AUDIO', '语音产物格式无效');
        metadata = {
          mime: expectedMime,
          ext,
          width: null,
          height: null,
          durationMs: null,
          fps: null,
          codec: null,
          audioCodec: ext,
        };
      } else {
        metadata = await probeMedia(temporary);
      }
      if (expectedKind && !metadata.mime.startsWith(expectedKind + '/'))
        throw new GenerationFailure(
          'invalid_params',
          'MEDIA_KIND_MISMATCH',
          '素材实际类型与声明不符',
        );
      const sha256 = hash.digest('hex');
      const row: StoredMedia = {
        sha256,
        ...metadata,
        bytes,
        createdAt: new Date().toISOString(),
      };
      await rename(temporary, join(this.config.dataDir, 'media', `${sha256}.${metadata.ext}`));
      this.database.db.insert(mediaFiles).values(row).onConflictDoNothing().run();
      return this.get(sha256);
    } finally {
      await file.close();
      await rm(temporary, { force: true });
    }
  }
}

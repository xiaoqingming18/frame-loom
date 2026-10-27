import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import fs, { open, readFile, rename, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
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
import { ProjectFilesService } from '../projects/project-files.service.js';
import { errorCode, internalPath } from '../projects/local-project-store.js';
import { projects } from '../projects/projects.schema.js';

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
    private readonly files: ProjectFilesService,
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
  async inline(sha256: string, projectId?: string): Promise<string> {
    const { media, path } = await this.resolve(sha256, projectId);
    if (!media.mime.startsWith('image/'))
      throw new DomainError('INVALID_REFERENCE', 422, '仅图片允许内联');
    const bytes = await readFile(path);
    return `data:${media.mime};base64,${bytes.toString('base64')}`;
  }
  async save(
    output: AdapterOutput,
    signal?: AbortSignal,
    headers?: Record<string, string>,
    projectId?: string,
    onSaved?: (media: StoredMedia, staged: boolean) => void,
    diagnose?: (
      value: NonNullable<import('@frame-loom/contracts').GenerationJob['diagnostic']>,
    ) => void,
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
      const diagnostic = {
        stage: 'download' as const,
        method: 'GET',
        route: url.origin + url.pathname,
      };
      diagnose?.(diagnostic);
      const response = await fetch(url, {
        signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]),
        redirect: headers ? 'error' : 'follow',
        headers,
      });
      diagnose?.({ ...diagnostic, httpStatus: response.status });
      if (!response.ok || !response.body)
        throw new GenerationFailure(
          'input_unreachable',
          `DOWNLOAD_${response.status}`,
          '产物下载失败',
        );
      chunks = response.body;
    }
    const persist = async (root?: string) => {
      const stored = await this.saveStream(
        chunks,
        signal,
        output.mime.split('/')[0],
        output.mime,
        root,
      );
      // 在释放项目队列前登记任务引用，避免清理抢在调用方的 await 续体之前执行。
      onSaved?.(stored, !!projectId && !root);
      return stored;
    };
    if (projectId) {
      let root: string | undefined;
      try {
        root = await this.files.root(projectId);
      } catch {
        /* 项目离线时先保留产物。 */
      }
      if (root)
        return this.files.store.serial(projectId, async () => {
          // 排队后再次检查，避免项目已被移除或重新定位。
          let current: string | undefined;
          try {
            current = await this.files.root(projectId);
          } catch {
            /* 暂存到全局。 */
          }
          return persist(current);
        });
    }
    return persist();
  }
  async saveStream(
    chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
    signal?: AbortSignal,
    expectedKind?: string,
    expectedMime?: string,
    root?: string,
  ): Promise<StoredMedia> {
    const temporary = root
      ? await internalPath(root, `tmp/${randomUUID()}.media`)
      : join(this.config.dataDir, 'media', `.partial-${randomUUID()}`);
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
      signal?.throwIfAborted();
      await file.sync();
      await file.close();
      const metadata = await this.describe(temporary, expectedKind, expectedMime);
      const sha256 = hash.digest('hex');
      const row: StoredMedia = { sha256, ...metadata, bytes, createdAt: new Date().toISOString() };
      await rename(
        temporary,
        root
          ? await internalPath(root, `media/${sha256}.${metadata.ext}`)
          : join(this.config.dataDir, 'media', `${sha256}.${metadata.ext}`),
      );
      this.database.db.insert(mediaFiles).values(row).onConflictDoNothing().run();
      return this.get(sha256);
    } finally {
      await file.close();
      await rm(temporary, { force: true });
    }
  }

  async describe(temporary: string, expectedKind?: string, expectedMime?: string) {
    const bytes = (await fs.stat(temporary)).size;
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
      let size: ReturnType<typeof imageSize>;
      try {
        size = imageSize(await readFile(temporary));
      } catch {
        throw new GenerationFailure('invalid_params', 'INVALID_IMAGE', '请提供有效图片');
      }
      const format = size.type ? formats[size.type] : undefined;
      if (!format || !size.width || !size.height)
        throw new GenerationFailure('invalid_params', 'INVALID_IMAGE', '请提供有效图片');
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
    return metadata;
  }

  async find(directory: string, sha256: string): Promise<string | undefined> {
    Sha256.parse(sha256);
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !new RegExp(`^${sha256}\\.[a-z0-9]+$`).test(entry.name)) continue;
      return join(directory, entry.name);
    }
  }

  async metadata(path: string, sha256: string): Promise<StoredMedia> {
    const existing = this.database.db
      .select()
      .from(mediaFiles)
      .where(eq(mediaFiles.sha256, sha256))
      .get();
    if (existing) return existing;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) hash.update(chunk);
    if (hash.digest('hex') !== sha256)
      throw new DomainError('MEDIA_HASH_MISMATCH', 409, '素材内容与哈希不一致');
    const metadata = await this.describe(path);
    const row = {
      sha256,
      ...metadata,
      bytes: (await fs.stat(path)).size,
      createdAt: new Date().toISOString(),
    };
    this.database.db.insert(mediaFiles).values(row).onConflictDoNothing().run();
    return this.get(sha256);
  }

  async resolveAt(sha256: string, root?: string): Promise<{ path: string; media: StoredMedia }> {
    Sha256.parse(sha256);
    let path: string | undefined;
    if (root) {
      path = await this.find(await internalPath(root, 'media'), sha256);
      if (!path) {
        const trash = await this.find(await internalPath(root, 'trash/media'), sha256);
        if (trash) {
          const media = await this.metadata(trash, sha256);
          path = await internalPath(root, `media/${sha256}.${media.ext}`);
          await rename(trash, path);
        }
      }
    }
    path ??= await this.find(join(this.config.dataDir, 'media'), sha256);
    if (!path) throw new DomainError('MEDIA_NOT_FOUND', 404, '参考素材不存在');
    return { path, media: await this.metadata(path, sha256) };
  }

  async resolve(sha256: string, projectId?: string) {
    if (!projectId) return this.resolveAt(sha256);
    return this.files.store.serial(projectId, async () => {
      let root: string | undefined;
      try {
        root = await this.files.root(projectId);
      } catch {
        /* 离线项目仍可读取暂存文件。 */
      }
      return this.resolveAt(sha256, root);
    });
  }

  upload(
    projectId: string,
    chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
    signal?: AbortSignal,
  ) {
    return this.files.store.serial(projectId, async () => {
      try {
        return await this.saveStream(
          chunks,
          signal,
          undefined,
          undefined,
          await this.files.root(projectId),
        );
      } catch (error) {
        if (error instanceof GenerationFailure)
          throw new DomainError(
            error.code,
            error.code === 'MEDIA_TOO_LARGE' ? 413 : 422,
            error.message,
          );
        throw error;
      }
    });
  }

  // 调用方已持有目标项目队列；来源只读，不能嵌套等待其他项目队列。
  async adoptAt(root: string, hashes: string[]): Promise<string[]> {
    const missing: string[] = [];
    for (const sha256 of new Set(hashes)) {
      Sha256.parse(sha256);
      const existing = await this.find(await internalPath(root, 'media'), sha256);
      if (existing) {
        await this.metadata(existing, sha256);
        continue;
      }
      let source = await this.find(join(this.config.dataDir, 'media'), sha256);
      if (!source)
        for (const row of this.database.db.select().from(projects).all()) {
          if (row.rootPath === root) continue;
          try {
            const other = await this.files.root(row.id);
            source =
              (await this.find(await internalPath(other, 'media'), sha256)) ??
              (await this.find(await internalPath(other, 'trash/media'), sha256));
          } catch {
            continue;
          }
          if (source) break;
        }
      source ??= await this.find(await internalPath(root, 'trash/media'), sha256);
      if (!source) {
        missing.push(sha256);
        continue;
      }
      const temporary = await internalPath(root, `tmp/${randomUUID()}.media`);
      try {
        await fs.copyFile(source, temporary);
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(temporary) as AsyncIterable<Buffer>)
          hash.update(chunk);
        if (hash.digest('hex') !== sha256)
          throw new DomainError('MEDIA_HASH_MISMATCH', 409, '素材内容与哈希不一致');
        const media = await this.metadata(temporary, sha256);
        await rename(temporary, await internalPath(root, `media/${sha256}.${media.ext}`));
      } finally {
        await rm(temporary, { force: true });
      }
    }
    return missing;
  }

  adopt(projectId: string, hashes: string[]) {
    return this.files.store.serial(projectId, async () => ({
      missing: await this.adoptAt(await this.files.root(projectId), hashes),
    }));
  }
}

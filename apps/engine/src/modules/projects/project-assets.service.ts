import { Injectable } from '@nestjs/common';
import {
  AssetExportRequest,
  AssetMoveRequest,
  AssetRenameRequest,
  EntryName,
  type AssetEntry,
} from '@frame-loom/contracts';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { basename, extname, posix } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { DomainError } from '../../core/http/domain-error.js';
import { GenerationFailure } from '../generation/adapters/types.js';
import { MediaService } from '../generation/media.service.js';
import { ProjectFilesService, assetPath } from './project-files.service.js';
import { errorCode, internalPath } from './local-project-store.js';

const maxBytes = 4 * 1024 ** 3;
const types: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
};
export const assetMime = (path: string) =>
  types[extname(path).toLowerCase()] ?? 'application/octet-stream';

async function assetStat(path: string) {
  try {
    return await fs.stat(path);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') throw new DomainError('ASSET_NOT_FOUND', 404, '资产不存在');
    if (['EACCES', 'EPERM'].includes(errorCode(error) ?? ''))
      throw new DomainError('ASSET_ACCESS_DENIED', 403, '无法访问此资产');
    throw error;
  }
}

@Injectable()
export class ProjectAssetsService {
  statfs = (path: string) => fs.statfs(path, { bigint: true });
  constructor(
    private readonly files: ProjectFilesService,
    private readonly media: MediaService,
  ) {}

  private async entry(root: string, path: string): Promise<AssetEntry> {
    const file = await assetPath(root, path);
    const stat = await assetStat(file);
    if (!stat.isFile() && !stat.isDirectory())
      throw new DomainError('ASSET_UNSUPPORTED', 400, '不支持此文件类型');
    const kind = assetMime(path).split('/')[0];
    return {
      name: basename(file),
      path,
      type: stat.isDirectory() ? 'directory' : 'file',
      bytes: stat.isDirectory() ? 0 : stat.size,
      updatedAt: stat.mtime.toISOString(),
      mediaKind:
        stat.isFile() && ['image', 'video', 'audio'].includes(kind)
          ? (kind as 'image' | 'video' | 'audio')
          : null,
    };
  }
  private async directory(root: string, path: string) {
    const target = await assetPath(root, path);
    if (!(await assetStat(target)).isDirectory())
      throw new DomainError('ASSET_NOT_DIRECTORY', 400, '目标必须是文件夹');
    return target;
  }
  private async listAt(root: string, path: string) {
    const entries: AssetEntry[] = [];
    for (const item of await fs.readdir(await this.directory(root, path), {
      withFileTypes: true,
    })) {
      if (item.isSymbolicLink() || (!item.isFile() && !item.isDirectory())) continue;
      try {
        entries.push(await this.entry(root, posix.join(path, item.name)));
      } catch (error) {
        if (
          !(error instanceof ZodError) &&
          ![
            'ENOENT',
            'EACCES',
            'EPERM',
            'PROJECT_PATH_UNSAFE',
            'ASSET_UNSUPPORTED',
            'ASSET_NOT_FOUND',
            'ASSET_ACCESS_DENIED',
          ].includes(errorCode(error) ?? '')
        )
          throw error;
      }
    }
    return entries.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1,
    );
  }
  list(id: string, path: string) {
    return this.files.store.serial(id, async () => this.listAt(await this.files.root(id), path));
  }
  search(id: string, query: string) {
    return this.files.store.serial(id, async () => {
      const root = await this.files.root(id);
      const entries: AssetEntry[] = [];
      let truncated = false;
      const walk = async (path: string): Promise<void> => {
        let children;
        try {
          children = await this.listAt(root, path);
        } catch (error) {
          if (
            ['ENOENT', 'EACCES', 'EPERM', 'ASSET_NOT_FOUND', 'ASSET_ACCESS_DENIED'].includes(
              errorCode(error) ?? '',
            )
          )
            return;
          throw error;
        }
        for (const child of children) {
          if (child.name.toLowerCase().includes(query.toLowerCase())) {
            if (entries.length === 500) {
              truncated = true;
              return;
            }
            entries.push(child);
          }
          if (child.type === 'directory') await walk(child.path);
          if (truncated) return;
        }
      };
      await walk('');
      return { entries, truncated };
    });
  }
  private async unused(root: string, folder: string, name: string, increment: boolean) {
    await this.directory(root, folder);
    const names = new Set(
      (await fs.readdir(await assetPath(root, folder))).map((item) => item.toLowerCase()),
    );
    const ext = extname(name),
      stem = name.slice(0, name.length - ext.length);
    let candidate = name;
    for (let count = 2; names.has(candidate.toLowerCase()); count++) {
      if (!increment)
        throw new DomainError('ASSET_NAME_CONFLICT', 409, '目标文件夹中已存在同名资产');
      const suffix = ` (${count})${ext}`;
      candidate = `${[...stem].slice(0, 80 - [...suffix].length).join('')}${suffix}`;
    }
    EntryName.parse(candidate);
    return posix.join(folder, candidate);
  }
  folder(id: string, path: string, name: string) {
    return this.files.store.serial(id, async () => {
      const root = await this.files.root(id);
      const target = await this.unused(root, path, name, false);
      try {
        await fs.mkdir(await assetPath(root, target));
      } catch (error) {
        if (errorCode(error) === 'EEXIST')
          throw new DomainError('ASSET_NAME_CONFLICT', 409, '存在同名资产');
        throw error;
      }
      return this.entry(root, target);
    });
  }
  async writeAt(
    root: string,
    folder: string,
    name: string,
    chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
    length?: number,
    signal?: AbortSignal,
  ) {
    if (length !== undefined && (!Number.isSafeInteger(length) || length < 0 || length > maxBytes))
      throw new DomainError('ASSET_TOO_LARGE', 413, '资产超过 4 GiB');
    const target = await this.unused(root, folder, name, true);
    const temporary = await internalPath(root, `tmp/${randomUUID()}.asset`);
    const space = await this.statfs(root);
    const available = space.bavail * space.bsize;
    if (available < BigInt(length ?? 1))
      throw new DomainError('ASSET_NO_SPACE', 507, '磁盘剩余空间不足');
    const file = await fs.open(temporary, 'wx');
    let bytes = 0;
    try {
      for await (const chunk of chunks) {
        signal?.throwIfAborted();
        bytes += chunk.byteLength;
        if (bytes > maxBytes) throw new DomainError('ASSET_TOO_LARGE', 413, '资产超过 4 GiB');
        if (BigInt(bytes) > available)
          throw new DomainError('ASSET_NO_SPACE', 507, '磁盘剩余空间不足');
        await file.writeFile(chunk);
      }
      signal?.throwIfAborted();
      if (length !== undefined && bytes !== length)
        throw new DomainError('ASSET_UPLOAD_INCOMPLETE', 400, '上传未完成');
      await file.sync();
      await file.close();
      // 同卷硬链接原子发布完整文件，且不会覆盖外部程序刚创建的同名文件。
      await fs.link(temporary, await assetPath(root, target));
      return await this.entry(root, target);
    } catch (error) {
      if (errorCode(error) === 'ENOSPC')
        throw new DomainError('ASSET_NO_SPACE', 507, '磁盘剩余空间不足');
      if (errorCode(error) === 'EEXIST')
        throw new DomainError('ASSET_NAME_CONFLICT', 409, '存在同名资产，请重试');
      if (['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].includes(errorCode(error) ?? ''))
        throw new DomainError(
          'ASSET_FILESYSTEM_UNSUPPORTED',
          422,
          '该磁盘不支持安全发布文件，请使用支持硬链接的本地磁盘',
        );
      throw error;
    } finally {
      await file.close();
      await fs.rm(temporary, { force: true });
    }
  }
  upload(
    id: string,
    folder: string,
    name: string,
    chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
    length?: number,
    signal?: AbortSignal,
  ) {
    return this.files.store.serial(id, async () =>
      this.writeAt(await this.files.root(id), folder, name, chunks, length, signal),
    );
  }
  private async moveAt(root: string, path: string, folder: string, name: string) {
    const source = await assetPath(root, path);
    const info = await assetStat(source);
    const target = await this.unused(root, folder, name, false);
    if (
      info.isDirectory() &&
      (folder.toLowerCase() === path.toLowerCase() ||
        folder.toLowerCase().startsWith(`${path.toLowerCase()}/`))
    )
      throw new DomainError('ASSET_MOVE_INTO_SELF', 400, '不能将文件夹移入自身或子目录');
    const destination = await assetPath(root, target);
    try {
      if (info.isFile()) {
        await fs.link(source, destination);
        await fs.unlink(source);
      } else if (info.isDirectory()) await fs.rename(source, destination);
      else throw new DomainError('ASSET_UNSUPPORTED', 400, '不支持此文件类型');
    } catch (error) {
      if (['EEXIST', 'ENOTEMPTY'].includes(errorCode(error) ?? ''))
        throw new DomainError('ASSET_NAME_CONFLICT', 409, '存在同名资产');
      throw error;
    }
    return this.entry(root, target);
  }
  rename(id: string, input: AssetRenameRequest) {
    return this.files.store.serial(id, async () =>
      this.moveAt(
        await this.files.root(id),
        input.path,
        posix.dirname(input.path) === '.' ? '' : posix.dirname(input.path),
        input.name,
      ),
    );
  }
  move(id: string, input: AssetMoveRequest) {
    return this.files.store.serial(id, async () =>
      this.moveAt(
        await this.files.root(id),
        input.path,
        input.destination,
        posix.basename(input.path),
      ),
    );
  }
  fromAsset(id: string, path: string) {
    return this.files.store.serial(id, async () => {
      const root = await this.files.root(id);
      const source = await assetPath(root, path);
      if (!(await assetStat(source)).isFile())
        throw new DomainError('INVALID_REFERENCE', 422, '请选择图片或视频文件');
      let metadata;
      try {
        metadata = await this.media.describe(source);
      } catch {
        throw new DomainError('INVALID_REFERENCE', 422, '请选择有效的图片或视频文件');
      }
      if (!metadata.mime.startsWith('image/') && !metadata.mime.startsWith('video/'))
        throw new DomainError('INVALID_REFERENCE', 422, '仅图片和视频可以导入画布');
      try {
        return await this.media.saveStream(
          createReadStream(source),
          undefined,
          undefined,
          undefined,
          root,
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
  fromMedia(id: string, input: AssetExportRequest) {
    return this.files.store.serial(id, async () => {
      const root = await this.files.root(id);
      const { path } = await this.media.resolveAt(input.sha256, root);
      return this.writeAt(
        root,
        input.path,
        input.name,
        createReadStream(path),
        (await fs.stat(path)).size,
      );
    });
  }
  async file(id: string, path: string) {
    const file = await assetPath(await this.files.root(id), path);
    if (!(await assetStat(file)).isFile())
      throw new DomainError('ASSET_NOT_FILE', 400, '请选择文件');
    return { path: file, mime: assetMime(file), name: basename(file) };
  }
}

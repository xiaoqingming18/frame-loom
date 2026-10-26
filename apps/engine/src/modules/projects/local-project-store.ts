import { Injectable } from '@nestjs/common';
import { ProjectManifest, ProjectPageFile } from '@frame-loom/contracts';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { DomainError } from '../../core/http/domain-error.js';
import { ProjectStore } from './project-store.js';

export function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
}

export async function retryRename(source: string, target: string): Promise<void> {
  const deadline = Date.now() + 2000;
  let delay = 50;
  for (;;) {
    try {
      await fs.rename(source, target);
      return;
    } catch (error) {
      if (!['EPERM', 'EBUSY'].includes(errorCode(error) ?? '') || Date.now() >= deadline)
        throw new DomainError(
          'PROJECT_WRITE_FAILED',
          500,
          '项目写入失败，请关闭占用文件的程序后重试',
        );
      await setTimeout(Math.min(delay, Math.max(0, deadline - Date.now())));
      delay = Math.min(delay * 2, 400);
    }
  }
}

// 所有内部路径也逐段检查，不能让被替换成 junction 的 .frameloom 写出项目。
export async function internalPath(root: string, path: string): Promise<string> {
  if (
    isAbsolute(path) ||
    path.includes('\\') ||
    path.includes(':') ||
    path.split('/').some((part) => part === '..' || part === '.')
  )
    throw new DomainError('PROJECT_PATH_UNSAFE', 400, '项目内部路径不合法');
  if ((await fs.lstat(root)).isSymbolicLink())
    throw new DomainError('PROJECT_PATH_UNSAFE', 400, '项目根目录不能被替换为符号链接或 junction');
  const realRoot = await fs.realpath(root);
  let current = root;
  for (const part of ['.frameloom', ...path.split('/').filter(Boolean)]) {
    current = join(current, part);
    try {
      const info = await fs.lstat(current);
      if (info.isSymbolicLink())
        throw new DomainError('PROJECT_PATH_UNSAFE', 400, '项目内部路径不能是符号链接或 junction');
      const resolved = relative(realRoot, await fs.realpath(current));
      if (
        resolved === '..' ||
        resolved.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
        isAbsolute(resolved)
      )
        throw new DomainError('PROJECT_PATH_UNSAFE', 400, '项目内部路径超出项目目录');
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
      break;
    }
  }
  return join(root, '.frameloom', path);
}

@Injectable()
export class LocalProjectStore extends ProjectStore {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly pages = new Map<
    string,
    { revision: number; mtime: bigint; size: bigint; digest: string }
  >();

  async serial<T>(id: string, operation: () => Promise<T> | T): Promise<T> {
    const task = (this.queues.get(id) ?? Promise.resolve()).catch(() => {}).then(operation);
    this.queues.set(id, task);
    try {
      return await task;
    } finally {
      if (this.queues.get(id) === task) this.queues.delete(id);
    }
  }

  async readManifest(root: string): Promise<ProjectManifest> {
    const raw: unknown = JSON.parse(
      await fs.readFile(await internalPath(root, 'project.json'), 'utf8'),
    );
    if (
      raw &&
      typeof raw === 'object' &&
      'formatVersion' in raw &&
      typeof raw.formatVersion === 'number' &&
      raw.formatVersion > 1
    )
      throw new DomainError('PROJECT_FORMAT_TOO_NEW', 409, '需要更新应用才能打开此项目');
    return ProjectManifest.parse(raw);
  }

  async atomicWrite(root: string, path: string, value: unknown): Promise<void> {
    let temporary: string | undefined;
    try {
      const target = await internalPath(root, path);
      temporary = await internalPath(root, `tmp/${randomUUID()}.json`);
      const handle = await fs.open(temporary, 'wx');
      try {
        await handle.writeFile(JSON.stringify(value));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await retryRename(temporary, target);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError('PROJECT_WRITE_FAILED', 500, '项目写入失败，请检查目录权限与剩余空间');
    } finally {
      if (temporary) await fs.rm(temporary, { force: true }).catch(() => {});
    }
  }

  writeManifest(root: string, manifest: ProjectManifest): Promise<void> {
    return this.atomicWrite(root, 'project.json', ProjectManifest.parse(manifest));
  }

  async readPage(root: string, pageId: string, saving = false): Promise<ProjectPageFile> {
    const path = await internalPath(root, `pages/${pageId}.json`);
    // 即使 mtime/size 相同也读 revision，避免同步软件保留时间戳后返回旧文档。
    const handle = await fs.open(path, 'r');
    let text: string;
    let info;
    try {
      text = await handle.readFile('utf8');
      info = await handle.stat({ bigint: true });
    } finally {
      await handle.close();
    }
    const page = ProjectPageFile.parse(JSON.parse(text) as unknown);
    if (page.id !== pageId) throw new DomainError('PAGE_ID_MISMATCH', 409, '创作页文件 id 不一致');
    const previous = this.pages.get(path);
    const digest = createHash('sha256').update(text).digest('hex');
    if (
      saving &&
      previous &&
      (previous.revision !== page.revision ||
        previous.digest !== digest ||
        previous.mtime !== info.mtimeNs ||
        previous.size !== info.size)
    )
      throw new DomainError(
        'PAGE_REVISION_CONFLICT',
        409,
        '创作页已被外部修改，请重新加载或导出当前画布',
      );
    this.pages.set(path, { revision: page.revision, mtime: info.mtimeNs, size: info.size, digest });
    return page;
  }

  async writePage(root: string, page: ProjectPageFile): Promise<void> {
    await this.atomicWrite(root, `pages/${page.id}.json`, ProjectPageFile.parse(page));
    await this.readPage(root, page.id);
  }

  async trashPage(root: string, pageId: string): Promise<string> {
    const source = await internalPath(root, `pages/${pageId}.json`);
    const trashName = `${pageId}-${Date.now()}-${randomUUID()}.json`;
    const target = await internalPath(root, `trash/pages/${trashName}`);
    await retryRename(source, target);
    this.pages.delete(source);
    return trashName;
  }

  async restorePage(root: string, pageId: string, trashName: string): Promise<void> {
    await retryRename(
      await internalPath(root, `trash/pages/${trashName}`),
      await internalPath(root, `pages/${pageId}.json`),
    );
  }
}

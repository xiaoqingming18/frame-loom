import { Injectable } from '@nestjs/common';
import { ProjectDiskManifest, type ProjectManifest } from '@frame-loom/contracts';
import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { DomainError } from '../../core/http/domain-error.js';
import { errorCode, internalPath, retryRename } from './local-project-store.js';
import { PROJECT_SCRIPT_SCHEMA, PROJECT_SCRIPT_SCHEMA_VERSION } from './project-script.schema.js';

const Meta = z.object({
  schema_version: z.literal(PROJECT_SCRIPT_SCHEMA_VERSION),
  project_id: z.string().uuid(),
  phase: z.enum([
    'pending',
    'scripts-cleared',
    'story-cleared',
    'recycle-cleared',
    'manifest-written',
    'ready',
  ]),
});
type WriteManifest = (manifest: ProjectManifest) => Promise<void>;

@Injectable()
export class ProjectScriptDatabase {
  releaseTasks: (projectId: string) => Promise<void> = () => Promise.resolve();
  private async open(root: string, projectId: string): Promise<Database.Database> {
    const path = await internalPath(root, 'project.sqlite');
    let db: Database.Database | undefined;
    try {
      db = new Database(path, { fileMustExist: true });
      const meta = Meta.parse(
        db.prepare('SELECT * FROM script_store_meta WHERE singleton = 1').get(),
      );
      if (meta.project_id !== projectId) throw new Error('项目数据库身份不一致');
      if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('项目数据库损坏');
      db.pragma('foreign_keys = ON');
      db.pragma('busy_timeout = 5000');
      return db;
    } catch (error) {
      db?.close();
      throw new DomainError(
        'PROJECT_DATABASE_UNAVAILABLE',
        409,
        `项目数据库缺失、损坏或版本不兼容：${error instanceof Error ? error.message : '无法读取'}`,
      );
    }
  }

  async create(
    root: string,
    projectId: string,
    phase: 'pending' | 'ready' = 'ready',
  ): Promise<void> {
    const path = await internalPath(root, 'project.sqlite');
    try {
      await fs.lstat(path);
      throw new DomainError('PROJECT_DATABASE_EXISTS', 409, '项目数据库已存在，不能覆盖');
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
    const temporary = await internalPath(root, `tmp/project-script-init-${randomUUID()}.sqlite`);
    await fs.mkdir(await internalPath(root, 'tmp'), { recursive: true });
    let db: Database.Database | undefined;
    try {
      db = new Database(temporary);
      db.pragma('journal_mode = DELETE');
      db.pragma('foreign_keys = ON');
      db.transaction(() => {
        db!.exec(PROJECT_SCRIPT_SCHEMA);
        db!
          .prepare(
            'INSERT INTO script_store_meta(singleton,schema_version,project_id,phase) VALUES (1,?,?,?)',
          )
          .run(PROJECT_SCRIPT_SCHEMA_VERSION, projectId, phase);
      })();
      db.close();
      db = undefined;
      await retryRename(temporary, path);
    } finally {
      db?.close();
      await fs.rm(temporary, { force: true });
    }
  }

  // 整个项目随时可关库移动；业务回调必须同步，禁止把模型网络请求带入连接生命周期。
  async use<T>(
    root: string,
    projectId: string,
    operation: (db: Database.Database) => T,
  ): Promise<T> {
    const db = await this.open(root, projectId);
    try {
      const meta = Meta.parse(
        db.prepare('SELECT * FROM script_store_meta WHERE singleton = 1').get(),
      );
      if (meta.phase !== 'ready')
        throw new DomainError('PROJECT_UPGRADING', 409, '项目升级未完成，请重试打开项目');
      const result = operation(db);
      if (result instanceof Promise) throw new Error('项目数据库回调不能异步');
      return result;
    } finally {
      db.close();
    }
  }

  private async removeLegacy(root: string, path: string): Promise<void> {
    const target = await internalPath(root, path);
    // 删除前拒绝目录内链接，测试哨兵与项目外文件不能被清理器触及。
    const check = async (entry: string): Promise<void> => {
      const info = await fs.lstat(entry);
      if (info.isSymbolicLink())
        throw new DomainError('PROJECT_PATH_UNSAFE', 400, '旧剧本目录含链接，无法安全清理');
      if (info.isDirectory())
        for (const child of await fs.readdir(entry)) await check(join(entry, child));
    };
    try {
      await check(target);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return;
      throw error;
    }
    await fs.rm(target, { recursive: true, force: true });
  }

  async prepare(
    root: string,
    manifest: ProjectManifest,
    write: WriteManifest,
  ): Promise<ProjectManifest> {
    if (manifest.formatVersion === 1) {
      try {
        await fs.lstat(await internalPath(root, 'project.sqlite'));
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
        await this.create(root, manifest.id, 'pending');
      }
    }
    const db = await this.open(root, manifest.id);
    let phase = Meta.parse(
      db.prepare('SELECT * FROM script_store_meta WHERE singleton = 1').get(),
    ).phase;
    db.close();
    if (phase === 'ready') {
      if (manifest.formatVersion !== 2)
        throw new DomainError(
          'PROJECT_UPGRADE_INCONSISTENT',
          409,
          '旧清单与已完成数据库不一致，拒绝重复清理',
        );
      return ProjectDiskManifest.parse(manifest);
    }
    const advance = async (next: typeof phase) => {
      const connection = await this.open(root, manifest.id);
      try {
        connection.prepare('UPDATE script_store_meta SET phase = ? WHERE singleton = 1').run(next);
      } finally {
        connection.close();
      }
      phase = next;
    };
    if (manifest.formatVersion === 2 && phase !== 'recycle-cleared' && phase !== 'manifest-written')
      throw new DomainError(
        'PROJECT_UPGRADE_INCONSISTENT',
        409,
        '升级阶段与清单版本不一致，拒绝清理',
      );
    if (phase === 'pending') {
      await this.removeLegacy(root, 'scripts');
      await advance('scripts-cleared');
    }
    if (phase === 'scripts-cleared') {
      await this.removeLegacy(root, 'story.json');
      await advance('story-cleared');
    }
    if (phase === 'story-cleared') {
      await this.removeLegacy(root, 'trash/scripts');
      await advance('recycle-cleared');
    }
    const upgraded = ProjectDiskManifest.parse({
      ...manifest,
      episodes: undefined,
      formatVersion: 2,
      pages: manifest.pages.map((page) => ({ ...page, episodeId: null })),
    });
    if (phase === 'recycle-cleared') {
      await write(upgraded);
      await advance('manifest-written');
    }
    if (phase === 'manifest-written') await advance('ready');
    return upgraded;
  }
}

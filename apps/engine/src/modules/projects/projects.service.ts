import { Injectable } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';
import {
  CanvasMediaData,
  CanvasView,
  BUILTIN_TAGS,
  ProjectName,
  ProjectId,
  ProjectPageId,
  ProjectProfile,
  type ProjectPageCreateRequest,
  type ProjectPageRenameRequest,
  emptyCanvasDocument,
  type ProjectManifest,
  type ProjectPageFile,
  type ProjectPageSummary,
  type ProjectSummary,
  type ProjectCreateRequest,
  type ProjectOpenRequest,
  type ProjectPageSaveRequest,
} from '@frame-loom/contracts';
import { DatabaseService } from '../../core/database/database.service.js';
import { DomainError } from '../../core/http/domain-error.js';
import { ProjectStore } from './project-store.js';
import { errorCode, internalPath } from './local-project-store.js';
import { pageViews, projects } from './projects.schema.js';
import { MediaService } from '../generation/media.service.js';
import { ProjectMediaService, documentReferences } from './project-media.service.js';
import { ProjectScriptDatabase } from './project-script-database.js';
import { episodeRow, episodeSummaries } from '../scripts/script-repository.js';

type ProjectRow = typeof projects.$inferSelect;
const fail = (code: string, message: string, status = 409): never => {
  throw new DomainError(code, status, message);
};

@Injectable()
export class ProjectsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly store: ProjectStore,
    private readonly media: MediaService,
    private readonly projectMedia: ProjectMediaService,
    private readonly scriptDatabase: ProjectScriptDatabase,
  ) {}

  private row(id: string): ProjectRow {
    ProjectId.parse(id);
    return (
      this.database.db.select().from(projects).where(eq(projects.id, id)).get() ??
      fail('PROJECT_NOT_FOUND', '项目不在项目库中', 404)
    );
  }

  private async canonical(path: string): Promise<string> {
    if (!isAbsolute(path)) fail('PROJECT_PATH_INVALID', '保存位置必须是已存在的绝对目录', 400);
    try {
      if (!(await fs.stat(path)).isDirectory())
        fail('PROJECT_PATH_INVALID', '保存位置必须是目录', 400);
      const resolved = normalize(await fs.realpath(path));
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      return fail('PROJECT_PATH_INVALID', '无法访问所选目录', 400);
    }
  }

  private uniqueName(name: string, except?: string): void {
    if (
      this.database.db
        .select()
        .from(projects)
        .all()
        .some((row) => row.id !== except && row.name.toLowerCase() === name.toLowerCase())
    )
      fail('PROJECT_NAME_CONFLICT', '项目库中已存在同名项目，请修改名称');
  }

  private uniquePage(manifest: ProjectManifest, name: string, except?: string): void {
    if (
      manifest.pages.some(
        (page) => page.id !== except && page.name.toLowerCase() === name.toLowerCase(),
      )
    )
      fail('PAGE_NAME_CONFLICT', '项目中已存在同名创作页，请修改名称');
  }

  private async inspect(
    row: ProjectRow,
  ): Promise<{ summary: ProjectSummary; manifest?: ProjectManifest }> {
    try {
      const manifest = await this.store.readManifest(row.rootPath);
      if (manifest.id !== row.id) return { summary: { ...row, status: 'mismatch' } };
      this.cache(manifest);
      return {
        summary: {
          ...row,
          name: manifest.name,
          createdAt: manifest.createdAt,
          updatedAt: manifest.updatedAt,
          status: 'available',
          ...(manifest.profile ? { profile: manifest.profile } : {}),
        },
        manifest,
      };
    } catch (error) {
      const status =
        errorCode(error) === 'ENOENT'
          ? 'missing'
          : error instanceof DomainError && error.code === 'PROJECT_FORMAT_TOO_NEW'
            ? 'too_new'
            : 'unreadable';
      return { summary: { ...row, status } };
    }
  }

  private async available(id: string): Promise<{ row: ProjectRow; manifest: ProjectManifest }> {
    const row = this.row(id);
    const { summary, manifest } = await this.inspect(row);
    if (!manifest)
      fail(`PROJECT_${summary.status.toUpperCase()}`, '项目不可用，请重新定位或检查项目文件');
    const prepared = await this.scriptDatabase.prepare(row.rootPath, manifest!, (value) =>
      this.store.writeManifest(row.rootPath, value),
    );
    return { row, manifest: prepared };
  }

  private cache(manifest: ProjectManifest): void {
    this.database.db
      .update(projects)
      .set({ name: manifest.name, createdAt: manifest.createdAt, updatedAt: manifest.updatedAt })
      .where(eq(projects.id, manifest.id))
      .run();
  }

  private register(rootPath: string, manifest: ProjectManifest): ProjectSummary {
    const now = new Date().toISOString();
    const existing = this.database.db
      .select()
      .from(projects)
      .where(and(eq(projects.rootPath, rootPath), ne(projects.id, manifest.id)))
      .get();
    if (existing) fail('PROJECT_PATH_CONFLICT', '此目录已登记为其他项目，请先移除旧记录');
    this.database.db
      .insert(projects)
      .values({
        id: manifest.id,
        rootPath,
        name: manifest.name,
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt,
        addedAt: now,
        lastOpenedAt: now,
      })
      .onConflictDoUpdate({
        target: projects.id,
        set: { rootPath, name: manifest.name, updatedAt: manifest.updatedAt, lastOpenedAt: now },
      })
      .run();
    return {
      ...this.row(manifest.id),
      status: 'available',
      ...(manifest.profile ? { profile: manifest.profile } : {}),
    };
  }

  async list(): Promise<ProjectSummary[]> {
    return Promise.all(
      this.database.db
        .select()
        .from(projects)
        .all()
        .map((row) =>
          this.store.serial(row.id, async () => {
            const inspected = await this.inspect(row);
            if (inspected.manifest) await this.projectMedia.restoreAt(row.id, row.rootPath);
            return inspected.summary;
          }),
        ),
    );
  }

  create(input: ProjectCreateRequest): Promise<ProjectSummary> {
    return this.store.serial('registry', async () => {
      const name = ProjectName.parse(input.name);
      this.uniqueName(name);
      const location = await this.canonical(input.location);
      const root = join(location, name);
      if (root.length > 200) fail('PROJECT_PATH_TOO_LONG', '项目完整路径不能超过 200 个字符', 400);
      try {
        await fs.mkdir(root);
      } catch (error) {
        if (errorCode(error) === 'EEXIST')
          fail('PROJECT_DIRECTORY_EXISTS', '该位置已存在同名文件夹，请修改项目名称');
        return fail('PROJECT_WRITE_FAILED', '无法在保存位置创建项目', 500);
      }
      try {
        for (const directory of ['pages', 'media', 'trash/pages', 'trash/media', 'tmp'])
          await fs.mkdir(join(root, '.frameloom', directory), { recursive: true });
        const now = new Date().toISOString();
        const manifest: ProjectManifest = {
          format: 'frame-loom-project',
          formatVersion: 2,
          id: randomUUID(),
          name,
          createdAt: now,
          updatedAt: now,
          pages: [],
          tags: BUILTIN_TAGS,
          ...(input.profile ? { profile: ProjectProfile.parse(input.profile) } : {}),
        };
        await this.scriptDatabase.create(root, manifest.id);
        await this.store.writeManifest(root, manifest);
        return this.register(await this.canonical(root), manifest);
      } catch (error) {
        for (const file of ['project.json', 'project.sqlite'])
          await fs.rm(await internalPath(root, file), { force: true }).catch(() => {});
        for (const directory of [
          'trash/media',
          'trash/pages',
          'trash',
          'tmp',
          'media',
          'pages',
          '',
        ])
          await fs.rmdir(join(root, '.frameloom', directory)).catch(() => {});
        await fs.rmdir(root).catch(() => {});
        if (error instanceof DomainError) throw error;
        return fail('PROJECT_WRITE_FAILED', '项目创建失败，已清理本次内部文件；额外文件保留', 500);
      }
    });
  }

  open(input: ProjectOpenRequest): Promise<ProjectSummary> {
    return this.store.serial('registry', async () => {
      const root = await this.canonical(input.rootPath);
      let manifest: ProjectManifest;
      try {
        manifest = await this.store.readManifest(root);
      } catch (error) {
        if (error instanceof DomainError) throw error;
        return fail('PROJECT_UNREADABLE', '无法读取项目清单，请选择有效的项目目录', 400);
      }
      if (!input.asCopy) await this.scriptDatabase.releaseTasks(manifest.id);
      return this.store.serial(manifest.id, async () => {
        const existing = this.database.db
          .select()
          .from(projects)
          .where(eq(projects.id, manifest.id))
          .get();
        const samePath = existing?.rootPath === root;
        if (input.asCopy && samePath)
          fail('PROJECT_ALREADY_REGISTERED', '不能将已登记的原目录作为副本，请先复制文件夹');
        if (
          existing &&
          !samePath &&
          !input.asCopy &&
          (await this.inspect(existing)).summary.status === 'available'
        )
          fail('PROJECT_ALREADY_REGISTERED', '该项目已在项目库中，可以作为副本打开');
        const copy = input.asCopy;
        const name = ProjectName.parse(
          input.name ?? (copy ? `${manifest.name} 副本` : manifest.name),
        );
        this.uniqueName(name, copy ? undefined : manifest.id);
        const collision = this.database.db
          .select()
          .from(projects)
          .where(eq(projects.rootPath, root))
          .get();
        if (collision && collision.id !== manifest.id)
          fail('PROJECT_PATH_CONFLICT', '此目录已登记为其他项目');
        manifest = await this.scriptDatabase.prepare(root, manifest, (value) =>
          this.store.writeManifest(root, value),
        );
        if (copy) {
          const original = manifest;
          const newId = randomUUID();
          await this.scriptDatabase.use(root, manifest.id, (db) =>
            db.prepare('UPDATE script_store_meta SET project_id=?').run(newId),
          );
          manifest = { ...manifest, id: newId, name, updatedAt: new Date().toISOString() };
          try {
            await this.store.writeManifest(root, manifest);
          } catch (error) {
            await this.scriptDatabase.use(root, newId, (db) =>
              db.prepare('UPDATE script_store_meta SET project_id=?').run(original.id),
            );
            throw error;
          }
        } else manifest = { ...manifest, name };
        if (!copy && input.name !== undefined) await this.store.writeManifest(root, manifest);
        const result = this.register(root, manifest);
        await this.projectMedia.restoreAt(manifest.id, root);
        return result;
      });
    });
  }

  async relocate(id: string, rootPath: string): Promise<ProjectSummary> {
    await this.scriptDatabase.releaseTasks(id);
    return this.store.serial('registry', () =>
      this.store.serial(id, async () => {
        this.row(id);
        const root = await this.canonical(rootPath);
        let manifest: ProjectManifest;
        try {
          manifest = await this.store.readManifest(root);
        } catch (error) {
          if (error instanceof DomainError) throw error;
          return fail('PROJECT_UNREADABLE', '无法读取所选项目清单', 400);
        }
        if (manifest.id !== id) fail('PROJECT_MISMATCH', '所选目录不是此项目');
        manifest = await this.scriptDatabase.prepare(root, manifest, (value) =>
          this.store.writeManifest(root, value),
        );
        this.uniqueName(manifest.name, id);
        const result = this.register(root, manifest);
        await this.projectMedia.restoreAt(id, root);
        return result;
      }),
    );
  }

  rename(id: string, inputName: string): Promise<ProjectManifest> {
    return this.store.serial('registry', () =>
      this.store.serial(id, async () => {
        const { row, manifest } = await this.available(id);
        const name = ProjectName.parse(inputName);
        this.uniqueName(name, id);
        manifest.name = name;
        manifest.updatedAt = new Date().toISOString();
        await this.store.writeManifest(row.rootPath, manifest);
        this.cache(manifest);
        return manifest;
      }),
    );
  }

  async release(id: string): Promise<{ saved: true }> {
    this.row(id);
    await this.scriptDatabase.releaseTasks(id);
    return { saved: true };
  }

  async remove(id: string): Promise<{ saved: true }> {
    await this.release(id);
    return this.store.serial('registry', () =>
      this.store.serial(id, () => {
        this.row(id);
        this.database.db.delete(projects).where(eq(projects.id, id)).run();
        return { saved: true };
      }),
    );
  }

  async manifest(id: string): Promise<ProjectManifest> {
    return this.store.serial(id, async () => {
      const { row, manifest } = await this.available(id);
      await this.projectMedia.restoreAt(id, row.rootPath);
      await this.projectMedia.cleanupAt(id, row.rootPath);
      return {
        ...manifest,
        episodes: await this.scriptDatabase.use(row.rootPath, id, episodeSummaries),
      };
    });
  }

  private page(manifest: ProjectManifest, pageId: string): ProjectPageSummary {
    ProjectPageId.parse(pageId);
    return (
      manifest.pages.find((page) => page.id === pageId) ??
      fail('PAGE_NOT_FOUND', '创作页不存在', 404)
    );
  }

  private async writeSummary(root: string, manifest: ProjectManifest): Promise<void> {
    await this.store.writeManifest(root, manifest);
    this.cache(manifest);
  }

  saveProfile(id: string, profile: ProjectProfile): Promise<ProjectManifest> {
    return this.store.serial(id, async () => {
      const { row, manifest } = await this.available(id);
      manifest.profile = ProjectProfile.parse(profile);
      manifest.updatedAt = new Date().toISOString();
      await this.writeSummary(row.rootPath, manifest);
      return manifest;
    });
  }

  private async validateEpisode(
    root: string,
    id: string,
    episodeId?: string | null,
  ): Promise<void> {
    if (episodeId) await this.scriptDatabase.use(root, id, (db) => episodeRow(db, episodeId));
  }

  createPage(id: string, input: ProjectPageCreateRequest): Promise<ProjectPageSummary> {
    return this.store.serial(id, async () => {
      const { row, manifest } = await this.available(id);
      const name = ProjectName.parse(input.name);
      await this.validateEpisode(row.rootPath, id, input.episodeId);
      this.uniquePage(manifest, name);
      const now = new Date().toISOString();
      const summary: ProjectPageSummary = {
        id: randomUUID(),
        name,
        createdAt: now,
        updatedAt: now,
        coverSha256: null,
        ...(input.episodeId !== undefined ? { episodeId: input.episodeId } : {}),
      };
      await this.store.writePage(row.rootPath, {
        format: 'frame-loom-page',
        formatVersion: 1,
        id: summary.id,
        revision: 1,
        document: emptyCanvasDocument(),
      });
      manifest.pages.push(summary);
      manifest.updatedAt = now;
      await this.writeSummary(row.rootPath, manifest);
      return summary;
    });
  }

  renamePage(
    id: string,
    pageId: string,
    input: ProjectPageRenameRequest,
  ): Promise<ProjectPageSummary> {
    return this.store.serial(id, async () => {
      const { row, manifest } = await this.available(id);
      const summary = this.page(manifest, pageId);
      await this.validateEpisode(row.rootPath, id, input.episodeId);
      if (input.name !== undefined) {
        const name = ProjectName.parse(input.name);
        this.uniquePage(manifest, name, pageId);
        summary.name = name;
      }
      if (input.episodeId !== undefined) summary.episodeId = input.episodeId;
      summary.updatedAt = new Date().toISOString();
      manifest.updatedAt = summary.updatedAt;
      await this.writeSummary(row.rootPath, manifest);
      return summary;
    });
  }

  deletePage(id: string, pageId: string): Promise<{ saved: true }> {
    return this.store.serial(id, async () => {
      const { row, manifest } = await this.available(id);
      this.page(manifest, pageId);
      const trashName = await this.store.trashPage(row.rootPath, pageId);
      manifest.pages = manifest.pages.filter((page) => page.id !== pageId);
      manifest.updatedAt = new Date().toISOString();
      try {
        await this.writeSummary(row.rootPath, manifest);
      } catch (error) {
        await this.store.restorePage(row.rootPath, pageId, trashName);
        throw error;
      }
      this.database.db
        .delete(pageViews)
        .where(and(eq(pageViews.projectId, id), eq(pageViews.pageId, pageId)))
        .run();
      await this.projectMedia.cleanupAt(id, row.rootPath);
      return { saved: true };
    });
  }

  private cover(page: ProjectPageFile): string | null {
    const versions = page.document.nodes
      .filter((node) => node.type === 'image')
      .flatMap((node) => CanvasMediaData.parse(node.data).versions);
    return (
      versions.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]?.sha256 ?? null
    );
  }

  private async repair(
    root: string,
    manifest: ProjectManifest,
    page: ProjectPageFile,
    savedAt?: string,
  ): Promise<void> {
    const summary = this.page(manifest, page.id);
    const info = await fs.stat(await internalPath(root, `pages/${page.id}.json`));
    const updatedAt = savedAt ?? info.mtime.toISOString();
    const cover = this.cover(page);
    if (summary.coverSha256 !== cover || Date.parse(updatedAt) > Date.parse(summary.updatedAt)) {
      summary.coverSha256 = cover;
      if (Date.parse(updatedAt) > Date.parse(summary.updatedAt)) summary.updatedAt = updatedAt;
      if (Date.parse(summary.updatedAt) > Date.parse(manifest.updatedAt))
        manifest.updatedAt = summary.updatedAt;
      await this.writeSummary(root, manifest);
    }
  }

  loadPage(id: string, pageId: string) {
    return this.store.serial(id, async () => {
      const { row, manifest } = await this.available(id);
      this.page(manifest, pageId);
      const page = await this.store.readPage(row.rootPath, pageId);
      await this.repair(row.rootPath, manifest, page);
      const view =
        this.database.db
          .select()
          .from(pageViews)
          .where(and(eq(pageViews.projectId, id), eq(pageViews.pageId, pageId)))
          .get()?.view ?? null;
      return { ...page, view };
    });
  }

  savePage(
    id: string,
    pageId: string,
    input: ProjectPageSaveRequest,
  ): Promise<{ revision: number; missing: string[] }> {
    return this.store.serial(id, async () => {
      const { row, manifest } = await this.available(id);
      this.page(manifest, pageId);
      const current = await this.store.readPage(row.rootPath, pageId, true);
      if (current.revision !== input.revision)
        fail('PAGE_REVISION_CONFLICT', '创作页已被修改，请重新加载或导出当前画布');
      const page = { ...current, document: input.document, revision: current.revision + 1 };
      const missing = await this.media.adoptAt(row.rootPath, [
        ...documentReferences(input.document).hashes,
      ]);
      const now = new Date().toISOString();
      await this.store.writePage(row.rootPath, page);
      await this.repair(row.rootPath, manifest, page, now);
      return { revision: page.revision, missing };
    });
  }

  saveView(id: string, pageId: string, view: CanvasView): Promise<{ saved: true }> {
    return this.store.serial(id, async () => {
      const { manifest } = await this.available(id);
      this.page(manifest, pageId);
      const updatedAt = new Date().toISOString();
      const parsed = CanvasView.parse(view);
      this.database.db
        .insert(pageViews)
        .values({ projectId: id, pageId, view: parsed, updatedAt })
        .onConflictDoUpdate({
          target: [pageViews.projectId, pageViews.pageId],
          set: { view: parsed, updatedAt },
        })
        .run();
      return { saved: true };
    });
  }
}

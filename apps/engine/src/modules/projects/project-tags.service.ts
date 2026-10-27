import { Injectable } from '@nestjs/common';
import {
  CanvasMediaData,
  ProjectId,
  ProjectTagCreateRequest,
  ProjectTagDeleteRequest,
  ProjectTagUpdateRequest,
  TagId,
  projectTags,
  type ProjectManifest,
  type ProjectTag,
  type ProjectTagUsage,
} from '@frame-loom/contracts';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../core/database/database.service.js';
import { DomainError } from '../../core/http/domain-error.js';
import { ProjectFilesService } from './project-files.service.js';
import { projects } from './projects.schema.js';

const fail = (code: string, message: string, status = 409): never => {
  throw new DomainError(code, status, message);
};

@Injectable()
export class ProjectTagsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly files: ProjectFilesService,
  ) {}

  private row(id: string) {
    ProjectId.parse(id);
    return (
      this.database.db.select().from(projects).where(eq(projects.id, id)).get() ??
      fail('PROJECT_NOT_FOUND', '项目不在项目库中', 404)
    );
  }

  private tag(manifest: ProjectManifest, id: string) {
    TagId.parse(id);
    return (
      projectTags(manifest).find((item) => item.id === id) ??
      fail('TAG_NOT_FOUND', '标签不存在', 404)
    );
  }

  private unique(tags: ProjectTag[], name: string, except?: string) {
    if (tags.some((tag) => tag.id !== except && tag.name.toLowerCase() === name.toLowerCase()))
      fail('TAG_NAME_CONFLICT', '项目中已存在同名标签');
  }

  private async load(id: string) {
    const row = this.row(id);
    const manifest = await this.files.store.readManifest(row.rootPath);
    if (manifest.id !== id) fail('PROJECT_UNAVAILABLE', '项目不可用，请检查目录或重新定位');
    return { row, manifest };
  }

  list(id: string) {
    return this.files.store.serial(id, async () => projectTags((await this.load(id)).manifest));
  }

  create(id: string, input: ProjectTagCreateRequest) {
    return this.files.store.serial(id, async () => {
      const { row, manifest } = await this.load(id);
      const request = ProjectTagCreateRequest.parse(input);
      const tags = projectTags(manifest);
      this.unique(tags, request.name);
      if (tags.length >= 50) fail('TAG_LIMIT_EXCEEDED', '每个项目最多有 50 个标签', 409);
      manifest.tags = [...tags, { id: randomUUID(), ...request, builtin: false }];
      manifest.updatedAt = new Date().toISOString();
      await this.files.store.writeManifest(row.rootPath, manifest);
      return manifest.tags;
    });
  }

  update(id: string, tagId: string, input: ProjectTagUpdateRequest) {
    return this.files.store.serial(id, async () => {
      const { row, manifest } = await this.load(id);
      const request = ProjectTagUpdateRequest.parse(input);
      const tags = [...projectTags(manifest)];
      const tag = this.tag(manifest, tagId);
      if (tag.builtin) fail('TAG_BUILTIN_READONLY', '内置标签不能编辑');
      const index = tags.findIndex((item) => item.id === tagId);
      if (request.name) this.unique(tags, request.name, tagId);
      tags[index] = { ...tag, ...request };
      manifest.tags = tags;
      manifest.updatedAt = new Date().toISOString();
      await this.files.store.writeManifest(row.rootPath, manifest);
      return tags;
    });
  }

  private async usages(
    root: string,
    manifest: ProjectManifest,
    tagId: string,
  ): Promise<ProjectTagUsage[]> {
    const result: ProjectTagUsage[] = [];
    for (const page of manifest.pages) {
      const file = await this.files.store.readPage(root, page.id);
      for (const node of file.document.nodes) {
        if (node.tagId !== tagId) continue;
        const versions =
          node.type === 'image' || node.type === 'video'
            ? CanvasMediaData.parse(node.data).versions
            : [];
        const activeVersion =
          node.type === 'image' || node.type === 'video'
            ? CanvasMediaData.parse(node.data).activeVersion
            : -1;
        result.push({
          pageId: page.id,
          pageName: page.name,
          nodeId: node.id,
          nodeType: node.type,
          title: node.title ?? '',
          locked: node.locked ?? false,
          thumbnailSha256: versions[activeVersion]?.sha256 ?? null,
        });
      }
    }
    return result;
  }

  findUsages(id: string, tagId: string) {
    return this.files.store.serial(id, async () => {
      const { row, manifest } = await this.load(id);
      this.tag(manifest, tagId);
      return this.usages(row.rootPath, manifest, tagId);
    });
  }

  remove(id: string, tagId: string, input: ProjectTagDeleteRequest) {
    return this.files.store.serial(id, async () => {
      const { row, manifest } = await this.load(id);
      this.tag(manifest, tagId);
      const request = ProjectTagDeleteRequest.parse(input);
      const tags = projectTags(manifest);
      const targets = new Set<string>();
      for (const change of request.reassign) {
        if (targets.has(`${change.pageId}/${change.nodeId}`))
          fail('INVALID_TAG_REASSIGN', '改派列表中存在重复节点', 400);
        targets.add(`${change.pageId}/${change.nodeId}`);
        if (change.tagId !== null) {
          if (change.tagId === tagId) fail('INVALID_TAG_REASSIGN', '不能改派到正在删除的标签', 400);
          if (!tags.some((tag) => tag.id === change.tagId))
            fail('TAG_NOT_FOUND', '改派目标标签不存在', 400);
        }
      }
      const byPage = new Map<string, Map<string, string | null>>();
      for (const change of request.reassign) {
        const nodes = byPage.get(change.pageId) ?? new Map<string, string | null>();
        nodes.set(change.nodeId, change.tagId);
        byPage.set(change.pageId, nodes);
      }
      for (const [pageId, nodeChanges] of byPage) {
        const page = await this.files.store.readPage(row.rootPath, pageId);
        let changed = false;
        const nodes = page.document.nodes.map((node) => {
          const replacement = nodeChanges.get(node.id);
          if (node.tagId !== tagId || replacement === undefined) return node;
          changed = true;
          const updated = { ...node };
          if (replacement === null) delete updated.tagId;
          else updated.tagId = replacement;
          return updated;
        });
        if (!changed) continue;
        const document = { ...page.document, nodes };
        const revision = page.revision + 1;
        await this.files.store.writePage(row.rootPath, { ...page, document, revision });
        const summary = manifest.pages.find((item) => item.id === pageId)!;
        summary.updatedAt = new Date().toISOString();
        const images = nodes
          .filter((node) => node.type === 'image')
          .flatMap((node) => CanvasMediaData.parse(node.data).versions);
        summary.coverSha256 =
          images.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]?.sha256 ??
          null;
        if (summary.updatedAt > manifest.updatedAt) manifest.updatedAt = summary.updatedAt;
      }
      const remaining = await this.usages(row.rootPath, manifest, tagId);
      if (remaining.length) {
        try {
          await this.files.store.writeManifest(row.rootPath, manifest);
        } catch {
          // 页面改派已落盘，清单摘要允许由后续页面读取修复。
        }
        throw new DomainError('TAG_IN_USE', 409, '仍有创作页引用此标签', { usages: remaining });
      }
      manifest.tags = tags.filter((tag) => tag.id !== tagId);
      manifest.updatedAt = new Date().toISOString();
      await this.files.store.writeManifest(row.rootPath, manifest);
      return manifest.tags;
    });
  }
}

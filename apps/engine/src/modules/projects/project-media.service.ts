import { Injectable } from '@nestjs/common';
import { CanvasMediaData, Sha256, type CanvasDocument } from '@frame-loom/contracts';
import { eq } from 'drizzle-orm';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { EngineConfig } from '../../core/config/config.js';
import { DatabaseService } from '../../core/database/database.service.js';
import { generationJobs, type JobRow } from '../generation/generation.schema.js';
import { MediaService } from '../generation/media.service.js';
import { ProjectFilesService } from './project-files.service.js';
import { errorCode, internalPath } from './local-project-store.js';
import { projects } from './projects.schema.js';

export function documentReferences(document: CanvasDocument) {
  const hashes = new Set<string>();
  const jobs = new Set<string>();
  for (const node of document.nodes) {
    if (!['image', 'video', 'audio'].includes(node.type)) continue;
    const data = CanvasMediaData.parse(node.data);
    for (const version of data.versions) {
      hashes.add(version.sha256);
      if (version.posterSha256) hashes.add(version.posterSha256);
    }
    for (const reference of data.mediaReferences ?? []) hashes.add(reference.media.sha256);
    if (data.imageEdit) {
      hashes.add(data.imageEdit.source.sha256);
      if (data.imageEdit.operation === 'emotion' && data.imageEdit.artifacts)
        for (const hash of Object.values(data.imageEdit.artifacts)) if (hash) hashes.add(hash);
    }
    for (const id of data.pendingJobIds ?? []) jobs.add(id);
    if (data.pendingJobId) jobs.add(data.pendingJobId);
  }
  return { hashes, jobs };
}

export function unfinished(job: JobRow) {
  return !['succeeded', 'failed', 'cancelled'].includes(job.status);
}
function jobHashes(job: JobRow) {
  return [
    ...job.request.inputs.flatMap((input) => (input.sha256 ? [input.sha256] : [])),
    ...(job.request.imageEdit ? [job.request.imageEdit.source.sha256] : []),
    ...(job.request.imageEdit?.operation === 'emotion' && job.request.imageEdit.artifacts
      ? Object.values(job.request.imageEdit.artifacts).filter((hash): hash is string => !!hash)
      : []),
    ...(job.snapshot?.imageEditPostProcess
      ? [
          job.snapshot.imageEditPostProcess.intermediateSha256,
          job.snapshot.imageEditPostProcess.finalSha256,
        ].filter((hash): hash is string => !!hash)
      : []),
    ...job.outputs,
  ];
}

@Injectable()
export class ProjectMediaService {
  // shortcut: 单窗口每项目仅一个画布会话, 支持多窗口时改用会话标识。
  private readonly sessions = new Set<string>();
  now = () => Date.now();
  constructor(
    private readonly files: ProjectFilesService,
    private readonly media: MediaService,
    private readonly database: DatabaseService,
    private readonly config: EngineConfig,
  ) {}

  async references(id: string, root: string) {
    const manifest = await this.files.store.readManifest(root);
    const hashes = new Set<string>();
    const pending = new Set<string>();
    // 页面损坏时直接终止，不能将读取失败当成没有引用。
    for (const summary of manifest.pages) {
      const refs = documentReferences((await this.files.store.readPage(root, summary.id)).document);
      for (const hash of refs.hashes) hashes.add(hash);
      for (const job of refs.jobs) pending.add(job);
    }
    for (const job of this.database.db.select().from(generationJobs).all())
      if ((job.projectId === id && unfinished(job)) || pending.has(job.id))
        for (const hash of jobHashes(job)) hashes.add(hash);
    return hashes;
  }

  async restoreAt(id: string, root: string) {
    const jobs = this.database.db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.projectId, id))
      .all();
    for (const job of jobs) {
      const missing = await this.media.adoptAt(root, job.stagedOutputs);
      if (missing.length !== job.stagedOutputs.length)
        this.database.db
          .update(generationJobs)
          .set({ stagedOutputs: missing })
          .where(eq(generationJobs.id, job.id))
          .run();
    }
  }

  async cleanupAt(id: string, root: string, manual = false, dryRun = false) {
    const result = { files: 0, bytes: 0, skipped: this.sessions.has(id) };
    if (result.skipped) return result;
    const referenced = await this.references(id, root);
    const now = this.now();
    for (const [directory, age] of [
      ['media', 0],
      ['trash/media', 30 * 86400_000],
      ['trash/pages', 30 * 86400_000],
      ['trash/scripts', 30 * 86400_000],
      ['tmp', 3600_000],
    ] as const) {
      const folder = await internalPath(root, directory);
      const entries = await fs.readdir(folder, { withFileTypes: true }).catch((error: unknown) => {
        if (errorCode(error) === 'ENOENT') return [];
        throw error;
      });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const path = await internalPath(root, `${directory}/${entry.name}`);
        const info = await fs.stat(path);
        const hash = entry.name.split('.')[0];
        if ((directory === 'media' || directory === 'trash/media') && referenced.has(hash)) {
          if (!dryRun && directory === 'trash/media') await this.media.resolveAt(hash, root);
          continue;
        }
        if (
          directory !== 'media' &&
          !(manual && directory === 'trash/media') &&
          now - info.mtimeMs < age
        )
          continue;
        result.files++;
        result.bytes += info.size;
        if (dryRun) continue;
        if (directory === 'media' && !manual) {
          const target = await internalPath(root, `trash/media/${entry.name}`);
          await fs.rename(path, target);
          await fs.utimes(target, new Date(now), new Date(now));
        } else await fs.rm(path);
      }
    }
    return result;
  }

  cleanup(id: string, dryRun: boolean) {
    return this.files.store.serial(id, async () =>
      this.cleanupAt(id, await this.files.root(id), true, dryRun),
    );
  }
  session(id: string, open: boolean) {
    return this.files.store.serial(id, async () => {
      const root = await this.files.root(id);
      if (open) this.sessions.add(id);
      else {
        this.sessions.delete(id);
        await this.cleanupAt(id, root);
      }
      return { saved: true as const };
    });
  }

  async initialize() {
    const keep = new Set<string>();
    const jobs = this.database.db.select().from(generationJobs).all();
    for (const job of jobs) if (unfinished(job)) for (const hash of jobHashes(job)) keep.add(hash);
    for (const row of this.database.db.select().from(projects).all()) {
      let root: string;
      try {
        root = await this.files.root(row.id);
      } catch {
        for (const job of jobs)
          if (job.projectId === row.id) for (const hash of jobHashes(job)) keep.add(hash);
        continue;
      }
      try {
        await this.files.store.serial(row.id, async () => {
          await this.restoreAt(row.id, root);
          // 尚未写回页面的 pendingJobIds 仍保护全局输入与产物。
          for (const hash of await this.references(row.id, root))
            if (
              !(await this.media.find(await internalPath(root, 'media'), hash)) &&
              !(await this.media.find(await internalPath(root, 'trash/media'), hash))
            )
              keep.add(hash);
        });
      } catch {
        // 无法完整读取引用时，本轮全局清理宁可跳过。
        return;
      }
    }
    // 已从库移除的项目仍可能有离线产物，任务记录继续承担暂存归属。
    for (const job of this.database.db.select().from(generationJobs).all())
      for (const hash of job.stagedOutputs) keep.add(hash);
    const directory = join(this.config.dataDir, 'media');
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const hash = entry.name.split('.')[0];
      if (!keep.has(hash) && (Sha256.safeParse(hash).success || entry.name.startsWith('.partial-')))
        await fs.rm(join(directory, entry.name));
    }
  }
}

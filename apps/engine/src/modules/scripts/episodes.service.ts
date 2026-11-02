import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  EpisodeCreateRequest,
  EpisodeUpdateRequest,
  ConversionState,
  type ScriptSaveRequest,
} from '@frame-loom/contracts';
import { DomainError } from '../../core/http/domain-error.js';
import { ProjectStore } from '../projects/project-store.js';
import { ProjectFilesService } from '../projects/project-files.service.js';
import { ProjectScriptDatabase } from '../projects/project-script-database.js';
import {
  episodeRow,
  episodeSummaries,
  readDocument,
  readElements,
  occurrences,
  saveDocument,
} from './script-repository.js';

@Injectable()
export class EpisodesService {
  readonly conversions = new Map<string, ConversionState>();
  constructor(
    readonly store: ProjectStore,
    private readonly files: ProjectFilesService,
    readonly database: ProjectScriptDatabase,
  ) {}
  conversion(projectId: string, episodeId: string) {
    return this.conversions.get(`${projectId}:${episodeId}`) ?? null;
  }
  assertIdle(projectId: string, episodeId: string) {
    const status = this.conversion(projectId, episodeId)?.status;
    if (status === 'queued' || status === 'running')
      throw new DomainError('SCRIPT_CONVERTING', 409, '剧本正在解析，请先取消任务');
  }
  async context(projectId: string, episodeId?: string) {
    const root = await this.files.root(projectId);
    const raw = await this.store.readManifest(root);
    const manifest = await this.database.prepare(root, raw, (value) =>
      this.store.writeManifest(root, value),
    );
    const episode = episodeId
      ? await this.database.use(root, projectId, (db) => episodeRow(db, episodeId))
      : undefined;
    return { root, manifest, episode };
  }
  list(projectId: string) {
    return this.store.serial(projectId, async () => {
      const { root } = await this.context(projectId);
      return this.database.use(root, projectId, (db) =>
        episodeSummaries(db).map((episode) => ({
          ...episode,
          conversion: this.conversion(projectId, episode.id),
          pending: readElements(db).filter(
            (e) =>
              e.status === 'pending' && occurrences(db, e).some((o) => o.episodeId === episode.id),
          ).length,
        })),
      );
    });
  }
  create(projectId: string, input: EpisodeCreateRequest) {
    return this.store.serial(projectId, async () => {
      const parsed = EpisodeCreateRequest.parse(input);
      const { root } = await this.context(projectId);
      return this.database.use(root, projectId, (db) =>
        db.transaction(() => {
          const episodes = episodeSummaries(db);
          if (episodes.length >= 500)
            throw new DomainError('EPISODE_LIMIT_EXCEEDED', 409, '最多支持500集');
          if (episodes.some((e) => e.number === parsed.number))
            throw new DomainError('EPISODE_NUMBER_CONFLICT', 409, '集号已存在');
          const id = randomUUID();
          const now = new Date().toISOString();
          db.prepare(
            'INSERT INTO episodes(id,number,title,duration_sec,created_at,updated_at) VALUES (?,?,?,?,?,?)',
          ).run(id, parsed.number, parsed.title, parsed.duration_sec, now, now);
          return episodeSummaries(db).find((e) => e.id === id)!;
        })(),
      );
    });
  }
  update(projectId: string, episodeId: string, input: EpisodeUpdateRequest) {
    return this.store.serial(projectId, async () => {
      this.assertIdle(projectId, episodeId);
      const patch = EpisodeUpdateRequest.parse(input);
      const { root } = await this.context(projectId, episodeId);
      return this.database.use(root, projectId, (db) =>
        db.transaction(() => {
          const row = episodeRow(db, episodeId);
          const next = { ...row, ...patch };
          if (episodeSummaries(db).some((e) => e.id !== episodeId && e.number === next.number))
            throw new DomainError('EPISODE_NUMBER_CONFLICT', 409, '集号已存在');
          db.prepare(
            'UPDATE episodes SET number=?,title=?,duration_sec=?,updated_at=? WHERE id=?',
          ).run(next.number, next.title, next.duration_sec, new Date().toISOString(), episodeId);
          return episodeSummaries(db).find((e) => e.id === episodeId)!;
        })(),
      );
    });
  }
  delete(projectId: string, episodeId: string) {
    return this.store.serial(projectId, async () => {
      this.assertIdle(projectId, episodeId);
      const { root, manifest } = await this.context(projectId, episodeId);
      // 先解除清单归属；失败时活动剧集仍在，重试不会留下悬空归属。
      for (const page of manifest.pages) if (page.episodeId === episodeId) page.episodeId = null;
      await this.store.writeManifest(root, manifest);
      await this.database.use(root, projectId, (db) =>
        db.transaction(() => {
          db.prepare('UPDATE episodes SET deleted_at=? WHERE id=?').run(
            new Date().toISOString(),
            episodeId,
          );
          db.prepare('DELETE FROM episodes WHERE deleted_at IS NOT NULL AND deleted_at<?').run(
            new Date(Date.now() - 30 * 86400_000).toISOString(),
          );
        })(),
      );
      return { saved: true };
    });
  }
  read(projectId: string, episodeId: string) {
    return this.store.serial(projectId, async () => {
      const { root, manifest, episode } = await this.context(projectId, episodeId);
      return this.database.use(root, projectId, (db) => {
        const task = z
          .object({ state: z.string(), source: z.string() })
          .optional()
          .parse(
            db
              .prepare(
                'SELECT state,source FROM script_imports WHERE episode_id=? ORDER BY created_at DESC LIMIT 1',
              )
              .get(episodeId),
          );
        let conversion = this.conversion(projectId, episodeId);
        if (!conversion && task) {
          conversion = ConversionState.parse(JSON.parse(task.state));
          if (conversion.status === 'queued' || conversion.status === 'running') {
            conversion = {
              ...conversion,
              status: 'failed',
              stage: null,
              error: '上次解析已中断，可主动重试；不会自动调用模型',
            };
            db.prepare('UPDATE script_imports SET state=? WHERE episode_id=? AND applied=0').run(
              JSON.stringify(conversion),
              episodeId,
            );
          }
        }
        return {
          id: episodeId,
          revision: episode!.revision,
          document: readDocument(db, manifest, episodeId),
          source: task?.source ?? null,
          conversion,
        };
      });
    });
  }
  save(projectId: string, episodeId: string, input: ScriptSaveRequest) {
    return this.store.serial(projectId, async () => {
      this.assertIdle(projectId, episodeId);
      const { root } = await this.context(projectId, episodeId);
      return this.database.use(root, projectId, (db) =>
        db.transaction(() => saveDocument(db, episodeId, input.revision, input.document))(),
      );
    });
  }
}

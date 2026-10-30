import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import {
  EpisodeCreateRequest,
  EpisodeUpdateRequest,
  ScriptDocument,
  deriveScenes,
  type ProjectManifest,
  type ScriptFile,
  type ScriptSaveRequest,
  type ConversionState,
} from '@frame-loom/contracts';
import { DomainError } from '../../core/http/domain-error.js';
import { ProjectStore } from '../projects/project-store.js';
import { ProjectFilesService } from '../projects/project-files.service.js';
import { internalPath } from '../projects/local-project-store.js';
import { StoryService } from './story.service.js';

@Injectable()
export class EpisodesService {
  readonly conversions = new Map<string, ConversionState>();
  conversion(projectId: string, episodeId: string) {
    return this.conversions.get(`${projectId}:${episodeId}`) ?? null;
  }
  assertIdle(projectId: string, episodeId: string) {
    const status = this.conversion(projectId, episodeId)?.status;
    if (status === 'queued' || status === 'running')
      throw new DomainError('SCRIPT_CONVERTING', 409, '剧本正在转换');
  }
  constructor(
    readonly store: ProjectStore,
    private readonly files: ProjectFilesService,
    private readonly story: StoryService,
  ) {}

  async context(projectId: string, episodeId?: string) {
    const root = await this.files.root(projectId);
    const manifest = await this.store.readManifest(root);
    const episode = manifest.episodes?.find((episode) => episode.id === episodeId);
    if (episodeId && !episode) throw new DomainError('EPISODE_NOT_FOUND', 404, '剧集不存在');
    return { root, manifest, episode };
  }

  list(projectId: string) {
    return this.store.serial(projectId, async () => {
      const { root, manifest } = await this.context(projectId);
      return Promise.all(
        [...(manifest.episodes ?? [])]
          .sort((a, b) => a.number - b.number)
          .map(async (episode) => ({
            ...episode,
            conversion: this.conversion(projectId, episode.id),
            pending: await this.story.pending(root, manifest, episode.id),
          })),
      );
    });
  }

  create(projectId: string, input: EpisodeCreateRequest) {
    return this.store.serial(projectId, async () => {
      const parsed = EpisodeCreateRequest.parse(input);
      const { root, manifest } = await this.context(projectId);
      const episodes = manifest.episodes ?? [];
      if (episodes.length >= 500)
        throw new DomainError('EPISODE_LIMIT_EXCEEDED', 409, '最多支持 500 集');
      if (episodes.some((episode) => episode.number === parsed.number))
        throw new DomainError('EPISODE_NUMBER_CONFLICT', 409, '集号已存在');
      const now = new Date().toISOString();
      const episode = {
        id: randomUUID(),
        ...parsed,
        createdAt: now,
        updatedAt: now,
        scenes: 0,
        chars: 0,
        draft: false,
      };
      await this.store.writeScript(root, {
        format: 'frame-loom-script',
        formatVersion: 1,
        id: episode.id,
        revision: 1,
        source: null,
        pendingImport: null,
        convertedAt: null,
        document: { schemaVersion: 2, preface: '', appendix: '', blocks: [] },
      });
      manifest.episodes = [...episodes, episode];
      manifest.updatedAt = now;
      try {
        await this.store.writeManifest(root, manifest);
      } catch (error) {
        await this.store.trashScript(root, episode.id);
        throw error;
      }
      return episode;
    });
  }

  update(projectId: string, episodeId: string, input: EpisodeUpdateRequest) {
    return this.store.serial(projectId, async () => {
      const parsed = EpisodeUpdateRequest.parse(input);
      const { root, manifest, episode } = await this.context(projectId, episodeId);
      if (manifest.episodes?.some((item) => item.id !== episodeId && item.number === parsed.number))
        throw new DomainError('EPISODE_NUMBER_CONFLICT', 409, '集号已存在');
      Object.assign(episode!, parsed, { updatedAt: new Date().toISOString() });
      manifest.updatedAt = episode!.updatedAt;
      await this.store.writeManifest(root, manifest);
      return episode!;
    });
  }

  delete(projectId: string, episodeId: string) {
    return this.store.serial(projectId, async () => {
      this.assertIdle(projectId, episodeId);
      const { root, manifest } = await this.context(projectId, episodeId);
      const trash = await this.store.trashScript(root, episodeId);
      manifest.episodes = manifest.episodes!.filter((episode) => episode.id !== episodeId);
      for (const page of manifest.pages) if (page.episodeId === episodeId) page.episodeId = null;
      manifest.updatedAt = new Date().toISOString();
      try {
        await this.store.writeManifest(root, manifest);
      } catch (error) {
        await this.store.restoreScript(root, episodeId, trash);
        throw error;
      }
      return { saved: true };
    });
  }

  async repair(root: string, manifest: ProjectManifest, file: ScriptFile, savedAt?: string) {
    const episode = manifest.episodes!.find((episode) => episode.id === file.id)!;
    const scenes = deriveScenes(file.document.blocks, episode.number).length;
    const chars = file.document.blocks.reduce(
      (total, block) => total + block.text.replace(/\s/gu, '').length,
      0,
    );
    const draft = file.pendingImport !== null;
    const updatedAt =
      savedAt ??
      (await fs.stat(await internalPath(root, `scripts/${file.id}.json`))).mtime.toISOString();
    if (
      scenes === episode.scenes &&
      chars === episode.chars &&
      draft === episode.draft &&
      updatedAt <= episode.updatedAt
    )
      return;
    Object.assign(episode, {
      scenes,
      chars,
      draft,
      updatedAt: updatedAt > episode.updatedAt ? updatedAt : episode.updatedAt,
    });
    if (manifest.updatedAt < episode.updatedAt) manifest.updatedAt = episode.updatedAt;
    await this.store.writeManifest(root, manifest);
  }

  read(projectId: string, episodeId: string) {
    return this.store.serial(projectId, async () => {
      const { root, manifest } = await this.context(projectId, episodeId);
      const file = await this.store.readScript(root, episodeId);
      await this.repair(root, manifest, file);
      return { ...file, conversion: this.conversion(projectId, episodeId) };
    });
  }

  save(projectId: string, episodeId: string, input: ScriptSaveRequest) {
    return this.store.serial(projectId, async () => {
      this.assertIdle(projectId, episodeId);
      const document = ScriptDocument.parse(input.document);
      const { root, manifest } = await this.context(projectId, episodeId);
      const current = await this.store.readScript(root, episodeId, true);
      if (current.revision !== input.revision)
        throw new DomainError(
          'SCRIPT_REVISION_CONFLICT',
          409,
          '剧本已被修改，请重新加载或复制全文',
        );
      const file = { ...current, document, revision: current.revision + 1 };
      await this.store.writeScript(root, file);
      this.story.invalidate(projectId, episodeId);
      await this.repair(root, manifest, file, new Date().toISOString());
      return {
        revision: file.revision,
        addedElements: await this.story.sync(projectId, document.blocks),
      };
    });
  }
}

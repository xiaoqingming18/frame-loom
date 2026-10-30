import { Injectable } from '@nestjs/common';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  ElementName,
  StoryFile,
  StoryElementCreateRequest,
  StoryElementUpdateRequest,
  findMentions,
  syncCandidates,
  type ElementKind,
  type ProjectManifest,
  type ScriptBlock,
  type StoryElement,
  type StoryOccurrencesResult,
  type RosterEntry,
} from '@frame-loom/contracts';
import { DomainError } from '../../core/http/domain-error.js';
import { ProjectFilesService } from '../projects/project-files.service.js';
import { internalPath } from '../projects/local-project-store.js';

type Occurrence = StoryOccurrencesResult[number] & { elementId: string };
const key = (kind: ElementKind, name: string) => `${kind}:${name.toLowerCase()}`;

@Injectable()
export class StoryService {
  private readonly cache = new Map<
    string,
    {
      stamp: string;
      revision: number;
      storyRevision: number;
      occurrences: Occurrence[];
      surrounding: Set<string>;
    }
  >();
  constructor(private readonly files: ProjectFilesService) {}

  invalidate(projectId: string, episodeId: string) {
    this.cache.delete(`${projectId}:${episodeId}`);
  }

  private element(story: StoryFile, id: string) {
    const element = story.elements.find((item) => item.id === id);
    if (!element) throw new DomainError('ELEMENT_NOT_FOUND', 404, '元素不存在');
    return element;
  }

  private unique(
    story: StoryFile,
    candidate: Pick<StoryElement, 'kind' | 'name' | 'aliases'>,
    except?: string,
  ) {
    const names = [candidate.name, ...candidate.aliases].map((name) => name.toLowerCase());
    if (
      new Set(names).size !== names.length ||
      story.elements.some(
        (element) =>
          element.id !== except &&
          element.kind === candidate.kind &&
          [element.name, ...element.aliases].some((name) => names.includes(name.toLowerCase())),
      )
    )
      throw new DomainError('ELEMENT_NAME_CONFLICT', 409, '同类元素名称或别名已存在');
  }

  private async write(root: string, story: StoryFile) {
    story.revision++;
    await this.files.store.writeStory(root, StoryFile.parse(story));
  }

  private async mutate<T>(
    projectId: string,
    action: (story: StoryFile, root: string) => Promise<T> | T,
  ): Promise<T> {
    return this.files.store.serial(projectId, async () => {
      const root = await this.files.root(projectId);
      const story = await this.files.store.readStory(root);
      const result = await action(story, root);
      await this.write(root, story);
      return result;
    });
  }

  create(projectId: string, input: StoryElementCreateRequest) {
    return this.mutate(projectId, (story) => {
      const parsed = StoryElementCreateRequest.parse(input);
      this.unique(story, { ...parsed, aliases: [] });
      const now = new Date().toISOString();
      const element: StoryElement = {
        id: randomUUID(),
        ...parsed,
        aliases: [],
        status: 'confirmed',
        description: '',
        attrs: {},
        createdAt: now,
        updatedAt: now,
      };
      story.elements.push(element);
      return element;
    });
  }

  update(projectId: string, id: string, input: StoryElementUpdateRequest) {
    return this.mutate(projectId, (story) => {
      const element = this.element(story, id);
      const updated = {
        ...element,
        ...StoryElementUpdateRequest.parse(input),
        updatedAt: new Date().toISOString(),
      };
      this.unique(story, updated, id);
      Object.assign(element, updated);
      return element;
    });
  }

  merge(projectId: string, id: string, into: string) {
    return this.mutate(projectId, (story) => {
      const source = this.element(story, id);
      const target = this.element(story, into);
      if (source.kind !== target.kind)
        throw new DomainError('ELEMENT_KIND_MISMATCH', 422, '只能合并同类元素');
      if (id === into) throw new DomainError('ELEMENT_MERGE_SELF', 422, '不能合并到自身');
      target.aliases = [...target.aliases, source.name, ...source.aliases];
      target.updatedAt = new Date().toISOString();
      story.elements = story.elements.filter((element) => element.id !== id);
      for (const element of story.elements) {
        if (element.suggestedMergeInto === id) element.suggestedMergeInto = into;
        if (element.suggestedMergeInto === element.id) delete element.suggestedMergeInto;
      }
      return target;
    });
  }

  private ignore(story: StoryFile, id: string) {
    const element = this.element(story, id);
    const ignored = new Set(story.ignored.map((item) => key(item.kind, item.name)));
    for (const name of [element.name, ...element.aliases])
      if (!ignored.has(key(element.kind, name))) {
        story.ignored.push({ kind: element.kind, name });
        ignored.add(key(element.kind, name));
      }
    story.elements = story.elements.filter((item) => item.id !== id);
    for (const item of story.elements)
      if (item.suggestedMergeInto === id) delete item.suggestedMergeInto;
  }

  remove(projectId: string, id: string) {
    return this.mutate(projectId, (story) => {
      this.ignore(story, id);
      return { saved: true };
    });
  }

  batch(projectId: string, ids: string[], action: 'confirm' | 'ignore') {
    return this.mutate(projectId, (story) => {
      for (const id of new Set(ids)) {
        const element = story.elements.find((item) => item.id === id);
        if (!element) continue;
        if (action === 'ignore') this.ignore(story, id);
        else {
          element.status = 'confirmed';
          element.updatedAt = new Date().toISOString();
        }
      }
      return { saved: true };
    });
  }

  restore(projectId: string, kind: ElementKind, name: string) {
    return this.mutate(projectId, async (story, root) => {
      story.ignored = story.ignored.filter((item) => key(item.kind, item.name) !== key(kind, name));
      const manifest = await this.files.store.readManifest(root);
      for (const episode of manifest.episodes ?? [])
        this.syncInto(story, (await this.files.store.readScript(root, episode.id)).document.blocks);
      return { saved: true };
    });
  }

  syncInto(story: StoryFile, blocks: ScriptBlock[]): number {
    const known = new Set(
      story.elements.flatMap((element) =>
        [element.name, ...element.aliases].map((name) => key(element.kind, name)),
      ),
    );
    for (const item of story.ignored) known.add(key(item.kind, item.name));
    let added = 0;
    for (const candidate of syncCandidates(blocks)) {
      const name = ElementName.safeParse(candidate.name);
      if (!name.success || known.has(key(candidate.kind, name.data))) continue;
      const now = new Date().toISOString();
      story.elements.push({
        id: randomUUID(),
        kind: candidate.kind,
        name: name.data,
        aliases: [],
        status: 'pending',
        description: '',
        attrs: {},
        createdAt: now,
        updatedAt: now,
      });
      known.add(key(candidate.kind, name.data));
      added++;
    }
    return added;
  }

  addRoster(story: StoryFile, roster: RosterEntry[]) {
    let added = 0;
    for (const entry of roster) {
      if (story.ignored.some((item) => key(item.kind, item.name) === key('character', entry.name)))
        continue;
      const existing = story.elements.find(
        (element) =>
          element.kind === 'character' &&
          [element.name, ...element.aliases].some(
            (name) => name.toLowerCase() === entry.name.toLowerCase(),
          ),
      );
      if (existing) {
        if (!existing.description && entry.description) {
          existing.description = entry.description;
          existing.updatedAt = new Date().toISOString();
        }
        continue;
      }
      const now = new Date().toISOString();
      story.elements.push({
        id: randomUUID(),
        kind: 'character',
        ...entry,
        aliases: [],
        attrs: {},
        createdAt: now,
        updatedAt: now,
      });
      added++;
    }
    return added;
  }

  // 调用者已经持有项目串行队列；读取全部剧集后才删除，避免跨集误删。
  async pruneOrphans(projectId: string) {
    const root = await this.files.root(projectId);
    const manifest = await this.files.store.readManifest(root);
    const story = await this.files.store.readStory(root);
    const used = new Set<string>();
    for (const episode of manifest.episodes ?? []) {
      for (const occurrence of await this.occurrences(root, manifest, story, episode.id))
        used.add(occurrence.elementId);
      for (const id of this.cache.get(`${projectId}:${episode.id}`)!.surrounding) used.add(id);
    }
    const removed = new Set(
      story.elements
        .filter((element) => element.status === 'pending' && !used.has(element.id))
        .map((element) => element.id),
    );
    if (!removed.size) return;
    story.elements = story.elements.filter((element) => !removed.has(element.id));
    for (const element of story.elements)
      if (element.suggestedMergeInto && removed.has(element.suggestedMergeInto))
        delete element.suggestedMergeInto;
    await this.write(root, story);
  }

  // 调用者已经持有项目串行队列，避免嵌套 serial 导致死锁。
  async sync(projectId: string, blocks: ScriptBlock[]) {
    const root = await this.files.root(projectId);
    const story = await this.files.store.readStory(root);
    const added = this.syncInto(story, blocks);
    if (added) await this.write(root, story);
    return added;
  }

  private async occurrences(
    root: string,
    manifest: ProjectManifest,
    story: StoryFile,
    episodeId: string,
  ): Promise<Occurrence[]> {
    const cacheId = `${manifest.id}:${episodeId}`;
    const info = await fs.stat(await internalPath(root, `scripts/${episodeId}.json`), {
      bigint: true,
    });
    const stamp = `${info.mtimeNs}:${info.size}`;
    const cached = this.cache.get(cacheId);
    if (cached?.stamp === stamp && cached.storyRevision === story.revision)
      return cached.occurrences;
    const file = await this.files.store.readScript(root, episodeId);
    const terms = story.elements.flatMap((element) =>
      [element.name, ...element.aliases].map((name) => ({
        elementId: element.id,
        kind: element.kind,
        name,
      })),
    );
    const occurrences: Occurrence[] = [];
    let sceneId: string | null = null;
    for (const block of file.document.blocks) {
      if (block.type === 'act') sceneId = null;
      if (block.type === 'scene') sceneId = block.id;
      if (block.type === 'note') continue;
      for (const mention of findMentions(block.text, terms, block.type))
        occurrences.push({
          elementId: mention.elementId,
          episodeId,
          blockId: block.id,
          sceneId,
          excerpt: block.text.slice(0, 80),
        });
    }
    this.cache.set(cacheId, {
      stamp,
      revision: file.revision,
      storyRevision: story.revision,
      occurrences,
      surrounding: new Set(
        story.elements
          .filter((element) =>
            [element.name, ...element.aliases].some((name) =>
              `${file.document.preface}\n${file.document.appendix}`
                .toLowerCase()
                .includes(name.toLowerCase()),
            ),
          )
          .map((element) => element.id),
      ),
    });
    return occurrences;
  }

  async pending(root: string, manifest: ProjectManifest, episodeId: string): Promise<number> {
    const story = await this.files.store.readStory(root);
    const ids = new Set(
      (await this.occurrences(root, manifest, story, episodeId)).map((item) => item.elementId),
    );
    return story.elements.filter((element) => element.status === 'pending' && ids.has(element.id))
      .length;
  }

  list(projectId: string) {
    return this.files.store.serial(projectId, async () => {
      const root = await this.files.root(projectId);
      const manifest = await this.files.store.readManifest(root);
      const story = await this.files.store.readStory(root);
      const all = (
        await Promise.all(
          (manifest.episodes ?? []).map((episode) =>
            this.occurrences(root, manifest, story, episode.id),
          ),
        )
      ).flat();
      return {
        revision: story.revision,
        ignored: story.ignored,
        elements: story.elements.map((element) => {
          const mentions = all.filter((item) => item.elementId === element.id);
          return {
            ...element,
            mentions: mentions.length,
            episodes: [...new Set(mentions.map((item) => item.episodeId))].map((episodeId) => ({
              episodeId,
              scenes: new Set(
                mentions
                  .filter((item) => item.episodeId === episodeId && item.sceneId)
                  .map((item) => item.sceneId),
              ).size,
            })),
          };
        }),
      };
    });
  }

  findOccurrences(projectId: string, elementId: string) {
    return this.files.store.serial(projectId, async () => {
      const root = await this.files.root(projectId);
      const manifest = await this.files.store.readManifest(root);
      const story = await this.files.store.readStory(root);
      this.element(story, elementId);
      const all = (
        await Promise.all(
          (manifest.episodes ?? []).map((episode) =>
            this.occurrences(root, manifest, story, episode.id),
          ),
        )
      ).flat();
      return all
        .filter((item) => item.elementId === elementId)
        .slice(0, 200)
        .map(({ episodeId, blockId, sceneId, excerpt }) => ({
          episodeId,
          blockId,
          sceneId,
          excerpt,
        }));
    });
  }
}

import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  BlockType,
  ElementKind,
  ElementName,
  ScriptDocument,
  ScriptImportRequest,
  StoryFile,
  checkSourceIntegrity,
  deriveScenes,
  isProfileComplete,
  parseScriptText,
  type ConversionState,
  type ProjectProfile,
  type ScriptBlock,
} from '@frame-loom/contracts';
import { DomainError } from '../../core/http/domain-error.js';
import { EventBus } from '../../core/events/event-bus.js';
import { LlmService } from '../llm/llm.service.js';
import { ModelServicesRepository } from '../model-services/model-services.repository.js';
import { EpisodesService } from './episodes.service.js';
import { StoryService } from './story.service.js';
import { CONVERSION_SYSTEM } from './conversion-prompt.js';

const ModelOutput = z.object({
  decisions: z.array(
    z.object({
      id: z.number().int().nonnegative(),
      type: BlockType,
      character: z.string().max(40).optional(),
    }),
  ),
  elements: z.array(
    z.object({
      kind: ElementKind,
      name: ElementName,
      aliases: z.array(ElementName).max(20),
      sameAs: z.string().max(40).nullable(),
    }),
  ),
});
type Extracted = z.infer<typeof ModelOutput>['elements'][number];
type Job = { projectId: string; episodeId: string; controller: AbortController };
type InputLine = { id: number; text: string; guess: ScriptBlock['type']; unsure: boolean };

@Injectable()
export class ConversionService implements OnModuleDestroy {
  private readonly queue: Job[] = [];
  private readonly jobs = new Map<string, Job>();
  private worker?: Promise<void>;
  private closing = false;
  constructor(
    private readonly episodes: EpisodesService,
    private readonly story: StoryService,
    private readonly llm: LlmService,
    private readonly repository: ModelServicesRepository,
    private readonly events: EventBus,
  ) {}

  private key(projectId: string, episodeId: string) {
    return `${projectId}:${episodeId}`;
  }
  private publish(job: Pick<Job, 'projectId' | 'episodeId'>, state: ConversionState) {
    this.episodes.conversions.set(this.key(job.projectId, job.episodeId), state);
    this.events.publish({
      type: 'script.conversion.updated',
      projectId: job.projectId,
      episodeId: job.episodeId,
    });
  }
  private update(job: Job, patch: Partial<ConversionState>) {
    if (this.jobs.get(this.key(job.projectId, job.episodeId)) !== job) return;
    this.publish(job, { ...this.episodes.conversion(job.projectId, job.episodeId)!, ...patch });
  }

  import(projectId: string, episodeId: string, input: ScriptImportRequest) {
    return this.episodes.store.serial(projectId, async () => {
      this.episodes.assertIdle(projectId, episodeId);
      const parsed = ScriptImportRequest.parse(input);
      const { root, manifest } = await this.episodes.context(projectId, episodeId);
      const file = await this.episodes.store.readScript(root, episodeId, true);
      if (file.revision !== parsed.revision)
        throw new DomainError('SCRIPT_REVISION_CONFLICT', 409, '剧本已被修改');
      const profile = parsed.profile ?? manifest.profile;
      if (!isProfileComplete(profile))
        throw new DomainError('PROJECT_PROFILE_REQUIRED', 422, '请补齐项目设定');
      const source =
        parsed.text !== undefined
          ? { text: parsed.text, importedAt: new Date().toISOString() }
          : file.pendingImport;
      if (!source) throw new DomainError('SCRIPT_IMPORT_EMPTY', 422, '没有可继续的导入原文');
      if (parsed.profile) {
        manifest.profile = parsed.profile;
        manifest.updatedAt = new Date().toISOString();
        await this.episodes.store.writeManifest(root, manifest);
      }
      const pending = { ...file, revision: file.revision + 1, pendingImport: source };
      await this.episodes.store.writeScript(root, pending);
      this.story.invalidate(projectId, episodeId);
      await this.episodes.repair(root, manifest, pending, new Date().toISOString());
      const job: Job = { projectId, episodeId, controller: new AbortController() };
      const conversion: ConversionState = {
        status: 'queued',
        stage: null,
        done: 0,
        total: 0,
        warnings: [],
        error: null,
        result: null,
      };
      this.publish(job, conversion);
      this.jobs.set(this.key(projectId, episodeId), job);
      this.queue.push(job);
      if (!this.worker)
        this.worker = this.work().finally(() => {
          this.worker = undefined;
        });
      return { revision: pending.revision, conversion };
    });
  }

  cancel(projectId: string, episodeId: string) {
    return this.episodes.store.serial(projectId, async () => {
      await this.episodes.context(projectId, episodeId);
      const job = this.jobs.get(this.key(projectId, episodeId));
      if (job) {
        job.controller.abort();
        this.update(job, { status: 'cancelled', stage: null });
      }
      return { saved: true };
    });
  }

  discard(projectId: string, episodeId: string) {
    return this.episodes.store.serial(projectId, async () => {
      this.episodes.assertIdle(projectId, episodeId);
      const { root, manifest } = await this.episodes.context(projectId, episodeId);
      const file = await this.episodes.store.readScript(root, episodeId);
      const updated = { ...file, pendingImport: null, revision: file.revision + 1 };
      await this.episodes.store.writeScript(root, updated);
      this.story.invalidate(projectId, episodeId);
      await this.episodes.repair(root, manifest, updated, new Date().toISOString());
      this.episodes.conversions.delete(this.key(projectId, episodeId));
      this.events.publish({ type: 'script.conversion.updated', projectId, episodeId });
      return { revision: updated.revision };
    });
  }

  private async work() {
    while (this.queue.length && !this.closing) {
      const job = this.queue.shift()!;
      try {
        job.controller.signal.throwIfAborted();
        await this.convert(job);
      } catch (error) {
        this.update(job, {
          status: job.controller.signal.aborted ? 'cancelled' : 'failed',
          error: job.controller.signal.aborted
            ? null
            : error instanceof Error
              ? error.message
              : '转换失败',
          stage: null,
        });
      } finally {
        if (this.jobs.get(this.key(job.projectId, job.episodeId)) === job)
          this.jobs.delete(this.key(job.projectId, job.episodeId));
      }
    }
  }

  private batches(text: string, blocks: ScriptBlock[], maxOutput: number) {
    const limit = Math.max(10, Math.floor((maxOutput - 400) / 20));
    const byLine = new Map(blocks.map((block) => [block.src!.line, block]));
    const batches: InputLine[][] = [];
    let batch: InputLine[] = [];
    let chars = 0;
    let unsure = 0;
    for (const [id, textLine] of text.split(/\r\n?|\n/u).entries()) {
      if (!textLine.trim()) continue;
      const block = byLine.get(id);
      const line = { id, text: textLine, guess: block?.type ?? 'action', unsure: !!block?.review };
      if (batch.length && (chars + textLine.length > 6000 || (line.unsure && unsure >= limit))) {
        batches.push(batch);
        batch = [];
        chars = 0;
        unsure = 0;
      }
      batch.push(line);
      chars += textLine.length;
      if (line.unsure) unsure++;
    }
    if (batch.length) batches.push(batch);
    return batches.filter((batch) => batch.some((line) => line.unsure));
  }

  private apply(
    blocks: ScriptBlock[],
    decisions: z.infer<typeof ModelOutput>['decisions'],
    batch: InputLine[],
    knownCharacters: string[],
  ) {
    const accepted = new Set<number>();
    for (const decision of decisions) {
      const line = batch.find((line) => line.id === decision.id && line.unsure);
      if (!line || accepted.has(line.id)) continue;
      const index = blocks.findIndex((block) => block.src?.line === line.id && block.review);
      if (index < 0) continue;
      const original = blocks[index];
      if (decision.type === 'dialogue') {
        const name = decision.character;
        if (!name || !(line.text.trimStart().startsWith(name) || knownCharacters.includes(name)))
          continue;
        const value = line.text.trim();
        const remainder = value.slice(name.length);
        const content =
          value.startsWith(name) && /^(?:\s|[:：])/u.test(remainder)
            ? remainder.replace(/^[\s:：]+/u, '')
            : value;
        blocks.splice(
          index,
          1,
          {
            id: randomUUID(),
            type: 'character',
            text: name,
            src: original.src,
            attrs: { delivery: null },
          },
          { id: original.id, type: 'dialogue', text: content, src: original.src },
        );
      } else {
        blocks[index] = {
          id: original.id,
          type: decision.type,
          text: original.text,
          src: original.src,
        };
      }
      accepted.add(line.id);
    }
  }

  private addExtracted(story: StoryFile, elements: Extracted[]) {
    let added = 0;
    for (const item of elements) {
      const sameKind = story.elements.filter((element) => element.kind === item.kind);
      const names = [item.name, ...item.aliases];
      const known = new Set(
        sameKind
          .flatMap((element) => [element.name, ...element.aliases])
          .map((name) => name.toLowerCase()),
      );
      if (
        names.some((name) => known.has(name.toLowerCase())) ||
        story.ignored.some(
          (ignored) =>
            ignored.kind === item.kind &&
            names.some((name) => name.toLowerCase() === ignored.name.toLowerCase()),
        )
      )
        continue;
      const target = sameKind.find((element) =>
        [element.name, ...element.aliases].some(
          (name) => name.toLowerCase() === item.sameAs?.toLowerCase(),
        ),
      );
      const now = new Date().toISOString();
      story.elements.push({
        id: randomUUID(),
        kind: item.kind,
        name: item.name,
        aliases: [
          ...new Map(
            item.aliases
              .filter((name) => name.toLowerCase() !== item.name.toLowerCase())
              .map((name) => [name.toLowerCase(), name]),
          ).values(),
        ],
        status: 'pending',
        description: '',
        attrs: {},
        createdAt: now,
        updatedAt: now,
        ...(target ? { suggestedMergeInto: target.id } : {}),
      });
      added++;
    }
    return added;
  }

  private async convert(job: Job) {
    const { projectId, episodeId, controller } = job;
    const signal = controller.signal;
    this.update(job, { status: 'running', stage: 'split' });
    const { root, manifest } = await this.episodes.context(projectId, episodeId);
    const initial = await this.episodes.store.readScript(root, episodeId);
    const source = initial.pendingImport!;
    const blocks = parseScriptText(source.text).blocks;
    const story = await this.episodes.store.readStory(root);
    const knownCharacters = story.elements
      .filter((element) => element.kind === 'character')
      .flatMap((element) => [element.name, ...element.aliases]);
    for (const block of blocks)
      if (block.type === 'character' && !knownCharacters.includes(block.text))
        knownCharacters.push(block.text);
    const warnings: string[] = [];
    let modelId: string | null = this.repository.defaults().chat;
    let maxOutput = 1024;
    if (modelId) {
      try {
        const model = this.repository.getModel(modelId);
        await this.llm.validateChat(modelId);
        if (model.capability.kind === 'chat') maxOutput = model.capability.maxOutput ?? 1024;
      } catch {
        modelId = null;
      }
    }
    if (!modelId) warnings.push('未设置默认文本模型或模型不可用，将仅按规则识别');
    const batches = this.batches(source.text, blocks, maxOutput);
    this.update(job, { stage: 'classify', total: modelId ? batches.length : 0, warnings });
    const extracted: Extracted[] = [];
    if (modelId)
      for (const [index, batch] of batches.entries()) {
        signal.throwIfAborted();
        let output: z.infer<typeof ModelOutput> | undefined;
        for (let attempt = 0; attempt < 2; attempt++) {
          let text: string;
          try {
            text = await this.llm.complete(
              modelId,
              {
                system:
                  CONVERSION_SYSTEM +
                  (attempt ? '\n上次输出不是有效 JSON，请按要求重新输出。' : ''),
                user: JSON.stringify({
                  profile: manifest.profile as ProjectProfile,
                  knownCharacters,
                  lines: batch,
                }),
              },
              signal,
            );
          } catch (error) {
            signal.throwIfAborted();
            warnings.push(
              `文本模型调用失败，剩余内容按规则识别：${error instanceof Error ? error.message : '上游错误'}`,
            );
            modelId = null;
            break;
          }
          try {
            output = ModelOutput.parse(
              JSON.parse(
                text
                  .trim()
                  .replace(/^```(?:json)?\s*/iu, '')
                  .replace(/\s*```$/u, ''),
              ) as unknown,
            );
            break;
          } catch {
            if (attempt === 1) warnings.push('模型两次输出均不是有效 JSON，该批按规则识别');
          }
        }
        signal.throwIfAborted();
        if (output) {
          this.apply(blocks, output.decisions, batch, knownCharacters);
          const original = batch.map((line) => line.text).join('\n');
          extracted.push(
            ...output.elements
              .filter((element) =>
                [element.name, ...element.aliases].every((name) => original.includes(name)),
              )
              .slice(0, 30),
          );
        }
        this.update(job, { done: index + 1, warnings: [...warnings] });
        if (!modelId) break;
      }
    this.update(job, { stage: 'extract', warnings: [...warnings] });
    signal.throwIfAborted();
    await this.episodes.store.serial(projectId, async () => {
      signal.throwIfAborted();
      this.update(job, { stage: 'match' });
      const currentContext = await this.episodes.context(projectId, episodeId);
      const current = await this.episodes.store.readScript(root, episodeId, true);
      if (current.revision !== initial.revision)
        throw new DomainError('SCRIPT_REVISION_CONFLICT', 409, '转换期间剧本已被修改');
      const integrity = checkSourceIntegrity(source.text, blocks);
      if (integrity.missingLines.length || integrity.invalidBlocks.length)
        throw new DomainError('SCRIPT_SOURCE_INTEGRITY', 422, '转换结果未通过原文完整性检查');
      const document = ScriptDocument.parse({ schemaVersion: 1, blocks });
      const file = {
        ...current,
        revision: current.revision + 1,
        pendingImport: null,
        source,
        document,
        convertedAt: new Date().toISOString(),
      };
      const latestStory = await this.episodes.store.readStory(root);
      const addedElements =
        this.story.syncInto(latestStory, blocks) + this.addExtracted(latestStory, extracted);
      StoryFile.parse(latestStory);
      signal.throwIfAborted();
      await this.episodes.store.writeScript(root, file);
      this.story.invalidate(projectId, episodeId);
      await this.episodes.repair(root, currentContext.manifest, file, file.convertedAt);
      if (addedElements)
        await this.episodes.store.writeStory(root, {
          ...latestStory,
          revision: latestStory.revision + 1,
        });
      this.update(job, {
        status: 'succeeded',
        stage: null,
        warnings: [...warnings],
        result: {
          scenes: deriveScenes(blocks, currentContext.episode!.number).length,
          blocks: blocks.length,
          unsure: blocks.filter((block) => block.review).length,
          addedElements,
        },
      });
    });
  }

  async onModuleDestroy() {
    this.closing = true;
    for (const job of this.jobs.values()) job.controller.abort();
    await this.worker;
  }
}

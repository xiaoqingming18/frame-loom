import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ConversionState,
  ScriptImportRequest,
  ImportBoundaryBatch,
  ImportSceneBatch,
  ImportMetaBatch,
  ScriptDocument,
  createEditableScript,
  projectScriptDocument,
  type ScriptScene,
} from '@frame-loom/contracts';
import { DomainError } from '../../core/http/domain-error.js';
import { EventBus } from '../../core/events/event-bus.js';
import { LlmService } from '../llm/llm.service.js';
import { ModelServicesRepository } from '../model-services/model-services.repository.js';
import { EpisodesService } from './episodes.service.js';
import { episodeRow, readElements, saveDocument } from './script-repository.js';
import { CONVERSION_SYSTEM, IMPORT_PROTOCOL_VERSION } from './conversion-prompt.js';
import { sourceUnits, partitionSource, validateSource } from './script-source-validation.js';

const Task = z.object({
  id: z.string(),
  source: z.string(),
  digest: z.string(),
  base_revision: z.number(),
  context_key: z.string(),
  model_key: z.string(),
  state: z.string(),
  batches: z.string(),
  applied: z.number(),
});
type Job = {
  projectId: string;
  episodeId: string;
  root: string;
  taskId: string;
  controller: AbortController;
  settled: Promise<void>;
  settle: () => void;
};
const initialState = (): ConversionState => ({
  status: 'queued',
  stage: null,
  done: 0,
  total: 0,
  warnings: [],
  error: null,
  result: null,
});
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canReduce = (error: unknown) =>
  error instanceof SyntaxError ||
  (error instanceof DomainError &&
    ['INCOMPLETE_OUTPUT', 'INCOMPLETE_STREAM', 'SCRIPT_CAPACITY_INSUFFICIENT'].includes(
      error.code,
    ));

@Injectable()
export class ConversionService implements OnModuleDestroy {
  private readonly jobs = new Map<string, Job>();
  private readonly queue: Job[] = [];
  private worker?: Promise<void>;
  private closing = false;
  constructor(
    private readonly episodes: EpisodesService,
    private readonly llm: LlmService,
    private readonly repository: ModelServicesRepository,
    private readonly events: EventBus,
  ) {
    episodes.database.releaseTasks = async (projectId) => {
      const jobs = [...this.jobs.values()].filter((job) => job.projectId === projectId);
      for (const job of jobs) await this.cancel(projectId, job.episodeId);
      await Promise.all(jobs.map((job) => job.settled));
    };
  }
  private key(projectId: string, episodeId: string) {
    return `${projectId}:${episodeId}`;
  }
  private contextKey(manifest: { id: string; name: string; profile?: unknown }, episode: unknown) {
    return digest({
      project: manifest.id,
      name: manifest.name,
      profile: manifest.profile,
      episode,
    });
  }
  private async update(job: Job, patch: Partial<ConversionState>) {
    const key = this.key(job.projectId, job.episodeId);
    if (this.jobs.get(key) !== job) return;
    const state = {
      ...(this.episodes.conversion(job.projectId, job.episodeId) ?? initialState()),
      ...patch,
    };
    await this.episodes.database.use(job.root, job.projectId, (db) =>
      db
        .prepare('UPDATE script_imports SET state=?,updated_at=? WHERE id=?')
        .run(JSON.stringify(state), new Date().toISOString(), job.taskId),
    );
    if (this.jobs.get(key) !== job) return;
    this.episodes.conversions.set(key, state);
    this.events.publish({
      type: 'script.conversion.updated',
      projectId: job.projectId,
      episodeId: job.episodeId,
    });
  }
  async import(projectId: string, episodeId: string, input: ScriptImportRequest) {
    const previous = this.jobs.get(this.key(projectId, episodeId));
    if (previous?.controller.signal.aborted) await previous.settled;
    return this.episodes.store.serial(projectId, async () => {
      if (this.closing) throw new DomainError('SCRIPT_SERVICE_CLOSING', 409, '服务正在退出');
      this.episodes.assertIdle(projectId, episodeId);
      const parsed = ScriptImportRequest.parse(input);
      const { root, manifest, episode } = await this.episodes.context(projectId, episodeId);
      if (episode!.revision !== parsed.revision)
        throw new DomainError('SCRIPT_REVISION_CONFLICT', 409, '剧本已被修改');
      const modelId = this.repository.defaults().chat;
      if (!modelId) throw new DomainError('TEXT_MODEL_REQUIRED', 422, '请先配置可用的默认文本模型');
      const model = this.repository.getModel(modelId);
      await this.llm.validateChat(modelId);
      const modelKey = digest({
        id: modelId,
        hash: model.configHash,
        protocol: IMPORT_PROTOCOL_VERSION,
      });
      const contextKey = this.contextKey(manifest, episode);
      const task = await this.episodes.database.use(root, projectId, (db) => {
        const previous = Task.optional().parse(
          db
            .prepare(
              'SELECT * FROM script_imports WHERE episode_id=? ORDER BY created_at DESC LIMIT 1',
            )
            .get(episodeId),
        );
        const text = parsed.text ?? previous?.source;
        if (!text?.trim()) throw new DomainError('SCRIPT_IMPORT_EMPTY', 422, '请输入完整剧本原文');
        const hash = digest(text);
        const reusable =
          previous &&
          !previous.applied &&
          previous.digest === hash &&
          previous.model_key === modelKey &&
          previous.context_key === contextKey &&
          previous.base_revision === parsed.revision;
        const id = reusable ? previous.id : randomUUID();
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO script_imports(id,episode_id,source,digest,base_revision,context_key,model_key,state,batches,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at`,
        ).run(
          id,
          episodeId,
          text,
          hash,
          parsed.revision,
          contextKey,
          modelKey,
          JSON.stringify(initialState()),
          reusable ? previous.batches : '{}',
          now,
          now,
        );
        return id;
      });
      let settle!: () => void;
      const settled = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const job: Job = {
        projectId,
        episodeId,
        root,
        taskId: task,
        controller: new AbortController(),
        settled,
        settle,
      };
      this.jobs.set(this.key(projectId, episodeId), job);
      this.episodes.conversions.set(this.key(projectId, episodeId), initialState());
      this.queue.push(job);
      this.startWorker();
      return { revision: parsed.revision, conversion: initialState() };
    });
  }
  async cancel(projectId: string, episodeId: string) {
    const job = this.jobs.get(this.key(projectId, episodeId));
    if (job) {
      job.controller.abort();
      await this.update(job, { status: 'cancelled', stage: null, error: null });
      const queued = this.queue.indexOf(job);
      if (queued >= 0) {
        this.queue.splice(queued, 1);
        this.jobs.delete(this.key(projectId, episodeId));
        job.settle();
      }
    }
    return { saved: true };
  }
  async discard(projectId: string, episodeId: string) {
    return this.episodes.store.serial(projectId, async () => {
      this.episodes.assertIdle(projectId, episodeId);
      const { root, episode } = await this.episodes.context(projectId, episodeId);
      await this.episodes.database.use(root, projectId, (db) =>
        db.prepare('DELETE FROM script_imports WHERE episode_id=? AND applied=0').run(episodeId),
      );
      this.episodes.conversions.delete(this.key(projectId, episodeId));
      return { revision: episode!.revision };
    });
  }
  private startWorker() {
    if (this.worker || this.closing) return;
    this.worker = this.work().finally(() => {
      this.worker = undefined;
      if (this.queue.length) this.startWorker();
    });
  }
  private async work() {
    while (this.queue.length && !this.closing) {
      const job = this.queue.shift()!;
      try {
        job.controller.signal.throwIfAborted();
        await this.convert(job);
      } catch (error) {
        await this.update(job, {
          status: job.controller.signal.aborted ? 'cancelled' : 'failed',
          stage: null,
          error: job.controller.signal.aborted
            ? null
            : error instanceof Error
              ? error.message
              : '解析失败',
        }).catch(() => {});
      } finally {
        if (this.jobs.get(this.key(job.projectId, job.episodeId)) === job)
          this.jobs.delete(this.key(job.projectId, job.episodeId));
        job.settle();
      }
    }
  }
  private async convert(job: Job) {
    const { root, manifest, episode } = await this.episodes.context(job.projectId, job.episodeId);
    const task = await this.episodes.database.use(root, job.projectId, (db) =>
      Task.parse(db.prepare('SELECT * FROM script_imports WHERE id=?').get(job.taskId)),
    );
    const modelId = this.repository.defaults().chat;
    if (!modelId) throw new DomainError('TEXT_MODEL_REQUIRED', 422, '默认文本模型不可用');
    const model = this.repository.getModel(modelId);
    if (model.capability.kind !== 'chat')
      throw new DomainError('TEXT_MODEL_REQUIRED', 422, '需要文本模型');
    if (
      digest({ id: modelId, hash: model.configHash, protocol: IMPORT_PROTOCOL_VERSION }) !==
      task.model_key
    )
      throw new DomainError('SCRIPT_MODEL_CHANGED', 409, '模型配置已变化，请重新导入');
    const maxOutput = model.capability.maxOutput ?? 1024,
      contextWindow = model.capability.contextWindow ?? 8192;
    const known = await this.episodes.database.use(root, job.projectId, (db) =>
      readElements(db).flatMap((e) => [e.name, ...e.aliases]),
    );
    const schemaOverhead = Math.max(
      ...[ImportBoundaryBatch, ImportSceneBatch, ImportMetaBatch].map((schema) =>
        Buffer.byteLength(
          JSON.stringify(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })),
          'utf8',
        ),
      ),
    );
    const overhead =
      Buffer.byteLength(CONVERSION_SYSTEM + JSON.stringify(known), 'utf8') + schemaOverhead + 1024;
    const limit = Math.floor(
      Math.min((contextWindow - maxOutput - overhead) / 3, (maxOutput - 512) / 5),
    );
    if (limit < 128)
      throw new DomainError(
        'SCRIPT_CAPACITY_INSUFFICIENT',
        422,
        '模型上下文或输出预算不足，不能容纳最小剧本片段',
      );
    const units = sourceUnits(task.source);
    const ranges = partitionSource(units, limit);
    const cache = z.record(z.string(), z.unknown()).parse(JSON.parse(task.batches));
    let calls = 0,
      done = 0;
    const call = async <T>(
      mode: string,
      schema: z.ZodType<T>,
      payload: object,
      validate: (value: T) => void,
    ): Promise<T> => {
      const key = digest({ mode, payload, model: task.model_key, source: task.digest });
      if (cache[key] !== undefined) {
        const value = schema.parse(cache[key]);
        validate(value);
        done++;
        await this.update(job, { done });
        return value;
      }
      let last: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        job.controller.signal.throwIfAborted();
        if (++calls > 512)
          throw new DomainError(
            'SCRIPT_CALL_LIMIT',
            422,
            '解析达到512次调用上限，已保留原文和成功批次',
          );
        try {
          const user = JSON.stringify({
            mode,
            ...payload,
            schema: z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }),
            retry: attempt ? String(last) : undefined,
          });
          if (Buffer.byteLength(user + CONVERSION_SYSTEM, 'utf8') + maxOutput > contextWindow)
            throw new DomainError('SCRIPT_CAPACITY_INSUFFICIENT', 422, '请求超过已知模型容量');
          const response = await this.llm.complete(
            modelId,
            { system: CONVERSION_SYSTEM, user },
            job.controller.signal,
            { maxTokens: maxOutput, timeoutMs: 180000, requireStop: true },
          );
          job.controller.signal.throwIfAborted();
          const value = schema.parse(JSON.parse(response));
          validate(value);
          cache[key] = value;
          await this.episodes.database.use(root, job.projectId, (db) =>
            db
              .prepare('UPDATE script_imports SET batches=? WHERE id=?')
              .run(JSON.stringify(cache), job.taskId),
          );
          done++;
          await this.update(job, { done });
          return value;
        } catch (error) {
          last = error;
          if (job.controller.signal.aborted) throw error;
        }
      }
      throw last;
    };
    await this.update(job, { status: 'running', stage: 'locating', total: ranges.length, done: 0 });
    const boundaries: ImportBoundaryBatch['parts'] = [];
    let previousKey: number | null = null;
    for (let index = 0; index < ranges.length; index++) {
      const range = ranges[index];
      const context = {
        start: Math.max(0, range.start - 1),
        end: Math.min(units.length, range.end + 1),
      };
      let batch: ImportBoundaryBatch;
      try {
        batch = await call(
          'locate',
          ImportBoundaryBatch,
          {
            batchId: `boundary-${index}`,
            responsible: range,
            context,
            previousSceneKey: previousKey,
            source: units.slice(context.start, context.end),
          },
          (value) => {
            if (
              value.batchId !== `boundary-${index}` ||
              JSON.stringify(value.responsible) !== JSON.stringify(range) ||
              JSON.stringify(value.context) !== JSON.stringify(context)
            )
              throw new Error('定位区间或批次身份不一致');
            let key = previousKey;
            for (const part of value.parts) {
              if (part.kind === 'unrepresentable')
                throw new Error(`来源第${part.range.start + 1}行无法表示：${part.reason}`);
              if (part.kind === 'scene') {
                if (part.continuation && part.sceneKey !== key)
                  throw new Error('跨批续场身份不一致');
                key = part.sceneKey;
              }
            }
          },
        );
      } catch (error) {
        if (!canReduce(error) || range.end - range.start < 2) throw error;
        const middle = Math.floor((range.start + range.end) / 2);
        ranges.splice(
          index,
          1,
          { start: range.start, end: middle },
          { start: middle, end: range.end },
        );
        await this.update(job, { total: ranges.length });
        index--;
        continue;
      }
      for (const part of batch.parts) {
        boundaries.push(part);
        if (part.kind === 'scene') previousKey = part.sceneKey;
      }
    }
    const pieces = boundaries.flatMap((part) =>
      partitionSource(units.slice(part.range.start, part.range.end), limit).map((range, index) => ({
        ...part,
        range,
        continuation: part.continuation || index > 0,
      })),
    );
    await this.update(job, { stage: 'parsing', total: ranges.length + pieces.length });
    const scenes: ScriptScene[] = [];
    let currentKey: number | null = null;
    const meta = {
      series: manifest.name,
      episode: episode!.number,
      title: episode!.title,
      genre: manifest.profile?.genres.join(' / ') ?? '',
      style: manifest.profile?.style ?? '',
      duration_sec: episode!.duration_sec,
      core_conflict: '',
      hook_start: '',
      hook_end: '',
    };
    for (let index = 0; index < pieces.length; index++) {
      const part = pieces[index];
      const previous = scenes.at(-1);
      const payload = {
        batchId: `content-${index}`,
        responsible: part.range,
        sceneKey: part.sceneKey,
        continuation: part.continuation,
        knownCharacters: known,
        previousScene:
          part.continuation && previous
            ? {
                location: previous.location,
                interior: previous.interior,
                time_of_day: previous.time_of_day,
                atmosphere: previous.atmosphere,
                characters: previous.characters,
              }
            : undefined,
        previousBeat:
          part.continuation && previous?.beats.at(-1)
            ? (() => {
                const beat = previous.beats.at(-1)!;
                return beat.type === 'dialogue'
                  ? {
                      type: beat.type,
                      speaker: beat.speaker,
                      emotion: beat.emotion,
                      hasContent: !!beat.line,
                    }
                  : { type: beat.type, hasContent: !!beat.content };
              })()
            : undefined,
        authority: meta,
        source: units.slice(part.range.start, part.range.end),
      };
      try {
        if (part.kind === 'meta') {
          const batch = await call('meta', ImportMetaBatch, payload, (value) => {
            if (
              value.batchId !== payload.batchId ||
              JSON.stringify(value.responsible) !== JSON.stringify(part.range)
            )
              throw new Error('元信息区间不一致');
            validateSource(value, units);
          });
          for (const field of ['core_conflict', 'hook_start', 'hook_end'] as const)
            if (batch[field]) {
              if (meta[field]) throw new Error('元信息重复');
              meta[field] = batch[field];
            }
        } else {
          const batch = await call('scene', ImportSceneBatch, payload, (value) => {
            if (
              value.batchId !== payload.batchId ||
              JSON.stringify(value.responsible) !== JSON.stringify(part.range) ||
              value.sceneKey !== part.sceneKey ||
              value.continuation !== part.continuation
            )
              throw new Error('场次来源或续场身份不一致');
            const prior = scenes.at(-1);
            validateSource(
              value,
              units,
              part.continuation && prior ? { ...prior, lastBeat: prior.beats.at(-1) } : undefined,
            );
            if (
              value.firstBeatContinuation &&
              (!part.continuation || !prior?.beats.length || !value.scene.beats.length)
            )
              throw new Error('内容续接缺少前后内容');
          });
          if (part.continuation) {
            const previous = scenes.at(-1);
            if (
              !previous ||
              currentKey !== part.sceneKey ||
              previous.location !== batch.scene.location ||
              previous.interior !== batch.scene.interior ||
              previous.time_of_day !== batch.scene.time_of_day
            )
              throw new Error('续场属性不一致');
            const incoming = [...batch.scene.beats];
            if (batch.firstBeatContinuation) {
              const left = previous.beats.at(-1)!,
                right = incoming.shift()!;
              if (left.type === 'action' && right.type === 'action')
                left.content = [left.content, right.content].filter(Boolean).join('\n');
              else if (
                left.type === 'dialogue' &&
                right.type === 'dialogue' &&
                left.speaker === right.speaker &&
                left.emotion === right.emotion
              )
                left.line = [left.line, right.line].filter(Boolean).join('\n');
              else throw new Error('续接内容的类型、人物或情绪不一致');
            }
            previous.beats.push(...incoming);
            previous.characters = [...new Set([...previous.characters, ...batch.scene.characters])];
          } else {
            scenes.push({ ...batch.scene, scene_id: `${episode!.number}-${scenes.length + 1}` });
            currentKey = part.sceneKey;
          }
        }
      } catch (error) {
        if (!canReduce(error) || part.range.end - part.range.start < 2) throw error;
        const middle = Math.floor((part.range.start + part.range.end) / 2);
        pieces.splice(
          index,
          1,
          { ...part, range: { start: part.range.start, end: middle } },
          {
            ...part,
            range: { start: middle, end: part.range.end },
            continuation: part.kind === 'scene',
          },
        );
        await this.update(job, { total: ranges.length + pieces.length });
        index--;
      }
    }
    await this.update(job, { stage: 'validating' });
    if (!scenes.length) throw new Error('导入结果至少需要一个场次');
    const document = createEditableScript(ScriptDocument.parse({ meta, scenes }));
    job.controller.signal.throwIfAborted();
    await this.update(job, { stage: 'applying' });
    await this.episodes.store.serial(job.projectId, async () => {
      job.controller.signal.throwIfAborted();
      const latest = await this.episodes.context(job.projectId, job.episodeId);
      if (latest.root !== job.root)
        throw new DomainError('SCRIPT_PROJECT_MOVED', 409, '项目位置已变化，请重新导入');
      if (this.contextKey(latest.manifest, latest.episode) !== task.context_key)
        throw new DomainError('SCRIPT_CONTEXT_CHANGED', 409, '项目或剧集信息已变化，请重新导入');
      const state = await this.episodes.database.use(root, job.projectId, (db) =>
        db.transaction(() => {
          const current = Task.parse(
            db.prepare('SELECT * FROM script_imports WHERE id=?').get(job.taskId),
          );
          if (current.applied) throw new Error('任务已应用');
          const row = episodeRow(db, job.episodeId);
          const result = saveDocument(
            db,
            job.episodeId,
            task.base_revision,
            projectScriptDocument(document, { ...latest.manifest, episode: row }),
          );
          const state: ConversionState = {
            status: 'succeeded',
            stage: null,
            done: ranges.length + pieces.length,
            total: ranges.length + pieces.length,
            warnings: ['剧名、集号、标题、类型、画风和时长采用当前项目及剧集信息'],
            error: null,
            result: {
              scenes: scenes.length,
              beats: scenes.reduce((n, s) => n + s.beats.length, 0),
              addedElements: result.addedElements,
            },
          };
          db.prepare('UPDATE script_imports SET applied=1,state=?,updated_at=? WHERE id=?').run(
            JSON.stringify(state),
            new Date().toISOString(),
            job.taskId,
          );
          return state;
        })(),
      );
      this.episodes.conversions.set(this.key(job.projectId, job.episodeId), state);
      this.events.publish({
        type: 'script.conversion.updated',
        projectId: job.projectId,
        episodeId: job.episodeId,
      });
    });
  }
  async onModuleDestroy() {
    this.closing = true;
    for (const job of this.jobs.values()) job.controller.abort();
    await this.worker;
  }
}

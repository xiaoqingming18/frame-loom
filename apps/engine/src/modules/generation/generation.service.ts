import {
  Injectable,
  type OnApplicationBootstrap,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { desc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  checkRequest,
  checkMedia,
  effectiveCapability,
  imageEditSupport,
  SemanticRequest,
  resolvePromptReferences,
  type GenerationStatus,
} from '@frame-loom/contracts';
import { GenerationJob } from '@frame-loom/contracts';
import { DatabaseService } from '../../core/database/database.service.js';
import { DomainError } from '../../core/http/domain-error.js';
import { EventBus } from '../../core/events/event-bus.js';
import { ModelServicesRepository } from '../model-services/model-services.repository.js';
import { ProjectFilesService } from '../projects/project-files.service.js';
import { ProjectMediaService } from '../projects/project-media.service.js';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';
import { generationJobs, type JobRow } from './generation.schema.js';
import { MediaService } from './media.service.js';
import { compositeEmotion, emotionArtifacts } from './image-emotion.js';
import { publicReference } from './public-reference.js';
import { ProtocolRegistry } from './protocols/registry.js';
import { applyExtras, GenerationFailure, prepareCall, send } from './protocols/http.js';
import type { AdapterContext, AdapterResult, HttpCall, JobSnapshot } from './protocols/types.js';

const activeStates: GenerationStatus[] = ['submitting', 'running', 'downloading'];
@Injectable()
export class GenerationService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  private stopping = false;
  private readonly cancelling = new Set<string>();
  private readonly active = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  constructor(
    private readonly database: DatabaseService,
    private readonly services: ModelServicesRepository,
    private readonly media: MediaService,
    private readonly registry: ProtocolRegistry,
    private readonly events: EventBus,
    private readonly storage: ObjectStorageService,
    private readonly files: ProjectFilesService,
    private readonly projectMedia: ProjectMediaService,
  ) {}
  private get db() {
    return this.database.db;
  }
  private row(id: string): JobRow {
    const row = this.db.select().from(generationJobs).where(eq(generationJobs.id, id)).get();
    if (!row) throw new DomainError('JOB_NOT_FOUND', 404, '生成任务不存在');
    return row;
  }
  get(id: string): GenerationJob {
    const row = this.row(id);
    return GenerationJob.parse({
      ...row,
      configHash: row.snapshot.configHash,
      recoveryAction: this.recoveryAction(row),
      canCancelRemote:
        !!row.remoteTaskId &&
        !!this.registry.get(row.snapshot.protocolId).buildCancel &&
        ['running', 'paused'].includes(row.status) &&
        !row.snapshot.cancellation,
      cancellation: row.snapshot.cancellation,
      outputs: row.outputs.map((hash) => this.media.get(hash)),
    });
  }
  private recoveryAction(row: JobRow): NonNullable<GenerationJob['recoveryAction']> {
    if (!['failed', 'paused', 'download_failed', 'submit_unknown'].includes(row.status))
      return 'none';
    if (row.rawResponse?.length) return 'download';
    if (row.remoteTaskId)
      return this.registry.get(row.snapshot.protocolId).buildQuery ? 'query' : 'none';
    if (row.status === 'submit_unknown') return 'none';
    return row.status === 'paused' ? 'prepare' : 'new_job';
  }
  list() {
    return this.db
      .select({ id: generationJobs.id })
      .from(generationJobs)
      .orderBy(desc(generationJobs.createdAt))
      .limit(100)
      .all()
      .map(({ id }) => this.get(id));
  }
  private update(id: string, values: Partial<typeof generationJobs.$inferInsert>) {
    this.db
      .update(generationJobs)
      .set({ ...values, updatedAt: new Date().toISOString() })
      .where(eq(generationJobs.id, id))
      .run();
    this.events.publish({ type: 'generation.job.updated', jobId: id });
  }
  async create(input: SemanticRequest): Promise<GenerationJob> {
    const request = SemanticRequest.parse(input);
    if (request.pageId && !request.projectId)
      throw new DomainError('PROJECT_REQUIRED', 400, '创作页必须指定所属项目');
    if (!request.projectId) return this.createAt(request);
    return this.files.store.serial(request.projectId, async () => {
      const root = await this.files.root(request.projectId!);
      const manifest = await this.files.store.readManifest(root);
      if (request.pageId && !manifest.pages.some((page) => page.id === request.pageId))
        throw new DomainError('PAGE_NOT_FOUND', 404, '创作页不存在');
      return this.createAt(request, root);
    });
  }
  private async createAt(request: SemanticRequest, root?: string) {
    const model = this.services.getModel(request.modelId);
    const channel = this.services.getChannel(model.channelId);
    if (!model.enabled || !channel.enabled || model.blockedReason)
      throw new DomainError('MODEL_DISABLED', 422, model.blockedReason ?? '渠道或模型已禁用');
    const adapter = this.registry.get(model.protocolId!);
    const descriptor = adapter.descriptor;
    const capability = effectiveCapability(model.capability, descriptor);
    if (model.kind === 'chat')
      throw new DomainError('NOT_MEDIA_MODEL', 422, '文本模型请使用文本接口');
    if (request.imageEdit) {
      if (capability.kind !== 'image')
        throw new DomainError('INVALID_EDIT', 422, '图片编辑需要图像模型');
      const support = imageEditSupport(capability, descriptor)[request.imageEdit.operation];
      if (!support.available)
        throw new DomainError('INVALID_EDIT', 422, support.reason ?? '模型不支持图片编辑');
      if (request.imageEdit.operation === 'emotion') {
        const recipe = request.imageEdit;
        const source = await this.media.resolveAt(recipe.source.sha256, root);
        if (source.media.width !== recipe.imageWidth || source.media.height !== recipe.imageHeight)
          throw new DomainError('INVALID_REFERENCE', 422, '源图片尺寸已变化');
        const prepared = await emotionArtifacts(await readFile(source.path), recipe.targetFace);
        const crop = await this.media.saveStream(
          [prepared.crop],
          undefined,
          'image',
          undefined,
          root,
        );
        const identity = await this.media.saveStream(
          [prepared.identity],
          undefined,
          'image',
          undefined,
          root,
        );
        const mask = support.mask
          ? await this.media.saveStream([prepared.mask], undefined, 'image', undefined, root)
          : undefined;
        request.imageEdit = {
          ...recipe,
          targetFace: prepared.face,
          editRegion: prepared.region,
          artifacts: {
            crop: crop.sha256,
            identity: identity.sha256,
            ...(mask ? { mask: mask.sha256 } : {}),
          },
          maskMode: mask ? 'provider' : 'local',
          postProcess: 'pending',
        };
        request.inputs = [crop, identity, ...(mask ? [mask] : [])].map((media, order) => ({
          kind: 'image',
          role: 'reference',
          order,
          sha256: media.sha256,
        }));
      }
    }
    const issues = checkRequest(request, { ...model, capability }, descriptor);
    if (issues.length)
      throw new DomainError(
        'INVALID_GENERATION_REQUEST',
        422,
        issues.map((issue) => issue.message).join('；'),
        issues,
      );
    for (const input of request.inputs) {
      await this.media.resolveAt(input.sha256, root);
      if (root) await this.media.adoptAt(root, [input.sha256]);
    }
    const mediaIssues = checkMedia(
      request.inputs.map((input) => ({ input, media: this.media.get(input.sha256) })),
      capability,
      descriptor,
      request.mode,
    );
    if (mediaIssues.length)
      throw new DomainError(
        'INVALID_REFERENCE',
        422,
        mediaIssues.map((issue) => issue.message).join('；'),
        mediaIssues,
      );
    this.services.credentials(channel.id);
    const snapshot: JobSnapshot = {
      version: 1,
      protocolId: descriptor.id,
      protocolVersion: descriptor.version,
      modelId: model.id,
      channelId: channel.id,
      upstreamModelId: model.upstreamModelId,
      kind: model.kind,
      endpoints: model.endpoints.operations,
      capability,
      extras: model.extras,
      fixedFields: model.fixedFields,
      transport: {},
      concurrencyKey: channel.id,
      concurrency: Math.min(channel.concurrency, model.concurrency ?? channel.concurrency),
      credentialFingerprint: this.services.credentialFingerprint(channel.id),
      configHash: model.configHash,
      referenceUrls: {},
    };
    for (const input of request.inputs) {
      const allowed = descriptor.transports[input.kind];
      const selected = model.transport[input.kind] ?? 'auto';
      const transport = selected === 'auto' ? allowed?.auto : selected;
      if (!transport || !allowed?.allowed.includes(transport))
        throw new DomainError('INVALID_TRANSPORT', 422, '协议不支持此素材交付方式');
      snapshot.transport[input.kind] = transport;
      if (transport === 'url') {
        this.storage.require();
        snapshot.referenceUrls[input.sha256] = await this.storage.reference(
          this.media.get(input.sha256),
          undefined,
          request.projectId,
          root,
        );
        await publicReference(snapshot.referenceUrls[input.sha256]);
      }
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    const ctx = this.context(
      { id, snapshot, projectId: request.projectId ?? null },
      AbortSignal.timeout(60000),
      root,
    );
    ctx.diagnose = () => {};
    try {
      await prepareCall(await adapter.buildSubmit(ctx, request, capability));
      // 快照冻结协议请求；素材替换成哈希占位，密钥和实际内联数据不落盘。
      const frozen = await adapter.buildSubmit(
        {
          ...ctx,
          fetchMedia: (hash) =>
            Promise.resolve({
              bytes: new TextEncoder().encode(`sha256:${hash}`),
              mime: this.media.get(hash).mime,
            }),
        },
        structuredClone(request),
        capability,
      );
      snapshot.preparedBody =
        typeof frozen.body === 'string'
          ? (JSON.parse(frozen.body) as unknown)
          : frozen.body instanceof FormData
            ? await Promise.all(
                [...frozen.body.entries()].map(async ([key, value]) => [
                  key,
                  typeof value === 'string'
                    ? value
                    : { name: value.name, type: value.type, reference: await value.text() },
                ]),
              )
            : undefined;
    } catch (error) {
      if (error instanceof GenerationFailure) throw new DomainError(error.code, 422, error.message);
      throw error;
    }
    this.db
      .insert(generationJobs)
      .values({
        id,
        kind: model.kind,
        modelId: model.id,
        status: 'pending',
        request,
        snapshot,
        projectId: request.projectId ?? null,
        pageId: request.pageId ?? null,
        outputs: [],
        source: request.source,
        createdAt: now,
        updatedAt: now,
        deadlineAt: new Date(Date.now() + (descriptor.poll?.timeoutMs ?? 60000)).toISOString(),
      })
      .run();
    this.events.publish({ type: 'generation.job.updated', jobId: id });
    return this.get(id);
  }
  remove(id: string) {
    const row = this.row(id);
    if (
      !['succeeded', 'failed', 'cancelled'].includes(row.status) ||
      this.active.has(id) ||
      this.cancelling.has(id)
    )
      throw new DomainError('JOB_BUSY', 409, '请先本地放弃任务再删除记录');
    if (row.stagedOutputs.length)
      throw new DomainError('PROJECT_OFFLINE', 409, '请恢复项目并写回暂存产物后再删除');
    this.db.delete(generationJobs).where(eq(generationJobs.id, id)).run();
    return { deleted: true as const };
  }
  cancel(id: string) {
    const row = this.row(id);
    if (['succeeded', 'cancelled'].includes(row.status)) return this.get(id);
    this.update(id, {
      status: 'cancelled',
      finishedAt: new Date().toISOString(),
      nextPollAt: null,
      rawResponse: null,
      errorMessage: '已在本地放弃；远端可能仍在运行并计费',
    });
    this.active.get(id)?.controller.abort();
    return this.get(id);
  }
  async cancelRemote(id: string) {
    const row = this.row(id);
    const adapter = this.registry.get(row.snapshot.protocolId);
    if (!row.remoteTaskId || !adapter.buildCancel || !['running', 'paused'].includes(row.status))
      throw new DomainError('CANCEL_UNAVAILABLE', 422, '当前任务不支持远端取消，可本地放弃');
    if (this.cancelling.has(id) || row.snapshot.cancellation)
      throw new DomainError('CANCEL_PENDING', 409, '取消请求已提交，请查询确认');
    const ctx = this.context(row, AbortSignal.timeout(15000));
    this.cancelling.add(id);
    this.active.get(id)?.controller.abort();
    await this.active.get(id)?.promise;
    this.update(id, {
      status: 'paused',
      nextPollAt: null,
      snapshot: { ...row.snapshot, cancellation: 'requested' },
    });
    try {
      const result = await send(adapter.buildCancel(ctx, row.remoteTaskId), ctx);
      const confirmed =
        result.status === 200 &&
        (JSON.parse(new TextDecoder().decode(result.bytes)) as { status?: string }).status ===
          'cancelled';
      if (this.row(id).status !== 'cancelled')
        this.update(id, {
          status: confirmed ? 'cancelled' : 'paused',
          snapshot: { ...row.snapshot, cancellation: confirmed ? 'confirmed' : 'requested' },
          errorMessage: confirmed ? '远端已确认取消' : '取消未确认，请查询',
        });
    } catch {
      if (this.row(id).status !== 'cancelled')
        this.update(id, {
          snapshot: { ...row.snapshot, cancellation: 'unknown' },
          errorMessage: '取消结果不明，请查询确认',
        });
    } finally {
      this.cancelling.delete(id);
    }
    return this.get(id);
  }
  async resubmit(id: string) {
    const row = this.row(id);
    if (this.recoveryAction(row) === 'none')
      throw new DomainError(
        'UNSAFE_RESUBMIT',
        409,
        '提交结果不明或当前状态不能安全重发，请核实远端任务',
      );
    if (row.remoteTaskId || row.rawResponse?.length || row.status === 'paused')
      return this.requery(id);
    return this.create(row.request);
  }
  requery(id: string) {
    const row = this.row(id);
    const action = this.recoveryAction(row);
    if (action === 'none' || action === 'new_job')
      throw new DomainError('QUERY_UNAVAILABLE', 422, '当前任务无法恢复查询');
    this.context(row, new AbortController().signal);
    this.update(id, {
      status: action === 'download' ? 'downloading' : action === 'prepare' ? 'pending' : 'running',
      nextPollAt: null,
      attempts: 0,
      errorCategory: null,
      errorCode: null,
      errorMessage: null,
      finishedAt: null,
      deadlineAt: new Date(
        Date.now() +
          (this.registry.get(row.snapshot.protocolId).descriptor.poll?.timeoutMs ?? 60000),
      ).toISOString(),
    });
    return this.get(id);
  }
  async onApplicationBootstrap() {
    await this.projectMedia.initialize();
    this.db
      .update(generationJobs)
      .set({
        status: 'submit_unknown',
        nextPollAt: null,
        errorCategory: 'unknown',
        errorCode: 'INTERRUPTED_SUBMIT',
        errorMessage: '提交时引擎退出，请核实远端任务',
        updatedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      })
      .where(eq(generationJobs.status, 'submitting'))
      .run();
    this.timer = setInterval(() => this.tick(), 250);
    this.timer.unref();
    this.tick();
  }
  async beforeApplicationShutdown() {
    this.stopping = true;
    clearInterval(this.timer);
    for (const task of this.active.values()) task.controller.abort();
    await Promise.allSettled([...this.active.values()].map((task) => task.promise));
  }
  private tick() {
    if (this.stopping) return;
    const rows = this.db
      .select()
      .from(generationJobs)
      .where(inArray(generationJobs.status, ['pending', ...activeStates]))
      .all();
    const counts = new Map<string, number>();
    const limits = new Map<string, number>();
    for (const row of rows) {
      const key = row.snapshot.concurrencyKey;
      limits.set(
        key,
        Math.min(limits.get(key) ?? row.snapshot.concurrency, row.snapshot.concurrency),
      );
      if (activeStates.includes(row.status)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const row of rows) {
      if (
        this.active.has(row.id) ||
        this.cancelling.has(row.id) ||
        (row.nextPollAt && Date.parse(row.nextPollAt) > Date.now())
      )
        continue;
      if (row.status === 'pending') {
        const key = row.snapshot.concurrencyKey;
        if ((counts.get(key) ?? 0) >= limits.get(key)!) continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        this.update(row.id, { status: 'submitting', attempts: row.attempts + 1, nextPollAt: null });
      }
      const controller = new AbortController();
      const promise = this.execute(this.row(row.id), controller.signal).finally(() =>
        this.active.delete(row.id),
      );
      this.active.set(row.id, { controller, promise });
    }
  }
  private context(
    row: Pick<JobRow, 'id' | 'snapshot' | 'projectId'>,
    signal: AbortSignal,
    root?: string,
  ): AdapterContext {
    const snapshot = row.snapshot;
    const credentials = this.services.credentials(snapshot.channelId);
    if (
      !credentials.channel.enabled ||
      !credentials.apiKey ||
      this.services.credentialFingerprint(snapshot.channelId) !== snapshot.credentialFingerprint
    )
      throw new GenerationFailure(
        'invalid_params',
        'CREDENTIAL_CHANGED',
        '渠道凭据已变化或已禁用，请恢复原凭据',
      );
    return {
      snapshot,
      credentials,
      signal,
      fetchMedia: async (hash) => {
        const media = root
          ? await this.media.resolveAt(hash, root)
          : await this.media.resolve(hash, row.projectId ?? undefined);
        return { bytes: await readFile(media.path), mime: media.media.mime };
      },
      referenceUrl: (hash) => {
        const url = snapshot.referenceUrls[hash];
        if (!url)
          throw new GenerationFailure(
            'invalid_params',
            'MISSING_REFERENCE_URL',
            '缺少素材公网地址',
          );
        return url;
      },
      resolvePrompt: (prompt, inputs) =>
        resolvePromptReferences(
          prompt,
          inputs.map((input) => ({ id: input.sha256, kind: input.kind })),
          snapshot.capability.kind === 'video' ? snapshot.capability.promptRef.syntax : 'ordinal',
          snapshot.capability.kind === 'video' ? snapshot.capability.promptRef.base : 1,
        ).prompt,
      applyExtras,
      diagnose: (diagnostic) => this.update(row.id, { diagnostic }),
    };
  }
  private async download(row: JobRow, signal: AbortSignal) {
    if (!row.rawResponse?.length)
      throw new GenerationFailure('upstream', 'MISSING_OUTPUT', '缺少下载记录');
    const outputs = new Set(row.outputs);
    const completed = new Set(row.snapshot.completedDownloads ?? []);
    const staged = new Set(row.stagedOutputs);
    const recipe =
      row.request.imageEdit?.operation === 'emotion' ? row.request.imageEdit : undefined;
    if (recipe && row.snapshot.imageEditPostProcess?.intermediateSha256) completed.add(0);
    for (const [index, output] of row.rawResponse.entries()) {
      if (completed.has(index)) continue;
      let call: HttpCall | undefined;
      if (output.kind === 'content') {
        const ctx = this.context(row, signal);
        call = this.registry.get(row.snapshot.protocolId).buildContent?.(ctx, output.ref);
        if (!call)
          throw new GenerationFailure('upstream', 'INVALID_CONTENT_ENDPOINT', '协议不支持内容下载');
      }
      const mime =
        output.mime ??
        (row.kind === 'image' ? 'image/png' : row.kind === 'tts' ? 'audio/mpeg' : 'video/mp4');
      const mediaOutput =
        output.kind === 'data'
          ? { data: output.base64, mime }
          : { url: call?.url ?? (output.kind === 'url' ? output.url : ''), mime };
      await this.media.save(
        mediaOutput,
        signal,
        call?.headers,
        row.projectId ?? undefined,
        (media, isStaged) => {
          completed.add(index);
          if (!recipe) {
            outputs.add(media.sha256);
            if (isStaged) staged.add(media.sha256);
          }
          const latest = this.row(row.id);
          this.update(row.id, {
            outputs: [...outputs],
            stagedOutputs: [...staged],
            snapshot: {
              ...latest.snapshot,
              completedDownloads: [...completed],
              ...(recipe
                ? {
                    imageEditPostProcess: {
                      ...latest.snapshot.imageEditPostProcess,
                      intermediateSha256: media.sha256,
                    },
                  }
                : {}),
            },
          });
        },
        (diagnostic) => this.update(row.id, { diagnostic }),
        call?.url ?? row.snapshot.endpoints.submit?.url,
      );
    }
    if (signal.aborted || this.row(row.id).status === 'cancelled') return;
    if (recipe) {
      const latest = this.row(row.id);
      let finalHash = latest.snapshot.imageEditPostProcess?.finalSha256;
      if (!finalHash) {
        const intermediate = latest.snapshot.imageEditPostProcess?.intermediateSha256;
        if (!intermediate)
          throw new GenerationFailure('upstream', 'MISSING_EDIT_OUTPUT', '缺少表情编辑中间图');
        const root = row.projectId
          ? await this.files.root(row.projectId).catch(() => undefined)
          : undefined;
        const source = await this.media.resolveAt(recipe.source.sha256, root);
        const generated = await this.media.resolveAt(intermediate, root);
        const final = await compositeEmotion(
          await readFile(source.path),
          await readFile(generated.path),
          recipe.editRegion,
          recipe.targetFace,
        );
        const finalMedia = await this.media.saveStream([final], signal, 'image', 'image/png', root);
        finalHash = finalMedia.sha256;
        this.update(row.id, {
          snapshot: {
            ...latest.snapshot,
            imageEditPostProcess: { intermediateSha256: intermediate, finalSha256: finalHash },
          },
        });
      }
      outputs.clear();
      outputs.add(finalHash);
    }
    this.update(row.id, {
      status: 'succeeded',
      outputs: [...outputs],
      stagedOutputs: [...staged].filter((hash) => outputs.has(hash)),
      rawResponse: null,
      nextPollAt: null,
      errorCategory: null,
      errorCode: null,
      errorMessage: null,
      finishedAt: new Date().toISOString(),
    });
    if (row.source === 'test') {
      try {
        this.services.recordCheck(row.modelId, {
          type: 'media',
          ok: true,
          checkedAt: new Date().toISOString(),
          configHash: row.snapshot.configHash,
          mode: row.request.mode,
          jobId: row.id,
          code: null,
          message: '媒体测试成功',
        });
      } catch {
        /* 模型删除不影响已完成任务。 */
      }
    }
  }
  private async execute(row: JobRow, signal: AbortSignal) {
    let sent = false;
    try {
      if (Date.now() > Date.parse(row.deadlineAt) && row.status !== 'downloading')
        throw new GenerationFailure('timeout', 'WAIT_TIMEOUT', '等待超时，可重新查询');
      if (row.status === 'downloading') {
        await this.download(row, signal);
        return;
      }
      const adapter = this.registry.get(row.snapshot.protocolId);
      const ctx = this.context(row, signal);
      let result: AdapterResult;
      if (row.remoteTaskId) {
        if (!adapter.buildQuery || !adapter.parseQuery)
          throw new GenerationFailure('upstream', 'QUERY_UNAVAILABLE', '协议不支持查询');
        result = await adapter.parseQuery(
          ctx,
          await send(adapter.buildQuery(ctx, row.remoteTaskId), ctx),
        );
      } else {
        const call = await adapter.buildSubmit(
          ctx,
          structuredClone(row.request),
          row.snapshot.capability,
        );
        sent = true;
        result = await adapter.parseSubmit(ctx, await send(call, ctx));
      }
      if (signal.aborted || this.row(row.id).status === 'cancelled') return;
      if (result.status === 'failed')
        this.update(row.id, {
          status: 'failed',
          remoteStatus: 'failed',
          errorCategory: result.category,
          errorCode: result.code,
          errorMessage: result.message,
          nextPollAt: null,
          finishedAt: new Date().toISOString(),
        });
      else if (result.status === 'running')
        this.update(row.id, {
          status: 'running',
          remoteTaskId: result.remoteTaskId,
          remoteStatus: result.remoteStatus,
          attempts: row.status === 'running' ? row.attempts + 1 : 0,
          nextPollAt: this.nextPoll(row),
          errorCategory: null,
          errorCode: null,
          errorMessage: null,
        });
      else
        this.update(row.id, {
          status: 'downloading',
          rawResponse: result.outputs,
          usage: result.usage ?? null,
          attempts: 0,
          nextPollAt: null,
          errorCategory: null,
          errorCode: null,
          errorMessage: null,
        });
    } catch (error) {
      if (this.stopping || this.row(row.id).status === 'cancelled') return;
      const failure =
        error instanceof GenerationFailure
          ? error
          : new GenerationFailure(
              'unknown',
              error instanceof DomainError ? error.code : 'LOCAL_ERROR',
              '任务处理失败，请检查渠道、素材与本地存储',
            );
      const paused = ['CREDENTIAL_CHANGED', 'CHANNEL_NOT_FOUND', 'WAIT_TIMEOUT'].includes(
        failure.code,
      );
      const uncertain =
        sent &&
        !(
          error instanceof GenerationFailure &&
          ['auth', 'quota', 'rate_limit', 'invalid_params', 'moderation'].includes(error.category)
        );
      if (
        !paused &&
        !sent &&
        ['running', 'downloading'].includes(row.status) &&
        Date.now() < Date.parse(row.deadlineAt)
      ) {
        // 签名产物过期后只刷新查询，已保存的产物索引仍由快照去重。
        const refreshOutput =
          row.status === 'downloading' &&
          row.remoteTaskId &&
          ['DOWNLOAD_401', 'DOWNLOAD_403', 'DOWNLOAD_404', 'DOWNLOAD_410'].includes(failure.code) &&
          !!this.registry.get(row.snapshot.protocolId).buildQuery;
        this.update(row.id, {
          ...(refreshOutput ? { status: 'running' as const, rawResponse: null } : {}),
          attempts: row.attempts + 1,
          nextPollAt: this.nextPoll(row),
          errorCategory: failure.category,
          errorCode: failure.code,
          errorMessage: failure.message,
        });
        return;
      }
      this.update(row.id, {
        status: paused
          ? 'paused'
          : row.status === 'downloading'
            ? 'download_failed'
            : uncertain
              ? 'submit_unknown'
              : 'failed',
        errorCategory: failure.category,
        errorCode: uncertain ? 'SUBMIT_UNKNOWN' : failure.code,
        errorMessage: failure.message,
        nextPollAt: null,
        finishedAt: new Date().toISOString(),
      });
    }
  }
  private nextPoll(row: JobRow) {
    const poll = this.registry.get(row.snapshot.protocolId).descriptor.poll;
    return new Date(
      Date.now() +
        Math.min(poll?.maxMs ?? 10000, (poll?.initialMs ?? 2000) * 2 ** Math.min(row.attempts, 10)),
    ).toISOString();
  }
}

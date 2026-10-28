import {
  Injectable,
  type OnApplicationBootstrap,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { desc, eq, inArray } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { publicReference } from './public-reference.js';
import {
  checkGenerationRequest,
  checkGenerationMedia,
  GenerationJob,
  GenerationRequest,
  type GenerationStatus,
  resolveServiceUrl,
  serviceRoutes,
} from '@frame-loom/contracts';
import { DatabaseService } from '../../core/database/database.service.js';
import { EventBus } from '../../core/events/event-bus.js';
import { DomainError } from '../../core/http/domain-error.js';
import { ChannelsRepository } from '../channels/channels.repository.js';
import { ModelCatalogService } from '../channels/model-catalog.service.js';
import { executionContract } from './execution-contract.js';
import { generationJobs, providerUploads, type JobRow } from './generation.schema.js';
import { MediaService } from './media.service.js';
import { ProjectFilesService } from '../projects/project-files.service.js';
import { ProjectMediaService } from '../projects/project-media.service.js';
import { mediaProfile } from './profiles/media-profiles.js';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';
import { imageResponse } from './adapters/image-response.js';
import {
  arkVideoTasks,
  fastaitokenVideo,
  minimaxVideoV2,
  openaiVideos,
  klingVideo,
  wanVideo,
} from './adapters/video-tasks.js';
import { openaiImages } from './adapters/openai-images.js';
import { arkImages } from './adapters/ark-images.js';
import { geminiImage } from './adapters/gemini-image.js';
import { compositeEmotion, emotionArtifacts } from './image-emotion.js';
import { minimaxT2a, openaiSpeech } from './adapters/tts.js';
import {
  GenerationFailure,
  adapterFetch,
  type AdapterContext,
  type AdapterResult,
  type GenerationAdapter,
} from './adapters/types.js';

const activeStates: GenerationStatus[] = ['submitting', 'running', 'downloading'];

@Injectable()
export class GenerationAdapters {
  readonly adapters = new Map<string, GenerationAdapter>(
    [
      openaiImages,
      geminiImage,
      arkImages,
      arkVideoTasks,
      minimaxVideoV2,
      openaiVideos,
      fastaitokenVideo,
      klingVideo,
      wanVideo,
      openaiSpeech,
      minimaxT2a,
    ].map((adapter) => [adapter.protocol, adapter]),
  );
  get(protocol: string): GenerationAdapter {
    const adapter = this.adapters.get(protocol);
    if (!adapter) throw new DomainError('INVALID_PROTOCOL', 422, '生成协议尚未接入');
    return adapter;
  }
}

@Injectable()
export class GenerationService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  private stopping = false;
  private readonly cancelling = new Set<string>();
  private readonly uploads = new Map<string, Promise<string>>();
  private readonly active = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  constructor(
    private readonly database: DatabaseService,
    private readonly channels: ChannelsRepository,
    private readonly media: MediaService,
    private readonly registry: GenerationAdapters,
    private readonly events: EventBus,
    private readonly storage: ObjectStorageService,
    private readonly files: ProjectFilesService,
    private readonly projectMedia: ProjectMediaService,
    private readonly catalog: ModelCatalogService,
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
      configVersion: row.snapshot?.configVersion,
      definitionVersion: row.snapshot?.definitionVersion,
      recoveryAction: this.recoveryAction(row),
      canCancelRemote:
        !!row.snapshot &&
        !!row.remoteTaskId &&
        executionContract(row.snapshot.connection, row.profile).cancel &&
        !!row.snapshot.connection.routes?.cancel &&
        ['running', 'paused'].includes(row.status) &&
        !row.snapshot.cancellation,
      cancellation: row.snapshot?.cancellation,
      outputs: row.outputs.map((sha) => this.media.get(sha)),
    });
  }
  private recoveryAction(row: JobRow): NonNullable<GenerationJob['recoveryAction']> {
    if (!['failed', 'paused', 'download_failed', 'submit_unknown'].includes(row.status))
      return 'none';
    if (row.rawResponse?.length) return 'download';
    if (
      !row.snapshot ||
      ![1, 2].includes(row.snapshot.version) ||
      row.errorCode === 'UPLOAD_UNKNOWN'
    )
      return 'none';
    if (row.remoteTaskId) return this.registry.get(row.profile.protocol).query ? 'query' : 'none';
    if (this.channels.isRetired(row.channelModelId)) return 'none';
    if (row.status === 'submit_unknown')
      return executionContract(row.snapshot.connection, row.profile).idempotency
        ? 'idempotent_submit'
        : 'none';
    return row.status === 'paused' ? 'prepare' : 'new_job';
  }
  list(): GenerationJob[] {
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
  async create(input: GenerationRequest): Promise<GenerationJob> {
    const request = GenerationRequest.parse(input);
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
  private async createAt(request: GenerationRequest, root?: string): Promise<GenerationJob> {
    const model = this.channels.getModel(request.modelId);
    if (!model.enabled || !this.channels.getChannel(model.channelId).enabled)
      throw new DomainError('MODEL_DISABLED', 422, '渠道或模型已禁用');
    const profile = mediaProfile(model);
    const runtime = executionContract(model.connection, profile);
    const definition = this.catalog
      .get()
      .definitions.find((item) => item.id === model.definitionId);
    if (request.imageEdit?.operation === 'emotion') {
      const recipe = request.imageEdit;
      const issue = checkGenerationRequest(profile, {
        ...request,
        imageEdit: { ...recipe, maskMode: 'local' },
        inputs: [{ kind: 'image', role: 'reference', sha256: recipe.source.sha256 }],
      }).find((item) => item.field === 'imageEdit');
      if (issue) throw new DomainError('INVALID_GENERATION_REQUEST', 422, issue.message);
      const source = await this.media.resolveAt(recipe.source.sha256, root);
      const prepared = await emotionArtifacts(await readFile(source.path), recipe.targetFace);
      if (source.media.width !== recipe.imageWidth || source.media.height !== recipe.imageHeight)
        throw new DomainError('INVALID_REFERENCE', 422, '源图片尺寸已变化，请重新选择人脸');
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
      const mask = profile.imageEditCapabilities?.mask
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
      request.inputs = [
        { kind: 'image', role: 'reference', sha256: crop.sha256 },
        { kind: 'image', role: 'reference', sha256: identity.sha256 },
        ...(mask
          ? [{ kind: 'image' as const, role: 'reference' as const, sha256: mask.sha256 }]
          : []),
      ];
    }
    const issues = checkGenerationRequest(profile, request);
    if (issues.length)
      throw new DomainError(
        'INVALID_GENERATION_REQUEST',
        422,
        issues.map((issue) => issue.message).join('；'),
      );
    // 提交前验证凭据；不让密钥故障变成提交结果不明。
    this.channels.credentials(model.connection?.credentialRef ?? model.channelId);
    this.registry.get(profile.protocol);
    if (
      !['provider-file', 'file'].includes(runtime.upload) &&
      request.inputs.some(
        (item) =>
          item.kind !== 'image' ||
          profile.inputs.find((limit) => limit.kind === item.kind)?.transport === 'url',
      )
    )
      this.storage.require();
    request.params = Object.fromEntries(
      profile.params.map((param) => [param.key, request.params[param.key] ?? param.default]),
    );
    if (
      profile.kind === 'tts' &&
      !String(request.params.voice ?? request.params.voice_id ?? '').trim()
    )
      throw new DomainError('VOICE_REQUIRED', 422, '请选择或填写音色 ID');
    for (const item of request.inputs) {
      const stored = item.sha256
        ? (await this.media.resolveAt(item.sha256, root)).media
        : await this.media.saveStream(
            [Buffer.from(item.dataUrl!.split(',')[1], 'base64')],
            undefined,
            item.kind,
            undefined,
            root,
          );
      if (root) await this.media.adoptAt(root, [stored.sha256]);
      item.sha256 = stored.sha256;
      delete item.dataUrl;
    }
    if (request.imageEdit) {
      const source = await this.media.resolveAt(request.imageEdit.source.sha256, root);
      if (
        request.imageEdit.operation === 'emotion' &&
        (source.media.width !== request.imageEdit.imageWidth ||
          source.media.height !== request.imageEdit.imageHeight)
      )
        throw new DomainError('INVALID_REFERENCE', 422, '编辑配方的源图片尺寸已变化');
      if (root) await this.media.adoptAt(root, [source.media.sha256]);
    }
    const mediaIssues = checkGenerationMedia(
      profile,
      request.inputs.map((input) => {
        const stored = this.media.get(input.sha256!);
        return {
          input,
          media: { ...stored, fps: stored.fps ?? null, codec: stored.codec ?? null },
        };
      }),
    );
    if (mediaIssues.length)
      throw new DomainError(
        'INVALID_REFERENCE',
        422,
        mediaIssues.map((issue) => issue.message).join('；'),
      );
    if (profile.protocol === 'openai-videos' && request.inputs.length && request.params.size) {
      const first = this.media.get(request.inputs[0].sha256!);
      if (`${first.width}x${first.height}` !== request.params.size)
        throw new DomainError('INVALID_REFERENCE', 422, '首帧尺寸必须与输出尺寸一致');
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .insert(generationJobs)
      .values({
        id,
        kind: profile.kind,
        channelModelId: model.id,
        profileId: profile.id,
        profile: {
          ...profile,
          runtime: {
            ...profile.runtime,
            concurrency: Math.min(
              model.overrides.concurrency ?? profile.runtime.concurrency,
              profile.runtime.concurrency,
              runtime.concurrency,
            ),
          },
        },
        status: 'pending',
        diagnostic: { stage: 'validation', method: 'LOCAL', route: '' },
        request,
        snapshot: {
          version: 2,
          definitionId: model.definitionId,
          connectionId: model.connectionId,
          definitionVersion: definition?.version,
          capabilityVersion: definition?.capabilityVersion,
          adapterVersion: 'v1',
          requestVersion: 'v1',
          configVersion: this.channels.modelVersion(model.id),
          channelId: model.channelId,
          credentialFingerprint: this.channels.credentialFingerprint(
            model.connection?.credentialRef ?? model.channelId,
          ),
          baseUrl: this.channels.getChannel(model.channelId).baseUrl,
          model: model.upstreamModelId,
          connection: {
            ...model.connection,
            runtime,
            baseUrl:
              model.connection?.baseUrl ??
              (profile.protocol === 'minimax-video-v2'
                ? this.channels.getChannel(model.channelId).baseUrl.replace(/\/v1\/?$/, '')
                : this.channels.getChannel(model.channelId).baseUrl),
            routes: { ...serviceRoutes[profile.protocol], ...model.connection?.routes },
          },
          idempotencyKey: id,
          referenceUrls: {},
        },
        projectId: request.projectId ?? null,
        pageId: request.pageId ?? null,
        outputs: [],
        source: request.source,
        createdAt: now,
        updatedAt: now,
        deadlineAt: new Date(Date.now() + profile.runtime.timeoutMs).toISOString(),
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
      throw new DomainError('JOB_BUSY', 409, '请先本地放弃任务，再删除记录；删除不会取消远端任务');
    if (row.stagedOutputs.length)
      throw new DomainError(
        'PROJECT_OFFLINE',
        409,
        '任务包含离线项目的暂存产物，请恢复项目并写回后再删除记录',
      );
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
    this.channels.cleanupRetired();
    return this.get(id);
  }
  async cancelRemote(id: string) {
    if (this.cancelling.has(id)) throw new DomainError('CANCEL_PENDING', 409, '取消请求正在处理中');
    const row = this.row(id);
    const runtime = executionContract(row.snapshot?.connection, row.profile);
    const route = row.snapshot?.connection.routes?.cancel;
    if (
      !row.snapshot ||
      !row.remoteTaskId ||
      !runtime.cancel ||
      !route ||
      !['running', 'paused'].includes(row.status)
    )
      throw new DomainError(
        'CANCEL_UNAVAILABLE',
        422,
        '当前任务或接入不支持远端取消；可选择本地放弃',
      );
    const ctx = this.context(row, AbortSignal.timeout(15_000));
    this.cancelling.add(id);
    this.active.get(id)?.controller.abort();
    await this.active.get(id)?.promise;
    if (this.row(id).status === 'cancelled') {
      this.cancelling.delete(id);
      return this.get(id);
    }
    this.update(id, {
      status: 'paused',
      nextPollAt: null,
      snapshot: { ...row.snapshot, cancellation: 'requested' },
      errorMessage: '正在请求远端取消',
    });
    try {
      const response = await adapterFetch(
        ctx,
        resolveServiceUrl(ctx.connection!.baseUrl ?? ctx.baseUrl, route, { id: row.remoteTaskId }),
        {
          method: 'POST',
          redirect: 'error',
          signal: ctx.signal,
          headers: { ...ctx.headers, Authorization: `Bearer ${ctx.apiKey}` },
        },
        'cancel',
      );
      const body: unknown = response.status === 204 ? null : await response.json();
      if (this.row(id).status === 'cancelled') return this.get(id);
      const confirmed =
        response.ok &&
        !!body &&
        typeof body === 'object' &&
        'status' in body &&
        body.status === 'cancelled';
      this.update(id, {
        status: confirmed ? 'cancelled' : 'paused',
        finishedAt: confirmed ? new Date().toISOString() : null,
        snapshot: {
          ...row.snapshot,
          cancellation: confirmed ? 'confirmed' : response.ok ? 'requested' : 'unknown',
        },
        errorMessage: confirmed
          ? '远端已确认取消'
          : '取消请求未获确认；远端可能仍在运行，请查询确认',
      });
    } catch {
      if (this.row(id).status !== 'cancelled')
        this.update(id, {
          snapshot: { ...row.snapshot, cancellation: 'unknown' },
          errorMessage: '远端取消结果不明；请查询确认，不会自动重发取消',
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
        '该任务不能安全重发；请先核实供应商任务及原调用配置',
      );
    if (
      row.remoteTaskId ||
      row.rawResponse?.length ||
      row.status === 'paused' ||
      row.status === 'download_failed'
    )
      return this.requery(id);
    if (row.status === 'submit_unknown') {
      if (!row.snapshot || !executionContract(row.snapshot.connection, row.profile).idempotency)
        throw new DomainError(
          'UNSAFE_RESUBMIT',
          409,
          '提交结果不明，不能安全重发；请先向供应商确认',
        );
      this.update(id, {
        status: 'pending',
        nextPollAt: null,
        deadlineAt: new Date(Date.now() + row.profile.runtime.timeoutMs).toISOString(),
        finishedAt: null,
      });
      return this.get(id);
    }
    if (!['submit_unknown', 'failed', 'cancelled'].includes(row.status))
      throw new DomainError('INVALID_JOB_STATE', 409, '只能重新提交失败、放弃或结果不明的任务');
    return this.create(row.request);
  }
  requery(id: string) {
    const row = this.row(id);
    if (
      row.status === 'paused' &&
      row.snapshot &&
      !row.remoteTaskId &&
      !row.rawResponse?.length &&
      row.errorCode !== 'UPLOAD_UNKNOWN'
    ) {
      if (this.channels.isRetired(row.channelModelId))
        throw new DomainError('VIDEO_MODEL_RETIRED', 422, '旧型号只可查询或下载，不能继续提交');
      this.context(row, new AbortController().signal);
      this.update(id, {
        status: 'pending',
        nextPollAt: null,
        finishedAt: null,
        deadlineAt: new Date(Date.now() + row.profile.runtime.timeoutMs).toISOString(),
      });
      return this.get(id);
    }
    if (
      (!row.rawResponse?.length &&
        (!row.remoteTaskId || !this.registry.get(row.profile.protocol).query)) ||
      !['failed', 'submit_unknown', 'paused', 'download_failed'].includes(row.status)
    )
      throw new DomainError('QUERY_UNAVAILABLE', 422, '该任务没有可重新查询的远端任务');
    this.update(id, {
      status: row.rawResponse?.length ? 'downloading' : 'running',
      nextPollAt: null,
      attempts: 0,
      errorCategory: null,
      errorCode: null,
      errorMessage: null,
      finishedAt: null,
      deadlineAt: new Date(Date.now() + row.profile.runtime.timeoutMs).toISOString(),
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
        errorMessage: '提交时引擎退出，请确认是否重新提交',
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
    const quotas = (row: JobRow): [string, number][] => [
      [`model:${row.channelModelId}`, row.profile.runtime.concurrency],
      [`channel:${row.snapshot?.channelId ?? row.channelModelId}`, 2],
      [
        `connection:${row.snapshot?.connection.credentialRef ?? row.snapshot?.channelId}:${row.snapshot?.connectionId ?? row.snapshot?.connection.baseUrl ?? row.channelModelId}`,
        executionContract(row.snapshot?.connection, row.profile).concurrency,
      ],
    ];
    const limits = new Map<string, number>();
    for (const row of rows)
      for (const [key, limit] of quotas(row))
        limits.set(key, Math.min(limits.get(key) ?? limit, limit));
    for (const row of rows)
      if (activeStates.includes(row.status))
        for (const [key] of quotas(row)) counts.set(key, (counts.get(key) ?? 0) + 1);
    for (const row of rows) {
      if (
        this.active.has(row.id) ||
        this.cancelling.has(row.id) ||
        (row.nextPollAt && Date.parse(row.nextPollAt) > Date.now())
      )
        continue;
      if (row.status === 'pending') {
        if (quotas(row).some(([key]) => (counts.get(key) ?? 0) >= limits.get(key)!)) continue;
        for (const [key] of quotas(row)) counts.set(key, (counts.get(key) ?? 0) + 1);
        this.update(row.id, { status: 'submitting', attempts: row.attempts + 1, nextPollAt: null });
      }
      const controller = new AbortController();
      const promise = this.execute(this.row(row.id), controller.signal).finally(() =>
        this.active.delete(row.id),
      );
      this.active.set(row.id, { controller, promise });
    }
  }
  private context(row: JobRow, signal: AbortSignal): AdapterContext {
    const snapshot = row.snapshot;
    if (
      !snapshot ||
      ![1, 2].includes(snapshot.version) ||
      (snapshot.version === 2 &&
        (snapshot.adapterVersion !== 'v1' || snapshot.requestVersion !== 'v1'))
    )
      throw new GenerationFailure(
        'invalid_params',
        'LEGACY_SNAPSHOT_MISSING',
        '旧任务缺少历史调用配置，已暂停；请核实供应商任务后处理',
      );
    let credentials: ReturnType<ChannelsRepository['credentials']>;
    try {
      if (!this.channels.getChannel(snapshot.channelId).enabled) throw new Error('渠道已禁用');
      credentials = this.channels.credentials(
        snapshot.connection.credentialRef ?? snapshot.channelId,
      );
    } catch {
      throw new GenerationFailure(
        'invalid_params',
        'MODEL_DISABLED',
        '原渠道凭据不可用；恢复原渠道后再继续',
      );
    }
    const { channel, apiKey, headers } = credentials;
    if (
      !channel.enabled ||
      !apiKey ||
      this.channels.credentialFingerprint(
        snapshot.connection.credentialRef ?? snapshot.channelId,
      ) !== snapshot.credentialFingerprint
    )
      throw new GenerationFailure(
        'invalid_params',
        'MODEL_DISABLED',
        '原渠道已禁用、凭据缺失或凭据已更换；恢复原凭据后再继续',
      );
    return {
      baseUrl: snapshot.baseUrl.replace(/\/+$/, ''),
      apiKey,
      headers,
      model: snapshot.model,
      profile: row.profile,
      connection: snapshot.connection,
      ...(executionContract(snapshot.connection, row.profile).idempotency
        ? { idempotencyKey: snapshot.idempotencyKey }
        : {}),
      signal,
      stage: row.status === 'running' ? 'query' : 'submit',
      diagnose: (diagnostic) => this.update(row.id, { diagnostic }),
    };
  }
  private async providerReference(row: JobRow, ctx: AdapterContext, sha256: string) {
    const target = resolveServiceUrl(
      ctx.connection?.baseUrl ?? ctx.baseUrl,
      ctx.connection?.routes?.upload ?? 'api/v1/uploads',
    );
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          sha256,
          target,
          row.snapshot!.connectionId ?? null,
          row.snapshot!.credentialFingerprint,
        ]),
      )
      .digest('hex');
    const inflight = this.uploads.get(key);
    if (inflight) return inflight;
    const promise = this.uploadReference(row, ctx, sha256, key, target).finally(() =>
      this.uploads.delete(key),
    );
    this.uploads.set(key, promise);
    return promise;
  }
  private async uploadReference(
    row: JobRow,
    ctx: AdapterContext,
    sha256: string,
    key: string,
    target: string,
  ) {
    const previous = this.db
      .select()
      .from(providerUploads)
      .where(eq(providerUploads.key, key))
      .get();
    if (previous) {
      if (previous.status !== 'ready')
        throw new GenerationFailure(
          'unknown',
          'UPLOAD_UNKNOWN',
          '素材上传结果待确认；为避免重复上传，已暂停',
        );
      if (previous.expiresAt && Date.parse(previous.expiresAt) > Date.now()) return previous.url!;
      this.db.delete(providerUploads).where(eq(providerUploads.key, key)).run();
    }
    const { media, path } = await this.media.resolve(sha256, row.projectId ?? undefined);
    const form = new FormData();
    form.set(
      'file',
      new Blob([await readFile(path)], { type: media.mime }),
      `${sha256}.${media.ext}`,
    );
    this.db.insert(providerUploads).values({ key, status: 'uploading' }).run();
    try {
      const response = await adapterFetch(
        ctx,
        target,
        {
          method: 'POST',
          redirect: 'error',
          signal: ctx.signal,
          headers: { ...ctx.headers, Authorization: `Bearer ${ctx.apiKey}` },
          body: form,
        },
        'upload',
      );
      const json = (await imageResponse(response)) as {
        url?: string;
        expires_at?: string;
        data?: { url?: string; expires_at?: string };
      };
      const data = json.data ?? json;
      const url = await publicReference(data.url ?? '');
      const maxExpiry = Date.now() + executionContract(ctx.connection, row.profile).uploadReuseMs;
      const expiresAt = new Date(
        Math.min(maxExpiry, data.expires_at ? Date.parse(data.expires_at) : maxExpiry),
      ).toISOString();
      if (expiresAt && Date.parse(expiresAt) <= Date.now()) throw new Error('素材已过期');
      this.db
        .update(providerUploads)
        .set({ status: 'ready', url, expiresAt })
        .where(eq(providerUploads.key, key))
        .run();
      return url;
    } catch {
      this.db
        .update(providerUploads)
        .set({ status: 'unknown' })
        .where(eq(providerUploads.key, key))
        .run();
      throw new GenerationFailure(
        'unknown',
        'UPLOAD_UNKNOWN',
        '素材上传结果或返回地址无效，已暂停；请向供应商确认',
      );
    }
  }
  private async execute(row: JobRow, signal: AbortSignal) {
    try {
      if (
        this.channels.isRetired(row.channelModelId) &&
        !row.remoteTaskId &&
        !row.rawResponse?.length
      )
        throw new GenerationFailure(
          'invalid_params',
          'VIDEO_MODEL_RETIRED',
          '旧型号已退出，只允许查询、下载或本地放弃；不会重新提交',
        );
      if (Date.now() > Date.parse(row.deadlineAt) && row.status !== 'downloading')
        throw new GenerationFailure('timeout', 'WAIT_TIMEOUT', '等待超时，可尝试重新查询');
      const adapter = this.registry.get(row.profile.protocol);
      if (row.status === 'downloading') {
        if (!row.rawResponse?.length)
          throw new GenerationFailure('upstream', 'MISSING_OUTPUT', '缺少下载记录');
        const outputs: string[] = [...row.outputs];
        const completed = new Set(row.snapshot?.completedDownloads ?? []);
        const stagedOutputs = new Set(row.stagedOutputs);
        const emotionEdit =
          row.request.imageEdit?.operation === 'emotion' ? row.request.imageEdit : undefined;
        const persistedIntermediate = row.snapshot?.imageEditPostProcess?.intermediateSha256;
        if (emotionEdit && persistedIntermediate) completed.add(0);
        const record = (media: { sha256: string }, staged: boolean, index: number) => {
          if (!emotionEdit) outputs.push(media.sha256);
          completed.add(index);
          if (staged && !emotionEdit) stagedOutputs.add(media.sha256);
          else stagedOutputs.delete(media.sha256);
          this.update(row.id, {
            outputs: emotionEdit ? row.outputs : [...new Set([...row.outputs, ...outputs])],
            stagedOutputs: [...stagedOutputs],
            ...(row.snapshot
              ? {
                  snapshot: {
                    ...row.snapshot,
                    completedDownloads: [...completed],
                    ...(emotionEdit
                      ? {
                          imageEditPostProcess: {
                            ...row.snapshot.imageEditPostProcess,
                            intermediateSha256: media.sha256,
                          },
                        }
                      : {}),
                  },
                }
              : {}),
          });
        };
        for (const [index, output] of row.rawResponse.entries()) {
          if (completed.has(index)) continue;
          const recordOutput = (media: { sha256: string }, staged: boolean) => {
            record(media, staged, index);
          };
          if (output.providerContent) {
            if (!adapter.contentUrl)
              throw new GenerationFailure(
                'upstream',
                'INVALID_CONTENT_ENDPOINT',
                '内容下载协议不匹配',
              );
            const ctx = this.context(row, signal);
            await this.media.save(
              {
                ...output,
                url: adapter.contentUrl(ctx, output.providerContent),
              },
              signal,
              executionContract(ctx.connection, row.profile).downloadAuth === 'content'
                ? { ...ctx.headers, Authorization: `Bearer ${ctx.apiKey}` }
                : undefined,
              row.projectId ?? undefined,
              recordOutput,
              (diagnostic) => this.update(row.id, { diagnostic }),
              ctx.connection?.baseUrl ?? ctx.baseUrl,
            );
          } else
            await this.media.save(
              output,
              signal,
              undefined,
              row.projectId ?? undefined,
              recordOutput,
              (diagnostic) => this.update(row.id, { diagnostic }),
              row.snapshot?.connection.baseUrl ?? row.snapshot?.baseUrl,
            );
        }
        if (signal.aborted || this.row(row.id).status === 'cancelled') return;
        if (emotionEdit) {
          const intermediate = this.row(row.id).snapshot?.imageEditPostProcess?.intermediateSha256;
          if (!intermediate)
            throw new GenerationFailure('upstream', 'MISSING_EDIT_OUTPUT', '缺少表情编辑中间图');
          const alreadyFinal = this.row(row.id).snapshot?.imageEditPostProcess?.finalSha256;
          if (alreadyFinal) {
            this.update(row.id, {
              status: 'succeeded',
              outputs: [alreadyFinal],
              stagedOutputs: [],
              rawResponse: null,
              nextPollAt: null,
              errorCategory: null,
              errorCode: null,
              errorMessage: null,
              finishedAt: new Date().toISOString(),
            });
            return;
          }
          const source = await this.media.resolveAt(
            emotionEdit.source.sha256,
            row.projectId ? await this.files.root(row.projectId).catch(() => undefined) : undefined,
          );
          const generated = await this.media.resolveAt(
            intermediate,
            row.projectId ? await this.files.root(row.projectId).catch(() => undefined) : undefined,
          );
          const final = await compositeEmotion(
            await readFile(source.path),
            await readFile(generated.path),
            emotionEdit.editRegion,
            emotionEdit.targetFace,
          );
          {
            const finalMedia = await this.media.saveStream(
              [final],
              signal,
              'image',
              'image/png',
              row.projectId
                ? await this.files.root(row.projectId).catch(() => undefined)
                : undefined,
            );
            outputs.push(finalMedia.sha256);
            const latest = this.row(row.id);
            this.update(row.id, {
              outputs: [finalMedia.sha256],
              snapshot: latest.snapshot
                ? {
                    ...latest.snapshot,
                    imageEditPostProcess: {
                      intermediateSha256: intermediate,
                      finalSha256: finalMedia.sha256,
                    },
                  }
                : null,
            });
          }
        }
        this.update(row.id, {
          status: 'succeeded',
          outputs: emotionEdit
            ? [this.row(row.id).snapshot?.imageEditPostProcess?.finalSha256 ?? outputs.at(-1)!]
            : [...new Set(outputs)],
          stagedOutputs: emotionEdit
            ? []
            : [...stagedOutputs].filter((hash) => outputs.includes(hash)),
          rawResponse: null,
          nextPollAt: null,
          errorCategory: null,
          errorCode: null,
          errorMessage: null,
          finishedAt: new Date().toISOString(),
        });
        if (row.snapshot?.configVersion)
          this.channels.recordMediaCheck(row.channelModelId, {
            jobId: row.id,
            mode: row.request.mode,
            checkedAt: new Date().toISOString(),
            configVersion: row.snapshot.configVersion,
            definitionVersion: row.snapshot.definitionVersion,
            capabilityVersion: row.snapshot.capabilityVersion,
          });
        return;
      }
      const context = this.context(
        row,
        AbortSignal.any([signal, AbortSignal.timeout(row.profile.runtime.submitTimeoutMs)]),
      );
      let result: AdapterResult;
      if (row.status === 'running') {
        if (!adapter.query || !row.remoteTaskId)
          throw new GenerationFailure('upstream', 'QUERY_UNAVAILABLE', '协议不支持查询');
        result = await adapter.query(context, row.remoteTaskId);
      } else {
        const request: GenerationRequest = structuredClone(
          row.snapshot?.preparedRequest ?? row.request,
        );
        // 已提交的不确定请求必须保持原素材 URL；尚未形成请求则重新检查缓存有效期。
        context.referenceUrls = row.snapshot?.preparedRequest
          ? { ...row.snapshot.referenceUrls }
          : {};
        let inlineBytes = 0;
        for (const item of request.inputs) {
          const limit = row.profile.inputs.find((entry) => entry.kind === item.kind)!;
          const upload = executionContract(context.connection, row.profile).upload;
          if (upload === 'provider-file')
            context.referenceUrls[item.sha256!] ??= await this.providerReference(
              row,
              context,
              item.sha256!,
            );
          else if (
            upload !== 'file' &&
            (upload === 'url' || limit.transport === 'url' || item.kind !== 'image')
          )
            context.referenceUrls[item.sha256!] ??= await this.storage.reference(
              this.media.get(item.sha256!),
              context.signal,
              row.projectId ?? undefined,
            );
          else {
            inlineBytes += Math.ceil(this.media.get(item.sha256!).bytes / 3) * 4;
            if (inlineBytes > 63 * 1024 * 1024)
              throw new GenerationFailure(
                'invalid_params',
                'INLINE_TOO_LARGE',
                '内联素材合计过大，请减少参考图',
              );
            item.dataUrl = await this.media.inline(item.sha256!, row.projectId ?? undefined);
          }
        }
        if (row.snapshot)
          this.update(row.id, {
            snapshot: {
              ...row.snapshot,
              referenceUrls: context.referenceUrls,
              preparedRequest: {
                ...request,
                inputs: request.inputs.map((item) => ({ ...item, dataUrl: undefined })),
              },
            },
          });
        // 到这一步之前失败能确认没有提交；此后异常一律按是否明确未受理分类。
        try {
          result = await adapter.submit(context, request);
        } catch (error) {
          if (error instanceof GenerationFailure) throw error;
          const code =
            error instanceof Error &&
            error.cause &&
            typeof error.cause === 'object' &&
            'code' in error.cause
              ? String(error.cause.code)
              : '';
          const notSent = [
            'ENOTFOUND',
            'EAI_AGAIN',
            'ECONNREFUSED',
            'UND_ERR_CONNECT_TIMEOUT',
          ].includes(code);
          throw new GenerationFailure(
            'network',
            notSent ? code : 'SUBMIT_UNKNOWN',
            '无法确认远端是否受理，请谨慎重新提交',
            notSent,
            !notSent,
          );
        }
      }
      if (signal.aborted || this.row(row.id).status === 'cancelled') return;
      if (result.status === 'failed') {
        this.update(row.id, {
          status: 'failed',
          remoteStatus: 'failed',
          errorCategory: result.category,
          errorCode: result.code,
          errorMessage: result.message,
          nextPollAt: null,
          finishedAt: new Date().toISOString(),
        });
        return;
      }
      if (result.status === 'running') {
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
      } else {
        this.update(row.id, {
          status: 'downloading',
          remoteTaskId:
            row.remoteTaskId ??
            result.outputs.find((output) => output.providerContent)?.providerContent ??
            null,
          rawResponse: result.outputs,
          // 查询刷新可能改变产物顺序和签名；旧索引不能用于跳过新列表，已归档资产按哈希去重。
          ...(row.rawResponse?.length && row.snapshot
            ? { snapshot: { ...row.snapshot, completedDownloads: [] } }
            : {}),
          usage: result.usage ?? null,
          attempts: 0,
          nextPollAt: null,
          errorCategory: null,
          errorCode: null,
          errorMessage: null,
        });
      }
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
      if (
        (row.status === 'downloading' && failure.category !== 'invalid_params') ||
        (row.status === 'running' &&
          failure.category !== 'invalid_params' &&
          failure.code !== 'WAIT_TIMEOUT') ||
        failure.safeRetry
      ) {
        if (Date.now() < Date.parse(row.deadlineAt)) {
          const expired =
            row.status === 'downloading' &&
            row.remoteTaskId &&
            this.registry.get(row.profile.protocol).query &&
            ['DOWNLOAD_401', 'DOWNLOAD_403', 'DOWNLOAD_404', 'DOWNLOAD_410'].includes(failure.code);
          this.update(row.id, {
            status: expired ? 'running' : row.status === 'submitting' ? 'pending' : row.status,
            attempts: row.attempts + 1,
            nextPollAt: this.nextPoll(row),
            errorCategory: failure.category,
            errorCode: failure.code,
            errorMessage: failure.message,
          });
          return;
        }
      }
      const paused =
        failure.code === 'WAIT_TIMEOUT' ||
        failure.code === 'UPLOAD_UNKNOWN' ||
        (failure.category === 'invalid_params' && !!row.remoteTaskId) ||
        ['MODEL_DISABLED', 'LEGACY_SNAPSHOT_MISSING', 'CHANNEL_NOT_FOUND'].includes(failure.code);
      const status = paused
        ? 'paused'
        : row.status === 'downloading'
          ? 'download_failed'
          : row.status === 'submitting' && failure.uncertain
            ? 'submit_unknown'
            : 'failed';
      this.update(row.id, {
        status,
        errorCategory: failure.category,
        errorCode: failure.code,
        errorMessage: failure.message,
        nextPollAt: null,
        finishedAt: new Date().toISOString(),
      });
    }
  }
  private nextPoll(row: JobRow): string {
    const delay = Math.min(
      row.profile.runtime.pollMaxMs,
      row.profile.runtime.pollInitialMs * 2 ** Math.min(row.attempts, 10),
    );
    return new Date(Date.now() + delay).toISOString();
  }
}

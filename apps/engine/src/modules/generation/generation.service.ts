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
} from './adapters/video-tasks.js';
import { openaiImages } from './adapters/openai-images.js';
import { arkImages } from './adapters/ark-images.js';
import { geminiImage } from './adapters/gemini-image.js';
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
      recoveryAction: this.recoveryAction(row),
      outputs: row.outputs.map((sha) => this.media.get(sha)),
    });
  }
  private recoveryAction(row: JobRow): NonNullable<GenerationJob['recoveryAction']> {
    if (!['failed', 'paused', 'download_failed', 'submit_unknown'].includes(row.status))
      return 'none';
    if (row.rawResponse?.length) return 'download';
    if (!row.snapshot || row.snapshot.version !== 1 || row.errorCode === 'UPLOAD_UNKNOWN')
      return 'none';
    if (row.remoteTaskId) return this.registry.get(row.profile.protocol).query ? 'query' : 'none';
    if (row.status === 'submit_unknown')
      return row.profile.protocol === 'fastaitoken-video' ? 'idempotent_submit' : 'none';
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
    if (
      profile.protocol === 'fastaitoken-video' &&
      Buffer.byteLength(request.prompt, 'utf8') > 16_384
    )
      throw new DomainError('INVALID_GENERATION_REQUEST', 422, 'FastAIToken 提示词不能超过 16 KiB');
    if (profile.protocol === 'minimax-video-v2' && request.prompt.length > 7000)
      throw new DomainError('INVALID_GENERATION_REQUEST', 422, 'H3 提示词不能超过 7000 字符');
    const issues = checkGenerationRequest(profile, request);
    if (issues.length)
      throw new DomainError(
        'INVALID_GENERATION_REQUEST',
        422,
        issues.map((issue) => issue.message).join('；'),
      );
    // 提交前验证凭据；不让密钥故障变成提交结果不明。
    this.channels.credentials(model.channelId);
    this.registry.get(profile.protocol);
    if (
      profile.protocol !== 'fastaitoken-video' &&
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
      const limit = profile.inputs.find((entry) => entry.kind === item.kind)!;
      if (
        !stored.mime.startsWith(item.kind + '/') ||
        !limit.mimeTypes.includes(stored.mime) ||
        stored.bytes > limit.maxBytes ||
        (limit.minDurationMs !== undefined && (stored.durationMs ?? 0) < limit.minDurationMs) ||
        (limit.maxDurationMs !== undefined &&
          (stored.durationMs ?? Infinity) > limit.maxDurationMs) ||
        (limit.minFps !== undefined && (stored.fps ?? 0) < limit.minFps) ||
        (limit.maxFps !== undefined && (stored.fps ?? Infinity) > limit.maxFps) ||
        (limit.codecs !== undefined && !limit.codecs.includes(stored.codec ?? '')) ||
        (limit.audioCodecs !== undefined &&
          !!stored.audioCodec &&
          !limit.audioCodecs.includes(stored.audioCodec)) ||
        (limit.minRatio !== undefined &&
          (stored.width ?? 0) / (stored.height ?? 1) < limit.minRatio) ||
        (limit.maxRatio !== undefined &&
          (stored.width ?? Infinity) / (stored.height ?? 1) > limit.maxRatio) ||
        (stored.width !== null &&
          ((limit.minWidth !== undefined && stored.width < limit.minWidth) ||
            (limit.maxWidth !== undefined && stored.width > limit.maxWidth))) ||
        (stored.height !== null &&
          ((limit.minHeight !== undefined && stored.height < limit.minHeight) ||
            (limit.maxHeight !== undefined && stored.height > limit.maxHeight)))
      )
        throw new DomainError(
          'INVALID_REFERENCE',
          422,
          '参考素材格式、大小、尺寸、时长、帧率或编码不符合档案',
        );
      item.sha256 = stored.sha256;
      delete item.dataUrl;
    }
    for (const limit of profile.inputs) {
      const duration = request.inputs
        .filter((item) => item.kind === limit.kind)
        .reduce((sum, item) => sum + (this.media.get(item.sha256!).durationMs ?? 0), 0);
      if (limit.maxTotalDurationMs !== undefined && duration > limit.maxTotalDurationMs)
        throw new DomainError('INVALID_REFERENCE', 422, '参考素材总时长超过档案上限');
    }
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
            concurrency: model.overrides.concurrency ?? profile.runtime.concurrency,
          },
        },
        status: 'pending',
        diagnostic: { stage: 'validation', method: 'LOCAL', route: '' },
        request,
        snapshot: {
          version: 1,
          channelId: model.channelId,
          credentialFingerprint: this.channels.credentialFingerprint(model.channelId),
          baseUrl: this.channels.getChannel(model.channelId).baseUrl,
          model: model.upstreamModelId,
          connection: {
            ...model.connection,
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
  cancel(id: string) {
    const row = this.row(id);
    if (['succeeded', 'failed', 'cancelled'].includes(row.status)) return this.get(id);
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
      if (!row.snapshot || row.profile.protocol !== 'fastaitoken-video')
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
    for (const row of rows)
      if (activeStates.includes(row.status))
        counts.set(row.channelModelId, (counts.get(row.channelModelId) ?? 0) + 1);
    for (const row of rows) {
      if (this.active.has(row.id) || (row.nextPollAt && Date.parse(row.nextPollAt) > Date.now()))
        continue;
      if (row.status === 'pending') {
        const count = counts.get(row.channelModelId) ?? 0;
        if (count >= row.profile.runtime.concurrency) continue;
        counts.set(row.channelModelId, count + 1);
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
    if (!snapshot || snapshot.version !== 1)
      throw new GenerationFailure(
        'invalid_params',
        'LEGACY_SNAPSHOT_MISSING',
        '旧任务缺少历史调用配置，已暂停；请核实供应商任务后处理',
      );
    let credentials: ReturnType<ChannelsRepository['credentials']>;
    try {
      credentials = this.channels.credentials(snapshot.channelId);
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
      this.channels.credentialFingerprint(snapshot.channelId) !== snapshot.credentialFingerprint
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
      ...(row.profile.protocol === 'fastaitoken-video'
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
      .update(JSON.stringify([sha256, target, row.snapshot!.credentialFingerprint]))
      .digest('hex');
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
      if (!previous.expiresAt || Date.parse(previous.expiresAt) > Date.now()) return previous.url!;
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
      const expiresAt = data.expires_at ? new Date(data.expires_at).toISOString() : null;
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
      if (Date.now() > Date.parse(row.deadlineAt) && row.status !== 'downloading')
        throw new GenerationFailure('timeout', 'WAIT_TIMEOUT', '等待超时，可尝试重新查询');
      const adapter = this.registry.get(row.profile.protocol);
      if (row.status === 'downloading') {
        if (!row.rawResponse?.length)
          throw new GenerationFailure('upstream', 'MISSING_OUTPUT', '缺少下载记录');
        const outputs: string[] = [];
        const stagedOutputs = new Set(row.stagedOutputs);
        const record = (media: { sha256: string }, staged: boolean) => {
          outputs.push(media.sha256);
          if (staged) stagedOutputs.add(media.sha256);
          else stagedOutputs.delete(media.sha256);
          this.update(row.id, {
            outputs: [...new Set([...row.outputs, ...outputs])],
            stagedOutputs: [...stagedOutputs],
          });
        };
        for (const output of row.rawResponse) {
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
              { ...ctx.headers, Authorization: `Bearer ${ctx.apiKey}` },
              row.projectId ?? undefined,
              record,
              (diagnostic) => this.update(row.id, { diagnostic }),
            );
          } else
            await this.media.save(
              output,
              signal,
              undefined,
              row.projectId ?? undefined,
              record,
              (diagnostic) => this.update(row.id, { diagnostic }),
            );
        }
        if (signal.aborted || this.row(row.id).status === 'cancelled') return;
        this.update(row.id, {
          status: 'succeeded',
          outputs,
          stagedOutputs: [...stagedOutputs].filter((hash) => outputs.includes(hash)),
          rawResponse: null,
          nextPollAt: null,
          errorCategory: null,
          errorCode: null,
          errorMessage: null,
          finishedAt: new Date().toISOString(),
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
        const request: GenerationRequest = structuredClone(row.request);
        context.referenceUrls = { ...row.snapshot?.referenceUrls };
        let inlineBytes = 0;
        for (const item of request.inputs) {
          const limit = row.profile.inputs.find((entry) => entry.kind === item.kind)!;
          if (row.profile.protocol === 'fastaitoken-video')
            context.referenceUrls[item.sha256!] ??= await this.providerReference(
              row,
              context,
              item.sha256!,
            );
          else if (limit.transport === 'url' || item.kind !== 'image')
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
            snapshot: { ...row.snapshot, referenceUrls: context.referenceUrls },
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

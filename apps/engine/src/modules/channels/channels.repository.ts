import { Injectable } from '@nestjs/common';
import { eq, inArray, isNull, and, notInArray } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  Channel,
  type ChannelWrite,
  type ChannelModelSave,
  type ChannelModelWrite,
  type ConnectionCheck,
  ModelDefaults,
  type ModelKind,
} from '@frame-loom/contracts';
import { DatabaseService } from '../../core/database/database.service.js';
import { SecretCipher } from '../../core/crypto/secret-cipher.js';
import { DomainError } from '../../core/http/domain-error.js';
import { channels, channelModels, modelDefaults } from './channels.schema.js';
import { ModelCatalogService } from './model-catalog.service.js';
import { mediaProfile } from '../generation/profiles/media-profiles.js';
import { executionContract } from '../generation/execution-contract.js';
import { generationJobs } from '../generation/generation.schema.js';
import { appMeta } from '../../core/database/app-meta.schema.js';

@Injectable()
export class ChannelsRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly cipher: SecretCipher,
    private readonly catalog: ModelCatalogService,
  ) {}
  private get db() {
    return this.database.db;
  }

  private publicChannel(row: typeof channels.$inferSelect): Channel {
    return Channel.parse({
      id: row.id,
      name: row.name,
      apiFormat: row.apiFormat,
      baseUrl: row.baseUrl,
      enabled: row.enabled,
      hasKey: row.apiKeyCipher !== null,
      keyHint: row.keyHint,
      headerNames: row.headerNames,
      lastCheck: row.lastCheck,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
  private channelRow(id: string) {
    const row = this.db.select().from(channels).where(eq(channels.id, id)).get();
    if (!row) throw new DomainError('CHANNEL_NOT_FOUND', 404, '渠道不存在');
    return row;
  }
  listChannels() {
    return this.db
      .select()
      .from(channels)
      .all()
      .map((row) => this.publicChannel(row));
  }
  getChannel(id: string) {
    return this.publicChannel(this.channelRow(id));
  }
  credentials(id: string) {
    const row = this.channelRow(id);
    return {
      channel: this.publicChannel(row),
      apiKey: row.apiKeyCipher ? this.cipher.decrypt(row.apiKeyCipher, 'channels', id) : '',
      headers: row.headersCipher
        ? z
            .record(z.string(), z.string())
            .parse(JSON.parse(this.cipher.decrypt(row.headersCipher, 'channel_headers', id)))
        : {},
    };
  }
  isRetired(id: string) {
    const row = this.db.select().from(channelModels).where(eq(channelModels.id, id)).get();
    return !row || !!row.retired;
  }
  private retainedJobs() {
    return this.db
      .select()
      .from(generationJobs)
      .where(notInArray(generationJobs.status, ['succeeded', 'cancelled']))
      .all()
      .filter(
        (row) =>
          row.status !== 'failed' ||
          !!row.rawResponse?.length ||
          (!!row.remoteTaskId && row.remoteStatus !== 'failed'),
      );
  }
  private protectChannel(id: string) {
    const models = this.db
      .select()
      .from(channelModels)
      .where(eq(channelModels.channelId, id))
      .all();
    if (
      this.retainedJobs().some(
        (job) =>
          job.snapshot?.channelId === id ||
          job.snapshot?.connection.credentialRef === id ||
          (!job.snapshot && models.some((model) => model.id === job.channelModelId)),
      )
    )
      throw new DomainError(
        'RECOVERY_REFERENCE',
        409,
        '历史任务仍需该渠道与凭据，请先恢复或本地放弃任务',
      );
  }
  retirementReport() {
    this.cleanupRetired();
    const report = this.db
      .select()
      .from(appMeta)
      .where(eq(appMeta.key, 'model_upgrade_report'))
      .get();
    const entries = z
      .array(
        z.object({
          id: z.string(),
          channelId: z.string(),
          name: z.string(),
          upstreamModelId: z.string(),
          reason: z.string(),
        }),
      )
      .parse(report ? JSON.parse(report.value) : []);
    const jobs = this.retainedJobs();
    const present = new Set(
      this.db
        .select({ id: channelModels.id })
        .from(channelModels)
        .all()
        .map((model) => model.id),
    );
    return entries.map((entry) => ({
      ...entry,
      bindingPresent: present.has(entry.id),
      tasks: jobs
        .filter((job) => job.channelModelId === entry.id)
        .map((job) => ({
          id: job.id,
          status: job.status,
          canRecover: !!job.snapshot && (!!job.remoteTaskId || !!job.rawResponse?.length),
        })),
    }));
  }
  cleanupRetired() {
    const jobs = this.retainedJobs();
    for (const model of this.db.select().from(channelModels).all())
      if (model.retired === 'retired' && !jobs.some((job) => job.channelModelId === model.id))
        this.db.delete(channelModels).where(eq(channelModels.id, model.id)).run();
  }
  credentialFingerprint(id: string) {
    const { apiKey, headers } = this.credentials(id);
    return createHash('sha256')
      .update(
        JSON.stringify([
          id,
          apiKey,
          Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)),
        ]),
      )
      .digest('hex');
  }
  modelVersion(id: string) {
    const model = { ...this.getModel(id), lastCheck: undefined, lastMediaCheck: undefined };
    const channel = this.getChannel(model.channelId);
    return createHash('sha256')
      .update(
        JSON.stringify([
          model,
          channel.baseUrl,
          channel.enabled,
          this.credentialFingerprint(model.connection?.credentialRef ?? channel.id),
        ]),
      )
      .digest('hex');
  }
  recordMediaCheck(
    id: string,
    value: NonNullable<import('@frame-loom/contracts').ChannelModel['lastMediaCheck']>,
  ) {
    try {
      if (this.modelVersion(id) === value.configVersion)
        this.db
          .update(channelModels)
          .set({ lastMediaCheck: value })
          .where(eq(channelModels.id, id))
          .run();
    } catch {
      /* 模型已被删除时仅保留任务记录。 */
    }
  }
  saveChannel(input: Partial<ChannelWrite>, existingId?: string) {
    if (existingId) this.channelRow(existingId);
    if (
      existingId &&
      (input.apiKey !== undefined || input.headers !== undefined || input.enabled === false)
    ) {
      const current = this.credentials(existingId);
      const canonical = (headers: Record<string, string>) =>
        JSON.stringify(Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)));
      if (
        (input.apiKey !== undefined && input.apiKey !== current.apiKey) ||
        (input.headers !== undefined && canonical(input.headers) !== canonical(current.headers)) ||
        (input.enabled === false && current.channel.enabled)
      )
        this.protectChannel(existingId);
    }
    const id = existingId ?? randomUUID();
    const now = new Date().toISOString();
    const { apiKey, headers, models, ...values } = input;
    const resolvedModels = models?.map((model) => ({ ...model, ...this.catalog.resolve(model) }));
    const secrets = {
      ...(apiKey !== undefined
        ? {
            apiKeyCipher: apiKey ? this.cipher.encrypt(apiKey, 'channels', id) : null,
            keyHint: apiKey ? `••••${apiKey.length > 4 ? apiKey.slice(-4) : ''}` : null,
          }
        : {}),
      ...(headers !== undefined
        ? {
            headersCipher: Object.keys(headers).length
              ? this.cipher.encrypt(JSON.stringify(headers), 'channel_headers', id)
              : null,
            headerNames: Object.keys(headers),
          }
        : {}),
    };
    try {
      // 渠道与模型同一事务提交，任何一项失败都不留下半保存状态。
      this.db.transaction((tx) => {
        if (existingId) {
          tx.update(channels)
            .set({ ...values, ...secrets, lastCheck: null, updatedAt: now })
            .where(eq(channels.id, id))
            .run();
          tx.update(channelModels)
            .set({ lastCheck: null, lastMediaCheck: null })
            .where(eq(channelModels.channelId, id))
            .run();
          if (input.enabled === false)
            tx.delete(modelDefaults)
              .where(
                inArray(
                  modelDefaults.channelModelId,
                  tx
                    .select({ id: channelModels.id })
                    .from(channelModels)
                    .where(eq(channelModels.channelId, id)),
                ),
              )
              .run();
        } else
          tx.insert(channels)
            .values({
              ...(values as Omit<ChannelWrite, 'apiKey' | 'headers' | 'models'>),
              id,
              ...secrets,
              headerNames: Object.keys(headers ?? {}),
              createdAt: now,
              updatedAt: now,
            })
            .run();
        if (resolvedModels) this.syncModels(tx, id, resolvedModels);
      });
    } catch (error) {
      this.rethrowConstraint(error);
    }
    return this.getChannel(id);
  }
  /** 以提交的列表为准：带 id 的更新、不带的新增、缺席的删除。 */
  private syncModels(
    tx: Parameters<Parameters<typeof this.db.transaction>[0]>[0],
    channelId: string,
    models: ChannelModelSave[],
  ) {
    const previous = new Map(
      tx
        .select()
        .from(channelModels)
        .where(and(eq(channelModels.channelId, channelId), isNull(channelModels.retired)))
        .all()
        .map((row) => [row.id, row]),
    );
    const kept = new Set(models.flatMap((model) => (model.id ? [model.id] : [])));
    for (const model of models)
      if (model.id && !previous.has(model.id))
        throw new DomainError('MODEL_NOT_FOUND', 404, '模型不存在或不属于该渠道');
    // 先删除再写入，避免改名或换协议时与即将删除的行冲突唯一约束。
    const removed = [...previous.keys()].filter((id) => !kept.has(id));
    if (this.retainedJobs().some((job) => removed.includes(job.channelModelId)))
      throw new DomainError(
        'RECOVERY_REFERENCE',
        409,
        '待删除模型仍有未处理任务，请先恢复或本地放弃',
      );
    if (removed.length) tx.delete(channelModels).where(inArray(channelModels.id, removed)).run();
    for (const { id, ...model } of models) {
      const values = {
        ...model,
        protocol: model.protocol ?? '',
        connection: model.connection ?? {},
        definitionId: model.definitionId ?? null,
        connectionId: model.connectionId ?? null,
        lastCheck: null,
        lastMediaCheck: null,
      };
      if (id) {
        tx.update(channelModels)
          .set({ ...values, connection: model.connection ?? {} })
          .where(eq(channelModels.id, id))
          .run();
        if (!model.enabled || previous.get(id)?.kind !== model.kind)
          tx.delete(modelDefaults).where(eq(modelDefaults.channelModelId, id)).run();
      } else
        tx.insert(channelModels)
          .values({ ...values, id: randomUUID(), channelId })
          .run();
    }
  }
  deleteChannel(id: string) {
    this.channelRow(id);
    this.protectChannel(id);
    if (
      this.listModels().some(
        (model) => model.connection?.credentialRef === id && model.channelId !== id,
      )
    )
      throw new DomainError(
        'CREDENTIAL_REFERENCE',
        409,
        '其他模型仍引用该渠道凭据，请先更改其接入',
      );
    this.db.delete(channels).where(eq(channels.id, id)).run();
    return { deleted: true as const };
  }
  listModels(channelId?: string) {
    this.cleanupRetired();
    if (channelId) this.channelRow(channelId);
    return this.db
      .select()
      .from(channelModels)
      .where(
        channelId
          ? and(eq(channelModels.channelId, channelId), isNull(channelModels.retired))
          : isNull(channelModels.retired),
      )
      .all()
      .map((row) => this.effectiveModel(row));
  }
  private effectiveModel(row: typeof channelModels.$inferSelect) {
    const { retired, ...fields } = row;
    if (retired) throw new DomainError('VIDEO_MODEL_RETIRED', 422, '旧型号已退出');
    const input = { ...fields, protocol: row.protocol || null, connection: row.connection ?? {} };
    const resolved = this.catalog.resolve(input);
    let effectiveProfile;
    if (resolved.kind && resolved.kind !== 'chat' && resolved.protocol) {
      try {
        effectiveProfile = mediaProfile({
          ...resolved,
          effectiveProfile: this.catalog.profile(input),
        });
      } catch (error) {
        if (input.definitionId) throw error;
        effectiveProfile = null;
      }
    }
    return {
      ...input,
      ...resolved,
      effectiveProfile,
      connection: effectiveProfile
        ? {
            ...resolved.connection,
            runtime: executionContract(resolved.connection, effectiveProfile),
          }
        : resolved.connection,
    };
  }
  getModel(id: string) {
    const row = this.db.select().from(channelModels).where(eq(channelModels.id, id)).get();
    if (!row) throw new DomainError('MODEL_NOT_FOUND', 404, '模型不存在');
    if (row.retired)
      throw new DomainError('VIDEO_MODEL_RETIRED', 422, '旧型号已退出，仅可恢复历史任务');
    return this.effectiveModel(row);
  }
  saveModel(channelId: string, input: ChannelModelWrite, id = randomUUID()) {
    input = this.catalog.resolve(input);
    this.channelRow(channelId);
    try {
      this.db
        .insert(channelModels)
        .values({
          ...input,
          id,
          channelId,
          protocol: input.protocol ?? '',
          connection: input.connection ?? {},
        })
        .run();
    } catch (error) {
      this.rethrowConstraint(error);
    }
    return this.getModel(id);
  }
  updateModel(id: string, input: ChannelModelWrite) {
    input = this.catalog.resolve(input);
    const previous = this.getModel(id);
    try {
      this.db.transaction((tx) => {
        tx.update(channelModels)
          .set({
            ...input,
            definitionId: input.definitionId ?? null,
            connectionId: input.connectionId ?? null,
            protocol: input.protocol ?? '',
            connection: input.connection ?? {},
            lastCheck: null,
            lastMediaCheck: null,
          })
          .where(eq(channelModels.id, id))
          .run();
        if (!input.enabled || previous.kind !== input.kind)
          tx.delete(modelDefaults).where(eq(modelDefaults.channelModelId, id)).run();
      });
    } catch (error) {
      this.rethrowConstraint(error);
    }
    return this.getModel(id);
  }
  private rethrowConstraint(error: unknown): never {
    if (error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE')
      throw new DomainError('MODEL_ALREADY_EXISTS', 409, '同渠道、上游 ID 与协议的模型已存在');
    throw error;
  }
  deleteModel(id: string) {
    const row = this.db.select().from(channelModels).where(eq(channelModels.id, id)).get();
    if (!row) return { deleted: true as const };
    if (this.retainedJobs().some((job) => job.channelModelId === id))
      throw new DomainError('RECOVERY_REFERENCE', 409, '任务仍引用该绑定，请先恢复或本地放弃任务');
    this.db.delete(channelModels).where(eq(channelModels.id, id)).run();
    return { deleted: true as const };
  }
  defaults(): ModelDefaults {
    const defaults: ModelDefaults = { chat: null, image: null, video: null, tts: null };
    for (const row of this.db.select().from(modelDefaults).all())
      defaults[row.kind] = row.channelModelId;
    return defaults;
  }
  saveDefaults(input: Partial<ModelDefaults>) {
    this.db.transaction((tx) => {
      for (const kind of Object.keys(input) as ModelKind[]) {
        const id = input[kind] ?? null;
        if (id) {
          const model = this.getModel(id);
          if (model.kind !== kind || !model.enabled || !this.getChannel(model.channelId).enabled)
            throw new DomainError(
              'INVALID_DEFAULT_MODEL',
              422,
              '默认模型必须属于对应类别且渠道和模型均已启用',
            );
        }
        tx.insert(modelDefaults)
          .values({ kind, channelModelId: id })
          .onConflictDoUpdate({ target: modelDefaults.kind, set: { channelModelId: id } })
          .run();
      }
    });
    return this.defaults();
  }
  recordCheck(id: string, result: ConnectionCheck, model = false) {
    const table = model ? channelModels : channels;
    this.db.update(table).set({ lastCheck: result }).where(eq(table.id, id)).run();
  }
}

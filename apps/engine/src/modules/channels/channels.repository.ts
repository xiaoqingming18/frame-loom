import { Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
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

@Injectable()
export class ChannelsRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly cipher: SecretCipher,
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
  saveChannel(input: Partial<ChannelWrite>, existingId?: string) {
    if (existingId) this.channelRow(existingId);
    const id = existingId ?? randomUUID();
    const now = new Date().toISOString();
    const { apiKey, headers, models, ...values } = input;
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
            .set({ lastCheck: null })
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
        if (models) this.syncModels(tx, id, models);
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
        .where(eq(channelModels.channelId, channelId))
        .all()
        .map((row) => [row.id, row]),
    );
    const kept = new Set(models.flatMap((model) => (model.id ? [model.id] : [])));
    for (const model of models)
      if (model.id && !previous.has(model.id))
        throw new DomainError('MODEL_NOT_FOUND', 404, '模型不存在或不属于该渠道');
    // 先删除再写入，避免改名或换协议时与即将删除的行冲突唯一约束。
    const removed = [...previous.keys()].filter((id) => !kept.has(id));
    if (removed.length) tx.delete(channelModels).where(inArray(channelModels.id, removed)).run();
    for (const { id, ...model } of models) {
      const values = { ...model, protocol: model.protocol ?? '', lastCheck: null };
      if (id) {
        tx.update(channelModels).set(values).where(eq(channelModels.id, id)).run();
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
    this.db.delete(channels).where(eq(channels.id, id)).run();
    return { deleted: true as const };
  }
  listModels(channelId?: string) {
    if (channelId) this.channelRow(channelId);
    return this.db
      .select()
      .from(channelModels)
      .where(channelId ? eq(channelModels.channelId, channelId) : undefined)
      .all()
      .map((row) => ({ ...row, protocol: row.protocol || null }));
  }
  getModel(id: string) {
    const row = this.db.select().from(channelModels).where(eq(channelModels.id, id)).get();
    if (!row) throw new DomainError('MODEL_NOT_FOUND', 404, '模型不存在');
    return { ...row, protocol: row.protocol || null };
  }
  saveModel(channelId: string, input: ChannelModelWrite, id = randomUUID()) {
    this.channelRow(channelId);
    try {
      this.db
        .insert(channelModels)
        .values({ ...input, id, channelId, protocol: input.protocol ?? '' })
        .run();
    } catch (error) {
      this.rethrowConstraint(error);
    }
    return this.getModel(id);
  }
  updateModel(id: string, input: ChannelModelWrite) {
    const previous = this.getModel(id);
    try {
      this.db.transaction((tx) => {
        tx.update(channelModels)
          .set({ ...input, protocol: input.protocol ?? '', lastCheck: null })
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
    this.getModel(id);
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

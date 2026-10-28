import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getProtocol, resolveEndpoints, validateModel } from '@frame-loom/contracts';
import {
  Channel,
  ChannelWrite,
  ModelWrite,
  type Model,
  type ModelCheck,
  ModelDefaults,
  type ModelKind,
} from '@frame-loom/contracts';
import { DatabaseService } from '../../core/database/database.service.js';
import { SecretCipher } from '../../core/crypto/secret-cipher.js';
import { DomainError } from '../../core/http/domain-error.js';
import { channels, models, modelDefaults } from './model-services.schema.js';
import { ProtocolRegistry } from '../generation/protocols/registry.js';

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
@Injectable()
export class ModelServicesRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly cipher: SecretCipher,
    private readonly registry: ProtocolRegistry,
  ) {}
  private get db() {
    return this.database.db;
  }
  private channelRow(id: string) {
    const row = this.db.select().from(channels).where(eq(channels.id, id)).get();
    if (!row) throw new DomainError('CHANNEL_NOT_FOUND', 404, '渠道不存在');
    return row;
  }
  private publicChannel(row: typeof channels.$inferSelect): Channel {
    return Channel.parse({
      id: row.id,
      name: row.name,
      baseUrl: row.baseUrl,
      catalogFormat: row.catalogFormat,
      concurrency: row.concurrency,
      enabled: row.enabled,
      keyHint: row.keyHint,
      headerNames: row.headerNames,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      hasKey: !!row.apiKeyCipher,
      hasSecretKey: !!row.secretKeyCipher,
    });
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
      secretKey: row.secretKeyCipher
        ? this.cipher.decrypt(row.secretKeyCipher, 'channels_secret', id)
        : '',
      headers: row.headersCipher
        ? z
            .record(z.string(), z.string())
            .parse(JSON.parse(this.cipher.decrypt(row.headersCipher, 'channel_headers', id)))
        : {},
    };
  }
  credentialFingerprint(id: string) {
    const { apiKey, secretKey, headers } = this.credentials(id);
    return createHash('sha256')
      .update(stable([id, apiKey, secretKey, headers]))
      .digest('hex');
  }
  saveChannel(input: Partial<ChannelWrite>, existingId?: string) {
    const previous = existingId ? this.getChannel(existingId) : undefined;
    const merged = ChannelWrite.parse({
      ...(previous && {
        name: previous.name,
        baseUrl: previous.baseUrl,
        catalogFormat: previous.catalogFormat,
        concurrency: previous.concurrency,
        enabled: previous.enabled,
      }),
      ...input,
    });
    const id = existingId ?? randomUUID();
    const now = new Date().toISOString();
    const { apiKey, secretKey, headers, ...fields } = merged;
    const secrets = {
      ...(apiKey !== undefined
        ? {
            apiKeyCipher: apiKey ? this.cipher.encrypt(apiKey, 'channels', id) : null,
            keyHint: apiKey ? `••••${apiKey.length > 4 ? apiKey.slice(-4) : ''}` : null,
          }
        : {}),
      ...(secretKey !== undefined
        ? {
            secretKeyCipher: secretKey
              ? this.cipher.encrypt(secretKey, 'channels_secret', id)
              : null,
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
    if (existingId)
      this.db
        .update(channels)
        .set({ ...fields, ...secrets, updatedAt: now })
        .where(eq(channels.id, id))
        .run();
    else
      this.db
        .insert(channels)
        .values({
          ...fields,
          ...secrets,
          id,
          headerNames: Object.keys(headers ?? {}),
          createdAt: now,
          updatedAt: now,
        })
        .run();
    return this.getChannel(id);
  }
  deleteChannel(id: string) {
    this.channelRow(id);
    const count = this.listModels(id).length;
    this.db.delete(channels).where(eq(channels.id, id)).run();
    return { deleted: true as const, models: count };
  }
  private publicModel(row: typeof models.$inferSelect): Model {
    const channel = this.getChannel(row.channelId);
    const write = ModelWrite.parse({
      kind: row.kind,
      upstreamModelId: row.upstreamModelId,
      displayName: row.displayName,
      protocolId: row.protocolId || null,
      endpointOverride: row.endpointOverride,
      transport: row.transport,
      capability: row.capability,
      extras: row.extras,
      fixedFields: row.fixedFields,
      ...(row.concurrency !== null ? { concurrency: row.concurrency } : {}),
      enabled: row.enabled,
    });
    const descriptor = row.protocolId
      ? (this.registry.adapters.get(row.protocolId)?.descriptor ?? getProtocol(row.protocolId))
      : undefined;
    const endpoints = descriptor
      ? resolveEndpoints(channel, write, descriptor)
      : { operations: {}, foreignHosts: [], issues: [] };
    const configHash = createHash('sha256')
      .update(stable([channel.baseUrl, write]))
      .digest('hex')
      .slice(0, 16);
    const blockedReason = !descriptor
      ? '请先选择有效协议'
      : !descriptor.kinds.includes(write.kind)
        ? '协议不支持此类别'
        : (endpoints.issues[0] ??
          (endpoints.foreignHosts.some(
            (host) => !write.endpointOverride.confirmedHosts.includes(host),
          )
            ? '请确认外部主机'
            : !channel.hasKey
              ? '渠道缺少 API Key'
              : null));
    return {
      ...write,
      id: row.id,
      channelId: row.channelId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      configHash,
      endpoints,
      blockedReason,
      lastCheck: row.lastCheck?.configHash === configHash ? row.lastCheck : null,
    };
  }
  listModels(channelId?: string) {
    if (channelId) this.channelRow(channelId);
    return this.db
      .select()
      .from(models)
      .where(channelId ? eq(models.channelId, channelId) : undefined)
      .all()
      .map((row) => this.publicModel(row));
  }
  getModel(id: string): Model {
    const row = this.db.select().from(models).where(eq(models.id, id)).get();
    if (!row) throw new DomainError('MODEL_NOT_FOUND', 404, '模型不存在');
    return this.publicModel(row);
  }
  validate(input: ModelWrite, channelId: string) {
    const channel = this.getChannel(channelId);
    const issues = validateModel(
      input,
      input.protocolId
        ? (this.registry.adapters.get(input.protocolId)?.descriptor ??
            getProtocol(input.protocolId))
        : undefined,
      channel,
    );
    if (input.concurrency !== undefined && input.concurrency > channel.concurrency)
      issues.push({ field: 'concurrency', message: '模型并发只能收窄渠道并发' });
    if (issues.length)
      throw new DomainError(
        'INVALID_MODEL',
        422,
        issues.map((issue) => `${issue.field}: ${issue.message}`).join('；'),
        issues,
      );
    return ModelWrite.parse(input);
  }
  private values(input: ModelWrite) {
    return { ...input, protocolId: input.protocolId ?? '', concurrency: input.concurrency ?? null };
  }
  private rethrowConstraint(error: unknown): never {
    if (error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE')
      throw new DomainError('MODEL_ALREADY_EXISTS', 409, '同渠道、上游 ID 与协议的模型已存在');
    throw error;
  }
  saveModels(channelId: string, input: ModelWrite[]) {
    const writes = input.map((write) => this.validate(write, channelId));
    const ids: string[] = [];
    try {
      this.db.transaction((tx) => {
        for (const write of writes) {
          const id = randomUUID();
          const now = new Date().toISOString();
          tx.insert(models)
            .values({ ...this.values(write), id, channelId, createdAt: now, updatedAt: now })
            .run();
          ids.push(id);
        }
      });
    } catch (error) {
      this.rethrowConstraint(error);
    }
    return ids.map((id) => this.getModel(id));
  }
  updateModel(id: string, input: ModelWrite) {
    const previous = this.getModel(id);
    const write = this.validate(input, previous.channelId);
    try {
      this.db.transaction((tx) => {
        tx.update(models)
          .set({ ...this.values(write), updatedAt: new Date().toISOString() })
          .where(eq(models.id, id))
          .run();
        if (!write.enabled || write.kind !== previous.kind)
          tx.delete(modelDefaults).where(eq(modelDefaults.modelId, id)).run();
      });
    } catch (error) {
      this.rethrowConstraint(error);
    }
    return this.getModel(id);
  }
  deleteModel(id: string) {
    this.getModel(id);
    this.db.delete(models).where(eq(models.id, id)).run();
    return { deleted: true as const };
  }
  defaults(): ModelDefaults {
    const defaults: ModelDefaults = { chat: null, image: null, video: null, tts: null };
    for (const row of this.db.select().from(modelDefaults).all()) defaults[row.kind] = row.modelId;
    return defaults;
  }
  saveDefaults(input: Partial<ModelDefaults>) {
    this.db.transaction((tx) => {
      for (const kind of Object.keys(input) as ModelKind[]) {
        const id = input[kind] ?? null;
        if (id) {
          const model = this.getModel(id);
          if (
            model.kind !== kind ||
            !model.enabled ||
            !this.getChannel(model.channelId).enabled ||
            model.blockedReason
          )
            throw new DomainError(
              'INVALID_DEFAULT_MODEL',
              422,
              '默认模型必须属于对应类别且已启用、可用',
            );
        }
        tx.insert(modelDefaults)
          .values({ kind, modelId: id })
          .onConflictDoUpdate({ target: modelDefaults.kind, set: { modelId: id } })
          .run();
      }
    });
    return this.defaults();
  }
  recordCheck(id: string, check: ModelCheck) {
    if (this.getModel(id).configHash !== check.configHash) return;
    this.db.update(models).set({ lastCheck: check }).where(eq(models.id, id)).run();
  }
}

import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { VoiceWrite, VoiceDirectory } from '@frame-loom/contracts';
import { DatabaseService } from '../../core/database/database.service.js';
import { DomainError } from '../../core/http/domain-error.js';
import { ModelServicesRepository } from './model-services.repository.js';
import { ttsVoices } from './model-services.schema.js';
import { ProtocolRegistry } from '../generation/protocols/registry.js';
import { applyExtras } from '../generation/protocols/http.js';
import type { AdapterContext } from '../generation/protocols/types.js';

@Injectable()
export class VoicesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly services: ModelServicesRepository,
    private readonly registry: ProtocolRegistry,
  ) {}
  private scope(id: string) {
    const model = this.services.getModel(id);
    if (model.capability.kind !== 'tts' || !model.protocolId)
      throw new DomainError('VOICE_UNAVAILABLE', 422, '请选择 TTS 模型与协议');
    const owner = this.services.credentialFingerprint(model.channelId);
    const where = and(
      eq(ttsVoices.owner, owner),
      eq(ttsVoices.protocolId, model.protocolId),
      eq(ttsVoices.upstreamModelId, model.upstreamModelId),
    );
    return { model, voices: model.capability.voices, owner, where };
  }
  list(id: string): VoiceDirectory {
    const { model, voices, where } = this.scope(id);
    return {
      param: 'voice',
      canManual: voices.sources.includes('manual'),
      canFetch: voices.sources.includes('remote') && !!model.endpoints.operations.voices,
      voices: [
        ...voices.presets.map((voice) => ({
          voiceId: voice.id,
          name: voice.name,
          source: 'builtin' as const,
        })),
        ...this.database.db
          .select()
          .from(ttsVoices)
          .where(where)
          .all()
          .map((voice) => ({
            id: voice.id,
            voiceId: voice.voiceId,
            name: voice.name,
            source: 'saved' as const,
          })),
      ],
    };
  }
  save(id: string, input: VoiceWrite, remote = false) {
    const { model, voices, owner } = this.scope(id);
    if (!voices.sources.includes(remote ? 'remote' : 'manual'))
      throw new DomainError('VOICE_INCOMPATIBLE', 422, '能力卡未开放此音色来源');
    this.database.db
      .insert(ttsVoices)
      .values({
        id: randomUUID(),
        owner,
        protocolId: model.protocolId!,
        upstreamModelId: model.upstreamModelId,
        ...input,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [
          ttsVoices.owner,
          ttsVoices.protocolId,
          ttsVoices.upstreamModelId,
          ttsVoices.voiceId,
        ],
        set: { name: input.name },
      })
      .run();
    return this.list(id);
  }
  remove(id: string, voiceId: string) {
    const { where } = this.scope(id);
    this.database.db
      .delete(ttsVoices)
      .where(and(where, eq(ttsVoices.id, voiceId)))
      .run();
    return this.list(id);
  }
  async fetch(id: string) {
    const { model, voices } = this.scope(id);
    const adapter = this.registry.get(model.protocolId!);
    if (
      !voices.sources.includes('remote') ||
      !adapter.listVoices ||
      !model.endpoints.operations.voices
    )
      throw new DomainError('VOICE_CATALOG_UNAVAILABLE', 422, '当前协议无音色目录接口');
    if (!model.enabled || !this.services.getChannel(model.channelId).enabled || model.blockedReason)
      throw new DomainError('MODEL_DISABLED', 422, '渠道或模型不可用');
    const ctx: AdapterContext = {
      snapshot: {
        version: 1,
        protocolId: model.protocolId!,
        protocolVersion: 'v1',
        modelId: id,
        channelId: model.channelId,
        upstreamModelId: model.upstreamModelId,
        kind: model.kind,
        endpoints: model.endpoints.operations,
        capability: model.capability,
        extras: model.extras,
        fixedFields: model.fixedFields,
        transport: {},
        concurrencyKey: model.channelId,
        concurrency: 1,
        credentialFingerprint: this.services.credentialFingerprint(model.channelId),
        configHash: model.configHash,
        referenceUrls: {},
      },
      credentials: this.services.credentials(model.channelId),
      signal: AbortSignal.timeout(15000),
      fetchMedia: () => Promise.reject(new Error('音色列表不接受素材')),
      referenceUrl: () => {
        throw new Error('音色列表不接受素材');
      },
      resolvePrompt: (prompt) => prompt,
      applyExtras,
      diagnose: () => {},
    };
    for (const voice of await adapter.listVoices(ctx))
      this.save(id, { voiceId: voice.id, name: voice.name }, true);
    return this.list(id);
  }
}

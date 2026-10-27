import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { resolveServiceUrl, type VoiceDirectory, type VoiceWrite } from '@frame-loom/contracts';
import { DatabaseService } from '../../core/database/database.service.js';
import { DomainError } from '../../core/http/domain-error.js';
import { ChannelsRepository } from './channels.repository.js';
import { ttsVoices } from './channels.schema.js';
import { connectionError, providerError } from './provider-request.js';

@Injectable()
export class VoicesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly channels: ChannelsRepository,
  ) {}
  private scope(modelId: string) {
    const model = this.channels.getModel(modelId);
    const param = model.effectiveProfile?.params.find((item) =>
      ['voice', 'voice_id'].includes(item.key),
    );
    if (model.kind !== 'tts' || !param)
      throw new DomainError('VOICE_UNAVAILABLE', 422, '当前模型未声明音色参数');
    const accountId = model.connection?.credentialRef ?? model.channelId;
    const owner = this.channels.credentialFingerprint(accountId);
    const where = and(
      eq(ttsVoices.owner, owner),
      eq(ttsVoices.protocol, model.protocol!),
      eq(ttsVoices.model, model.upstreamModelId),
    );
    return { model, param, accountId, owner, where };
  }
  list(modelId: string): VoiceDirectory {
    const { model, param, where } = this.scope(modelId);
    const builtin = (param.values ?? []).map((value) => ({
      voiceId: String(value),
      name: String(value),
      source: 'builtin' as const,
    }));
    return {
      param: param.key,
      canManual: param.type === 'string',
      canFetch: model.protocol === 'minimax-t2a',
      voices: [
        ...builtin,
        ...this.database.db
          .select()
          .from(ttsVoices)
          .where(where)
          .all()
          .filter((voice) => !param.values || param.values.includes(voice.voiceId))
          .map((voice) => ({
            id: voice.id,
            voiceId: voice.voiceId,
            name: voice.name,
            source: 'saved' as const,
          })),
      ],
    };
  }
  save(modelId: string, input: VoiceWrite) {
    const { model, param, owner, where } = this.scope(modelId);
    if (param.values && !param.values.includes(input.voiceId))
      throw new DomainError('VOICE_INCOMPATIBLE', 422, '音色不在当前模型支持目录内');
    const existing = this.database.db
      .select()
      .from(ttsVoices)
      .where(and(where, eq(ttsVoices.voiceId, input.voiceId)))
      .get();
    if (existing)
      this.database.db
        .update(ttsVoices)
        .set({ name: input.name })
        .where(eq(ttsVoices.id, existing.id))
        .run();
    else
      this.database.db
        .insert(ttsVoices)
        .values({
          ...input,
          id: randomUUID(),
          owner,
          protocol: model.protocol!,
          model: model.upstreamModelId,
        })
        .run();
    return this.list(modelId);
  }
  remove(modelId: string, id: string) {
    const { where } = this.scope(modelId);
    this.database.db
      .delete(ttsVoices)
      .where(and(where, eq(ttsVoices.id, id)))
      .run();
    return this.list(modelId);
  }
  async fetch(modelId: string): Promise<VoiceDirectory> {
    const { model, accountId } = this.scope(modelId);
    if (model.protocol !== 'minimax-t2a')
      throw new DomainError(
        'VOICE_CATALOG_UNAVAILABLE',
        422,
        '当前协议无音色目录接口，请使用内置目录',
      );
    if (!model.enabled || !this.channels.getChannel(model.channelId).enabled)
      throw new DomainError('MODEL_DISABLED', 422, '渠道或模型已禁用');
    const { apiKey, headers, channel } = this.channels.credentials(accountId);
    const baseUrl = model.connection?.baseUrl ?? this.channels.getChannel(model.channelId).baseUrl;
    const signal = AbortSignal.timeout(15_000);
    try {
      if (!channel.enabled) throw new DomainError('CHANNEL_DISABLED', 422, '凭据渠道已禁用');
      const response = await fetch(
        resolveServiceUrl(baseUrl, model.connection?.routes?.catalog ?? 'v1/get_voice'),
        {
          method: 'POST',
          headers: {
            ...headers,
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ voice_type: 'all' }),
          signal,
          redirect: 'error',
        },
      );
      if (!response.ok) throw providerError(response.status);
      const item = z.object({
        voice_id: z.string().min(1).max(300),
        voice_name: z.string().max(100).optional(),
      });
      const parsed = z
        .object({
          base_resp: z.object({ status_code: z.literal(0) }),
          system_voice: z.array(item).max(10_000).optional(),
          voice_cloning: z.array(item).max(10_000).optional(),
          voice_generation: z.array(item).max(10_000).optional(),
        })
        .safeParse(await response.json());
      if (!parsed.success)
        throw new DomainError('INVALID_RESPONSE', 422, '音色目录格式无效，仍可手填 ID');
      const voices = [
        ...(parsed.data.system_voice ?? []),
        ...(parsed.data.voice_cloning ?? []),
        ...(parsed.data.voice_generation ?? []),
      ];
      return {
        ...this.list(modelId),
        voices: voices.map((voice) => ({
          voiceId: voice.voice_id,
          name: voice.voice_name || voice.voice_id,
          source: 'provider',
        })),
      };
    } catch (error) {
      throw connectionError(error, signal);
    }
  }
}

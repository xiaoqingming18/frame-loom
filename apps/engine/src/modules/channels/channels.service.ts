import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  type ChannelModelWrite,
  ConnectionCheck,
  type LlmProtocol,
  type ModelProbeRequest,
  ProviderErrorCode,
  protocolsByKind,
} from '@frame-loom/contracts';
import { DomainError } from '../../core/http/domain-error.js';
import { ChannelsRepository } from './channels.repository.js';
import { connectionError, providerError } from './provider-request.js';
import { mediaProfile } from '../generation/profiles/media-profiles.js';

@Injectable()
export class ChannelsService {
  constructor(readonly repository: ChannelsRepository) {}

  validateModel(input: ChannelModelWrite) {
    if (input.protocol && (!input.kind || !protocolsByKind[input.kind].includes(input.protocol)))
      throw new DomainError('INVALID_PROTOCOL', 422, '调用协议与模型类别不匹配');
    if (input.kind && input.kind !== 'chat' && input.protocol) mediaProfile(input);
    if (input.enabled && (!input.kind || !input.protocol))
      throw new DomainError('MODEL_UNCLASSIFIED', 422, '请选择类别和协议后再启用模型');
    if (
      input.overrides.maxTokens &&
      input.overrides.contextWindow &&
      input.overrides.maxTokens > input.overrides.contextWindow
    )
      throw new DomainError('INVALID_LIMITS', 422, '最大输出不能超过上下文长度');
    return input;
  }

  async remoteModels(id: string, parentSignal?: AbortSignal) {
    const { channel, apiKey, headers } = this.repository.credentials(id);
    if (!channel.enabled) throw new DomainError('CHANNEL_DISABLED', 422, '渠道已禁用');
    return this.listUpstream({ ...channel, apiKey, headers }, parentSignal);
  }

  /** 用表单草稿拉取上游模型 ID，不写库；未填的密钥和请求头沿用已保存渠道。 */
  probe(input: ModelProbeRequest) {
    const saved = input.channelId ? this.repository.credentials(input.channelId) : undefined;
    return this.listUpstream({
      apiFormat: input.apiFormat,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey ?? saved?.apiKey ?? '',
      headers: input.headers ?? saved?.headers ?? {},
    });
  }

  private async listUpstream(
    channel: {
      apiFormat: LlmProtocol;
      baseUrl: string;
      apiKey: string;
      headers: Record<string, string>;
    },
    parentSignal?: AbortSignal,
  ) {
    const { apiKey, headers } = channel;
    const signal = AbortSignal.any([
      AbortSignal.timeout(15_000),
      ...(parentSignal ? [parentSignal] : []),
    ]);
    const baseUrl = channel.baseUrl.replace(/\/+$/, '');
    const gemini = channel.apiFormat === 'google-generative-ai';
    const anthropic = channel.apiFormat === 'anthropic-messages';
    const path = anthropic ? '/v1/models' : '/models';
    try {
      const response = await fetch(baseUrl + path, {
        headers: {
          ...headers,
          ...(gemini
            ? { 'x-goog-api-key': apiKey }
            : anthropic
              ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
              : { Authorization: `Bearer ${apiKey}` }),
        },
        signal,
        redirect: 'error',
      });
      if (!response.ok) throw providerError(response.status);
      const json: unknown = await response.json();
      const parsed = gemini
        ? z
            .object({ models: z.array(z.object({ name: z.string().min(1).max(307) })).max(10_000) })
            .safeParse(json)
        : z
            .object({ data: z.array(z.object({ id: z.string().min(1).max(300) })).max(10_000) })
            .safeParse(json);
      if (!parsed.success) throw new DomainError('INVALID_RESPONSE', 422, '模型列表格式无效');
      const result = parsed.data;
      return [
        ...new Set(
          'models' in result
            ? result.models.map((item) => item.name.replace(/^models\//, ''))
            : result.data.map((item) => item.id),
        ),
      ];
    } catch (error) {
      throw connectionError(error, signal);
    }
  }

  async test(id: string): Promise<ConnectionCheck> {
    this.repository.getChannel(id);
    let result: ConnectionCheck;
    try {
      await this.remoteModels(id);
      result = {
        ok: true,
        checkedAt: new Date().toISOString(),
        code: null,
        message: '地址与鉴权通过，请继续测试具体文本模型',
        steps: { connection: true, text: false, toolCall: false, usage: false, thinking: false },
        usage: null,
      };
    } catch (error) {
      const domain = connectionError(error);
      result = {
        ok: false,
        checkedAt: new Date().toISOString(),
        code: ProviderErrorCode.catch('UPSTREAM_ERROR').parse(domain.code),
        message: domain.message,
        steps: { connection: false, text: false, toolCall: false, usage: false, thinking: false },
        usage: null,
      };
    }
    this.repository.recordCheck(id, result);
    return result;
  }
}

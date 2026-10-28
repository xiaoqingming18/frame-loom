import { Injectable } from '@nestjs/common';
import { effectiveCapability, SemanticRequest } from '@frame-loom/contracts';
import { DomainError } from '../../core/http/domain-error.js';
import { applyExtras } from '../generation/protocols/http.js';
import { ProtocolRegistry } from '../generation/protocols/registry.js';
import type { AdapterContext } from '../generation/protocols/types.js';
import { LlmService } from '../llm/llm.service.js';
import { ModelServicesRepository } from './model-services.repository.js';

@Injectable()
export class RequestPreviewService {
  constructor(
    private readonly repository: ModelServicesRepository,
    private readonly registry: ProtocolRegistry,
    private readonly llm: LlmService,
  ) {}
  async preview(id: string) {
    const model = this.repository.getModel(id);
    if (model.kind === 'chat') return this.llm.preview(id);
    if (!model.protocolId) throw new DomainError('PROTOCOL_REQUIRED', 422, '请先选择请求协议');
    const channel = this.repository.getChannel(model.channelId);
    const adapter = this.registry.get(model.protocolId);
    const capability = effectiveCapability(model.capability, adapter.descriptor);
    const context: AdapterContext = {
      snapshot: {
        version: 1,
        protocolId: model.protocolId,
        protocolVersion: adapter.descriptor.version,
        modelId: id,
        channelId: channel.id,
        upstreamModelId: model.upstreamModelId,
        kind: model.kind,
        endpoints: model.endpoints.operations,
        capability,
        extras: model.extras,
        fixedFields: model.fixedFields,
        transport: {},
        concurrencyKey: channel.id,
        concurrency: 1,
        credentialFingerprint: '',
        configHash: model.configHash,
        referenceUrls: {},
      },
      credentials: { apiKey: '', secretKey: '', headers: {} },
      signal: new AbortController().signal,
      fetchMedia: () =>
        Promise.resolve({ bytes: new TextEncoder().encode('示例素材'), mime: 'image/png' }),
      referenceUrl: () => 'https://example.invalid/reference',
      resolvePrompt: (prompt) => prompt,
      applyExtras,
      diagnose: () => {},
    };
    const request = SemanticRequest.parse({
      modelId: id,
      prompt: '示例提示词',
      source: 'test',
      inputs: [],
      mode: capability.kind === 'video' ? capability.defaultMode : undefined,
      params: capability.kind === 'tts' ? { voice: capability.voices.default ?? '示例音色' } : {},
    });
    const call = await adapter.buildSubmit(context, request, capability);
    const body =
      call.body instanceof FormData
        ? Object.fromEntries(
            [...call.body.entries()].map(([key, value]) => [
              key,
              typeof value === 'string' ? value : '[示例文件]',
            ]),
          )
        : typeof call.body === 'string'
          ? (JSON.parse(call.body) as unknown)
          : null;
    // 只投影可公开的请求信息，绝不返回适配器产生的鉴权头。
    return { method: call.method, url: call.url, body };
  }
}

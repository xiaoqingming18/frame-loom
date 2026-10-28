import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { resolveCatalogUrl } from '@frame-loom/contracts';
import type { CatalogCandidate, CatalogRequest } from '@frame-loom/contracts/model-service';
import { ModelServicesRepository } from './model-services.repository.js';
import { connectionError, providerError } from '../generation/protocols/http.js';
import { DomainError } from '../../core/http/domain-error.js';

const Entry = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  supported_endpoint_types: z.array(z.string()).optional(),
  supportedGenerationMethods: z.array(z.string()).optional(),
  architecture: z.object({ output_modalities: z.array(z.string()).optional() }).optional(),
});
const ResponseBody = z.object({
  data: z.array(Entry).max(10000).optional(),
  models: z.array(Entry).max(10000).optional(),
});
@Injectable()
export class CatalogService {
  constructor(private readonly repository: ModelServicesRepository) {}
  async read(input: CatalogRequest, parentSignal?: AbortSignal): Promise<CatalogCandidate[]> {
    const saved = input.channelId ? this.repository.credentials(input.channelId) : undefined;
    const apiKey = input.apiKey ?? saved?.apiKey ?? '';
    const headers = { ...(input.headers ?? saved?.headers) };
    if (input.catalogFormat === 'openai') headers.Authorization = `Bearer ${apiKey}`;
    if (input.catalogFormat === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    }
    if (input.catalogFormat === 'gemini') headers['x-goog-api-key'] = apiKey;
    const signal = AbortSignal.any([
      AbortSignal.timeout(15000),
      ...(parentSignal ? [parentSignal] : []),
    ]);
    try {
      const response = await fetch(resolveCatalogUrl(input.baseUrl, input.catalogFormat), {
        headers,
        redirect: 'error',
        signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw providerError(response.status);
      }
      const parsed = ResponseBody.safeParse(await response.json());
      if (!parsed.success) throw new DomainError('INVALID_RESPONSE', 422, '模型列表格式无效');
      const candidates = new Map<string, CatalogCandidate>();
      for (const entry of (input.catalogFormat === 'gemini'
        ? parsed.data.models
        : parsed.data.data) ?? []) {
        const id =
          input.catalogFormat === 'gemini' ? entry.name?.replace(/^models\//, '') : entry.id;
        if (!id || id.length > 300) continue;
        const endpointTypes =
          entry.supported_endpoint_types ??
          (entry.supportedGenerationMethods?.includes('generateContent') ? ['gemini'] : []);
        const outputModalities = entry.architecture?.output_modalities ?? [];
        const kind =
          outputModalities.includes('image') || endpointTypes.includes('image-generation')
            ? 'image'
            : outputModalities.includes('video') || endpointTypes.includes('openai-video')
              ? 'video'
              : outputModalities.includes('audio')
                ? 'tts'
                : endpointTypes.some((type) =>
                      ['openai', 'openai-response', 'anthropic', 'gemini'].includes(type),
                    )
                  ? 'chat'
                  : null;
        const chatProtocols = [
          ['openai-response', 'openai-responses'],
          ['openai', 'openai-chat'],
          ['anthropic', 'anthropic-messages'],
          ['gemini', 'gemini-generate'],
        ];
        const protocolId =
          kind === 'chat'
            ? (chatProtocols.find(([type]) => endpointTypes.includes(type))?.[1] ?? null)
            : null;
        candidates.set(id, { id, endpointTypes, outputModalities, kind, protocolId });
      }
      return [...candidates.values()];
    } catch (error) {
      throw connectionError(error, signal);
    }
  }
}

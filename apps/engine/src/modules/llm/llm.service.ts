import { Injectable } from '@nestjs/common';
import type { Context, Model, Usage } from '@earendil-works/pi-ai';
import {
  getProtocol,
  resolveEndpoints,
  ModelUsage,
  ProviderErrorCode,
  type LlmEvent,
  type TestChatRequest,
} from '@frame-loom/contracts';
import type { ModelCheck } from '@frame-loom/contracts/model-service';
import { ModelServicesRepository } from '../model-services/model-services.repository.js';
import { CatalogService } from '../model-services/catalog.service.js';
import { connectionError, providerError } from '../generation/protocols/http.js';
import { chatRuntime } from '../generation/protocols/chat-runtime.js';
import { DomainError } from '../../core/http/domain-error.js';
import { googleTransport } from './google-transport.js';

async function loadRuntime() {
  const [pi, responses, completions, anthropic, google] = await Promise.all([
    import('@earendil-works/pi-ai'),
    import('@earendil-works/pi-ai/api/openai-responses.lazy'),
    import('@earendil-works/pi-ai/api/openai-completions.lazy'),
    import('@earendil-works/pi-ai/api/anthropic-messages.lazy'),
    import('@earendil-works/pi-ai/api/google-generative-ai.lazy'),
  ]);
  return {
    createModels: pi.createModels,
    createProvider: pi.createProvider,
    apis: {
      'openai-responses': responses.openAIResponsesApi(),
      'openai-completions': completions.openAICompletionsApi(),
      'anthropic-messages': anthropic.anthropicMessagesApi(),
      'google-generative-ai': google.googleGenerativeAIApi(),
    },
  };
}
let runtime: ReturnType<typeof loadRuntime> | undefined;
const getRuntime = () => (runtime ??= loadRuntime());
const zeroUsage: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
@Injectable()
export class LlmService {
  constructor(
    private readonly repository: ModelServicesRepository,
    private readonly catalog: CatalogService,
  ) {}
  async validateChat(id: string) {
    await this.prepare(id);
  }
  private async prepare(id: string) {
    const row = this.repository.getModel(id);
    const channel = this.repository.getChannel(row.channelId);
    const credentials = this.repository.credentials(row.channelId);
    if (!channel.enabled || !row.enabled || row.blockedReason)
      throw new DomainError('MODEL_DISABLED', 422, row.blockedReason ?? '渠道或模型已禁用');
    if (row.kind !== 'chat' || row.capability.kind !== 'chat' || !row.protocolId)
      throw new DomainError('NOT_CHAT_MODEL', 422, '请选择文本模型');
    const descriptor = getProtocol(row.protocolId)!;
    const cap = row.capability;
    const endpoints = resolveEndpoints(channel, row, descriptor);
    const submit = endpoints.operations.submit;
    if (!submit) throw new DomainError('INVALID_ENDPOINT', 422, '缺少提交地址');
    const api = chatRuntime(descriptor);
    const { createModels, createProvider, apis } = await getRuntime();
    const operation = descriptor.operations.submit!.path.replace(
      '{model}',
      encodeURIComponent(row.upstreamModelId),
    );
    if (!submit.url.endsWith(operation))
      throw new DomainError('INVALID_ENDPOINT', 422, '文本运行时要求提交地址保持协议操作后缀');
    const baseUrl = submit.url.slice(0, -operation.length);
    const model: Model<typeof api> = {
      id: row.upstreamModelId,
      name: row.displayName,
      provider: channel.id,
      api,
      baseUrl,
      input: cap.inputModalities.includes('image') ? ['text', 'image'] : ['text'],
      headers: { ...credentials.headers, ...descriptor.fixedHeaders },
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: cap.contextWindow ?? 8192,
      maxTokens: cap.maxOutput ?? 1024,
      reasoning: cap.reasoningLevels.length > 0,
      compat: {},
    };
    const models = createModels();
    models.setProvider(
      createProvider({
        id: channel.id,
        baseUrl,
        headers: model.headers,
        auth: {
          apiKey: {
            name: channel.name,
            resolve: () => Promise.resolve({ auth: { apiKey: credentials.apiKey } }),
          },
        },
        models: [model],
        api: apis,
      }),
    );
    return { models, model, row, cap, endpoint: submit.url };
  }
  private async *run(id: string, context: Context, signal: AbortSignal) {
    const { models, model, cap, endpoint } = await this.prepare(id);
    let status = 0;
    const transport =
      model.api === 'google-generative-ai'
        ? await googleTransport(endpoint, signal, (value) => {
            status = value;
          })
        : undefined;
    const requestModel = transport ? { ...model, baseUrl: transport.baseUrl } : model;
    try {
      const stream = models.streamSimple(requestModel, context, {
        signal,
        maxTokens: model.maxTokens,
        reasoning: model.reasoning ? 'low' : undefined,
        maxRetries: 0,
        timeoutMs: 60000,
        ...(model.api === 'google-generative-ai'
          ? {}
          : {
              fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
                const response = await fetch(input, { ...init, redirect: 'error' });
                status = response.status;
                return response;
              },
            }),
        onPayload: (payload) => {
          const value = payload as Record<string, unknown>;
          const sampling = {
            temperature: 'temperature',
            topP: 'top_p',
            topK: 'top_k',
            presencePenalty: 'presence_penalty',
            frequencyPenalty: 'frequency_penalty',
          };
          for (const [key, wire] of Object.entries(sampling))
            if (!cap.samplingParams.includes(key as keyof typeof sampling)) delete value[wire];
          if (model.api === 'google-generative-ai') {
            const config = {
              ...(value.config as Record<string, unknown>),
              httpOptions: { timeout: 60000, retryOptions: { attempts: 1 } },
            };
            return { ...value, config };
          }
          return value;
        },
        onResponse: (response) => {
          status = response.status;
        },
      });
      for await (const event of stream) {
        if (event.type === 'error') {
          if (status >= 400) throw providerError(status);
          if (signal.aborted) throw connectionError(null, signal);
          throw new DomainError(
            status ? 'UPSTREAM_ERROR' : 'CONNECTION_FAILED',
            422,
            status ? '上游返回错误或流式响应不完整' : '无法连接，请检查地址和网络',
          );
        }
        yield event;
      }
    } finally {
      await transport?.close();
    }
  }
  async test(id: string, parentSignal?: AbortSignal): Promise<ModelCheck> {
    const row = this.repository.getModel(id);
    if (row.kind !== 'chat')
      throw new DomainError('MEDIA_CHECK_REQUIRED', 400, '媒体测试请使用 source: test 的生成任务');
    await this.prepare(id);
    const signal = AbortSignal.any([
      AbortSignal.timeout(60000),
      ...(parentSignal ? [parentSignal] : []),
    ]);
    const check: ModelCheck = {
      type: 'chat',
      ok: false,
      checkedAt: new Date().toISOString(),
      configHash: row.configHash,
      code: null,
      message: '',
    };
    try {
      const channel = this.repository.getChannel(row.channelId);
      try {
        await this.catalog.read(
          { channelId: channel.id, baseUrl: channel.baseUrl, catalogFormat: channel.catalogFormat },
          signal,
        );
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== 'UPSTREAM_ERROR') throw error;
      }
      let complete = false;
      let text = false;
      for await (const event of this.run(
        id,
        { messages: [{ role: 'user', content: '请回复 OK', timestamp: Date.now() }] },
        signal,
      )) {
        if (event.type === 'text_delta' && event.delta) text = true;
        if (event.type === 'done') complete = true;
      }
      check.ok = complete && text;
      check.code = check.ok ? null : 'INCOMPLETE_STREAM';
      check.message = check.ok ? '连接与文本回复测试通过' : '响应不完整';
    } catch (error) {
      const domain = connectionError(error, signal);
      check.code = domain.code;
      check.message = domain.message;
    }
    this.repository.recordCheck(id, check);
    return check;
  }
  async *chat(request: TestChatRequest, parentSignal: AbortSignal): AsyncGenerator<LlmEvent> {
    const { model } = await this.prepare(request.modelId);
    const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(60000)]);
    const context: Context = {
      messages: request.messages.map((message) =>
        message.role === 'user'
          ? { role: 'user' as const, content: message.content, timestamp: Date.now() }
          : {
              role: 'assistant' as const,
              content: [{ type: 'text' as const, text: message.content }],
              api: model.api,
              provider: model.provider,
              model: model.id,
              usage: zeroUsage,
              stopReason: 'stop' as const,
              timestamp: Date.now(),
            },
      ),
    };
    try {
      let complete = false;
      for await (const event of this.run(request.modelId, context, signal)) {
        if (event.type === 'text_delta') yield { type: 'text.delta', delta: event.delta };
        if (event.type === 'thinking_delta') yield { type: 'thinking.delta', delta: event.delta };
        if (event.type === 'done') {
          complete = true;
          yield {
            type: 'done',
            usage: ModelUsage.parse(event.message.usage),
            stopReason: event.reason,
          };
        }
      }
      if (!complete) yield { type: 'error', code: 'INCOMPLETE_STREAM', message: '响应流提前结束' };
    } catch (error) {
      const domain = connectionError(error, signal);
      yield {
        type: 'error',
        code: ProviderErrorCode.catch('UPSTREAM_ERROR').parse(domain.code),
        message: domain.message,
      };
    }
  }
}

import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Context, Model, Usage } from '@earendil-works/pi-ai';
import {
  LlmProtocol,
  ModelMetadata,
  ModelUsage,
  ProviderErrorCode,
  type ChannelModelWrite,
  type ConnectionCheck,
  type LlmEvent,
  type TestChatRequest,
} from '@frame-loom/contracts';
import { ChannelsRepository } from '../channels/channels.repository.js';
import { ChannelsService } from '../channels/channels.service.js';
import { connectionError, providerError } from '../channels/provider-request.js';
import { DomainError } from '../../core/http/domain-error.js';
import { googleTransport } from './google-transport.js';

function compatSchema(schema: unknown) {
  // TypeBox 的结构是 JSON Schema，清除其类型标记后交给 Zod 校验覆盖项。
  return z.fromJSONSchema(
    JSON.parse(JSON.stringify(schema)) as Parameters<typeof z.fromJSONSchema>[0],
  );
}
async function loadRuntime() {
  const [pi, providers, responses, completions, anthropic, google, compat] = await Promise.all([
    import('@earendil-works/pi-ai'),
    import('@earendil-works/pi-ai/providers/all'),
    import('@earendil-works/pi-ai/api/openai-responses.lazy'),
    import('@earendil-works/pi-ai/api/openai-completions.lazy'),
    import('@earendil-works/pi-ai/api/anthropic-messages.lazy'),
    import('@earendil-works/pi-ai/api/google-generative-ai.lazy'),
    import('@earendil-works/pi-ai/providers/compat-schema'),
  ]);
  return {
    createModels: pi.createModels,
    createProvider: pi.createProvider,
    Type: pi.Type,
    catalog: providers
      .getBuiltinProviders()
      .flatMap((provider) => providers.getBuiltinModels(provider)),
    apis: {
      'openai-responses': responses.openAIResponsesApi(),
      'openai-completions': completions.openAICompletionsApi(),
      'anthropic-messages': anthropic.anthropicMessagesApi(),
      'google-generative-ai': google.googleGenerativeAIApi(),
    },
    compatSchemas: {
      'openai-responses': compatSchema({
        ...compat.OpenAIResponsesCompatSchema,
        additionalProperties: false,
      }),
      'openai-completions': compatSchema({
        ...compat.OpenAICompletionsCompatSchema,
        additionalProperties: false,
      }),
      'anthropic-messages': compatSchema({
        ...compat.AnthropicMessagesCompatSchema,
        additionalProperties: false,
      }),
      'google-generative-ai': z.strictObject({}),
    },
  };
}
// 模型目录会加载供应商 SDK，延后到首次使用，避免阻塞引擎 ready 和健康接口。
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
    private readonly repository: ChannelsRepository,
    private readonly channels: ChannelsService,
  ) {}

  async metadata(input: ChannelModelWrite): Promise<ModelMetadata | null> {
    if (input.kind !== 'chat' || !input.protocol) return null;
    const { catalog, compatSchemas } = await getRuntime();
    const protocol = LlmProtocol.parse(input.protocol);
    const known =
      catalog.find((model) => model.id === input.upstreamModelId && model.api === protocol) ??
      catalog.find((model) => model.id === input.upstreamModelId);
    const overrides = input.overrides;
    const compat = z
      .record(z.string(), z.json())
      .parse(overrides.compat ? compatSchemas[protocol].parse(overrides.compat) : {});
    const result = ModelMetadata.parse({
      contextWindow: overrides.contextWindow ?? known?.contextWindow ?? 8192,
      maxTokens: overrides.maxTokens ?? known?.maxTokens ?? 1024,
      reasoning: overrides.reasoning ?? known?.reasoning ?? false,
      imageInput: overrides.imageInput ?? known?.input.includes('image') ?? false,
      needsConfirmation: !known,
      compat: { ...(known?.api === protocol ? known.compat : {}), ...compat },
    });
    if (result.maxTokens > result.contextWindow)
      throw new DomainError('INVALID_LIMITS', 422, '最大输出不能超过上下文长度');
    return result;
  }
  async publicModel(input: ReturnType<ChannelsRepository['getModel']>) {
    return { ...input, metadata: await this.metadata(input) };
  }
  async validateChat(id: string) {
    await this.prepare(id);
  }
  private async prepare(id: string) {
    const row = this.repository.getModel(id);
    const channel = this.repository.getChannel(row.channelId);
    const credentials = this.repository.credentials(row.connection?.credentialRef ?? row.channelId);
    const { apiKey, headers } = credentials;
    if (!channel.enabled || !credentials.channel.enabled || !row.enabled)
      throw new DomainError('MODEL_DISABLED', 422, '渠道或模型已禁用');
    if (row.kind !== 'chat' || !row.protocol)
      throw new DomainError('NOT_CHAT_MODEL', 422, '请选择文本模型');
    const metadata = (await this.metadata(row))!;
    const { createModels, createProvider, apis } = await getRuntime();
    const api = LlmProtocol.parse(row.protocol);
    const model: Model<LlmProtocol> = {
      id: row.upstreamModelId,
      name: row.displayName,
      provider: channel.id,
      api,
      baseUrl: row.connection?.baseUrl?.replace(/\/+$/, '') ?? channel.baseUrl.replace(/\/+$/, ''),
      input: metadata.imageInput ? ['text', 'image'] : ['text'],
      headers,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: metadata.contextWindow,
      maxTokens: metadata.maxTokens,
      reasoning: metadata.reasoning,
      compat: metadata.compat,
    };
    const models = createModels();
    models.setProvider(
      createProvider({
        id: channel.id,
        baseUrl: row.connection?.baseUrl ?? channel.baseUrl,
        headers,
        auth: {
          apiKey: { name: channel.name, resolve: () => Promise.resolve({ auth: { apiKey } }) },
        },
        models: [model],
        api: apis,
      }),
    );
    return { models, model, row, metadata };
  }

  private async *run(id: string, context: Context, signal: AbortSignal) {
    const { models, model } = await this.prepare(id);
    let status = 0;
    const transport =
      model.api === 'google-generative-ai'
        ? await googleTransport(model.baseUrl, signal, (value) => {
            status = value;
          })
        : undefined;
    const requestModel = transport ? { ...model, baseUrl: transport.baseUrl } : model;
    try {
      const stream = models.streamSimple(requestModel, context, {
        signal,
        maxTokens: Math.min(model.maxTokens, 2048),
        reasoning: model.reasoning ? 'low' : undefined,
        maxRetries: 0,
        timeoutMs: 60_000,
        // 禁止携带凭据跟随重定向，也不把 SDK 或上游正文暴露给 renderer。
        ...(model.api === 'google-generative-ai'
          ? {}
          : {
              fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
                const response = await fetch(input, { ...init, redirect: 'error' });
                status = response.status;
                return response;
              },
            }),
        onPayload:
          model.api === 'google-generative-ai'
            ? (payload) => {
                const value = payload as Record<string, unknown>;
                return {
                  ...value,
                  config: {
                    ...(value.config as Record<string, unknown>),
                    httpOptions: { timeout: 60_000, retryOptions: { attempts: 1 } },
                  },
                };
              }
            : undefined,
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

  async test(id: string, parentSignal?: AbortSignal): Promise<ConnectionCheck> {
    const { row, metadata } = await this.prepare(id);
    const { Type } = await getRuntime();
    const result: ConnectionCheck = {
      ok: false,
      checkedAt: new Date().toISOString(),
      code: null,
      message: '',
      steps: { connection: false, text: false, toolCall: false, usage: false, thinking: false },
      usage: null,
    };
    const signal = AbortSignal.any([
      AbortSignal.timeout(60_000),
      ...(parentSignal ? [parentSignal] : []),
    ]);
    try {
      // 不支持列举模型的平台允许用最小文本请求完成第一步。
      try {
        await this.channels.remoteModels(row.channelId, signal);
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== 'UPSTREAM_ERROR') throw error;
        let completed = false;
        for await (const event of this.run(
          id,
          { messages: [{ role: 'user', content: '请回复 OK', timestamp: Date.now() }] },
          signal,
        ))
          if (event.type === 'done') completed = true;
        if (!completed) throw new DomainError('INCOMPLETE_STREAM', 422, '最小请求未完成');
      }
      result.steps.connection = true;
      let completed = false;
      const tools = [
        {
          name: 'connection_probe',
          description: '连通测试，请调用此工具且参数为 OK',
          parameters: Type.Object({ value: Type.Literal('OK') }),
        },
      ];
      for await (const event of this.run(
        id,
        {
          messages: [
            {
              role: 'user',
              content: '先输出文字 OK，再调用 connection_probe，value 为 OK。',
              timestamp: Date.now(),
            },
          ],
          tools,
        },
        signal,
      )) {
        if (event.type === 'text_delta' && event.delta) result.steps.text = true;
        if (
          (event.type === 'thinking_delta' && event.delta) ||
          (event.type === 'thinking_end' && event.content)
        )
          result.steps.thinking = true;
        if (
          event.type === 'toolcall_end' &&
          event.toolCall.name === 'connection_probe' &&
          event.toolCall.arguments.value === 'OK' &&
          !event.toolCall.argumentsError
        )
          result.steps.toolCall = true;
        if (event.type === 'done') {
          completed = true;
          result.usage = ModelUsage.parse(event.message.usage);
          result.steps.usage = result.usage.totalTokens > 0 && result.usage.output > 0;
        }
      }
      result.ok =
        completed &&
        result.steps.text &&
        result.steps.toolCall &&
        result.steps.usage &&
        (!metadata.reasoning || result.steps.thinking);
      result.code = result.ok ? null : 'INCOMPLETE_STREAM';
      result.message = result.ok
        ? '两步测试通过：文本、工具调用与用量完整'
        : '响应不完整，请检查文本、工具调用、用量或推理事件';
    } catch (error) {
      const domain = connectionError(error, signal);
      result.code = ProviderErrorCode.catch('UPSTREAM_ERROR').parse(domain.code);
      result.message = domain.message;
    }
    this.repository.recordCheck(id, result, true);
    return result;
  }

  async *chat(request: TestChatRequest, parentSignal: AbortSignal): AsyncGenerator<LlmEvent> {
    const { model } = await this.prepare(request.modelId);
    const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(60_000)]);
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
      let completed = false;
      for await (const event of this.run(request.modelId, context, signal)) {
        if (event.type === 'text_delta') yield { type: 'text.delta', delta: event.delta };
        if (event.type === 'thinking_delta') yield { type: 'thinking.delta', delta: event.delta };
        if (event.type === 'done') {
          completed = true;
          yield {
            type: 'done',
            usage: ModelUsage.parse(event.message.usage),
            stopReason: event.reason,
          };
        }
      }
      if (!completed) yield { type: 'error', code: 'INCOMPLETE_STREAM', message: '响应流提前结束' };
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

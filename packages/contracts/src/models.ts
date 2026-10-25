import { z } from 'zod';
import { ImageProtocol, VideoProtocol } from './generation.js';

export const ModelKind = z.enum(['chat', 'image', 'video', 'tts']);
export type ModelKind = z.infer<typeof ModelKind>;
export const LlmProtocol = z.enum([
  'openai-responses',
  'openai-completions',
  'anthropic-messages',
  'google-generative-ai',
]);
export type LlmProtocol = z.infer<typeof LlmProtocol>;
/** 每个类别可选的调用协议；renderer 用于过滤下拉，engine 用于保存前校验。 */
export const protocolsByKind: Record<ModelKind, readonly string[]> = {
  chat: LlmProtocol.options,
  image: ImageProtocol.options,
  video: VideoProtocol.options,
  tts: ['openai-speech', 'minimax-t2a'],
};

export const ProviderErrorCode = z.enum([
  'AUTH_FAILED',
  'CONNECTION_FAILED',
  'RATE_LIMITED',
  'UPSTREAM_ERROR',
  'INVALID_RESPONSE',
  'INCOMPLETE_STREAM',
  'REQUEST_TIMEOUT',
  'REQUEST_ABORTED',
]);
export type ProviderErrorCode = z.infer<typeof ProviderErrorCode>;
export const ModelUsage = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative(),
  totalTokens: z.number().nonnegative(),
});
export type ModelUsage = z.infer<typeof ModelUsage>;
export const ConnectionCheck = z.object({
  ok: z.boolean(),
  checkedAt: z.string().datetime(),
  code: ProviderErrorCode.nullable(),
  message: z.string(),
  steps: z.object({
    connection: z.boolean(),
    text: z.boolean(),
    toolCall: z.boolean(),
    usage: z.boolean(),
    thinking: z.boolean(),
  }),
  usage: ModelUsage.nullable(),
});
export type ConnectionCheck = z.infer<typeof ConnectionCheck>;

const BaseUrl = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }, '地址只允许 HTTP(S)，不能包含凭据、查询参数或片段');
const HeaderName = z
  .string()
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)
  .refine(
    (value) =>
      ![
        'host',
        'connection',
        'content-length',
        'content-type',
        'transfer-encoding',
        'authorization',
        'x-api-key',
        'x-goog-api-key',
        'api-key',
      ].includes(value.toLowerCase()),
    '鉴权头请使用密钥字段，不能覆盖传输头',
  );
const Headers = z
  .record(
    HeaderName,
    z
      .string()
      .max(8192)
      .regex(/^[^\r\n]*$/),
  )
  .refine((value) => Object.keys(value).length <= 32);
const ChannelFields = {
  name: z.string().trim().min(1).max(100),
  /** 渠道 API 格式：决定拉取模型列表的路径与鉴权，并作为新建文本模型的默认协议。 */
  apiFormat: LlmProtocol,
  baseUrl: BaseUrl,
  apiKey: z.string().max(8192).optional(),
  headers: Headers.optional(),
  enabled: z.boolean(),
};
export const ModelProbeRequest = z.strictObject({
  apiFormat: LlmProtocol,
  baseUrl: BaseUrl,
  apiKey: z.string().max(8192).optional(),
  headers: Headers.optional(),
  /** 编辑已有渠道时，未填写的密钥与请求头使用该渠道已保存的值。 */
  channelId: z.string().uuid().optional(),
});
export type ModelProbeRequest = z.infer<typeof ModelProbeRequest>;
export const ModelProbeResult = z.array(z.string());
export const Channel = z.strictObject({
  id: z.string().uuid(),
  name: z.string(),
  apiFormat: LlmProtocol,
  baseUrl: BaseUrl,
  enabled: z.boolean(),
  hasKey: z.boolean(),
  keyHint: z.string().nullable(),
  headerNames: z.array(z.string()),
  lastCheck: ConnectionCheck.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Channel = z.infer<typeof Channel>;

export const ModelOverrides = z.strictObject({
  concurrency: z.number().int().min(1).max(16).optional(),
  contextWindow: z.number().int().min(1).max(10_000_000).optional(),
  maxTokens: z.number().int().min(1).max(1_000_000).optional(),
  reasoning: z.boolean().optional(),
  imageInput: z.boolean().optional(),
  compat: z.record(z.string().max(100), z.json()).optional(),
});
export type ModelOverrides = z.infer<typeof ModelOverrides>;
export const ModelMetadata = z.object({
  contextWindow: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
  reasoning: z.boolean(),
  imageInput: z.boolean(),
  needsConfirmation: z.boolean(),
  compat: z.record(z.string(), z.json()),
});
export type ModelMetadata = z.infer<typeof ModelMetadata>;
export const ChannelModelWrite = z.strictObject({
  upstreamModelId: z.string().trim().min(1).max(300),
  displayName: z.string().trim().min(1).max(300),
  kind: ModelKind.nullable(),
  protocol: z.string().min(1).max(100).nullable(),
  profileId: z.string().min(1).max(100).nullable(),
  overrides: ModelOverrides,
  enabled: z.boolean(),
});
export type ChannelModelWrite = z.infer<typeof ChannelModelWrite>;
export const ChannelModelPatch = ChannelModelWrite.partial();
/** 随渠道一并保存的模型；带 id 为更新，不带为新增，未出现的已有模型被删除。 */
export const ChannelModelSave = ChannelModelWrite.extend({ id: z.string().uuid().optional() });
export type ChannelModelSave = z.infer<typeof ChannelModelSave>;
export const ChannelWrite = z.strictObject({
  ...ChannelFields,
  models: z.array(ChannelModelSave).max(500).optional(),
});
export type ChannelWrite = z.infer<typeof ChannelWrite>;
export const ChannelPatch = ChannelWrite.partial();
export const ChannelModel = z.strictObject({
  ...ChannelModelWrite.shape,
  id: z.string().uuid(),
  channelId: z.string().uuid(),
  metadata: ModelMetadata.nullable(),
  lastCheck: ConnectionCheck.nullable(),
});
export type ChannelModel = z.infer<typeof ChannelModel>;
export const ChannelList = z.array(Channel);
export const ChannelModelList = z.array(ChannelModel);
export const ModelDefaults = z.object({
  chat: z.string().uuid().nullable(),
  image: z.string().uuid().nullable(),
  video: z.string().uuid().nullable(),
  tts: z.string().uuid().nullable(),
});
export type ModelDefaults = z.infer<typeof ModelDefaults>;
export const ModelDefaultsPatch = ModelDefaults.partial().strict();
export const DeleteResult = z.object({ deleted: z.literal(true) });

export const TestChatRequest = z.strictObject({
  modelId: z.string().uuid(),
  messages: z
    .array(
      z.strictObject({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(32_000),
      }),
    )
    .min(1)
    .max(50),
});
export type TestChatRequest = z.infer<typeof TestChatRequest>;
export const LlmEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text.delta'), delta: z.string() }),
  z.object({ type: z.literal('thinking.delta'), delta: z.string() }),
  z.object({ type: z.literal('done'), usage: ModelUsage, stopReason: z.string() }),
  z.object({ type: z.literal('error'), code: ProviderErrorCode, message: z.string() }),
]);
export type LlmEvent = z.infer<typeof LlmEvent>;

import { z } from 'zod';

export const ModelKind = z.enum(['chat', 'image', 'video', 'tts']);
export type ModelKind = z.infer<typeof ModelKind>;
export const LlmProtocol = z.enum([
  'openai-responses',
  'openai-completions',
  'anthropic-messages',
  'google-generative-ai',
]);
export type LlmProtocol = z.infer<typeof LlmProtocol>;
export const ChannelPreset = z.enum([
  'openai',
  'anthropic',
  'gemini',
  'ark',
  'minimax',
  'openrouter',
  'openai-compatible',
]);
export type ChannelPreset = z.infer<typeof ChannelPreset>;
export const channelPresets: Record<
  ChannelPreset,
  { name: string; baseUrl: string; protocol: LlmProtocol }
> = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', protocol: 'openai-responses' },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    protocol: 'anthropic-messages',
  },
  gemini: {
    name: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    protocol: 'google-generative-ai',
  },
  ark: {
    name: '火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    protocol: 'openai-completions',
  },
  minimax: {
    name: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    protocol: 'anthropic-messages',
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    protocol: 'openai-completions',
  },
  'openai-compatible': { name: '通用中转站', baseUrl: '', protocol: 'openai-completions' },
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
export const ChannelWrite = z.strictObject({
  name: z.string().trim().min(1).max(100),
  preset: ChannelPreset,
  baseUrl: BaseUrl,
  apiKey: z.string().max(8192).optional(),
  headers: z
    .record(
      HeaderName,
      z
        .string()
        .max(8192)
        .regex(/^[^\r\n]*$/),
    )
    .refine((value) => Object.keys(value).length <= 32)
    .optional(),
  enabled: z.boolean(),
});
export type ChannelWrite = z.infer<typeof ChannelWrite>;
export const ChannelPatch = ChannelWrite.partial();
export const Channel = z.strictObject({
  id: z.string().uuid(),
  name: z.string(),
  preset: ChannelPreset,
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

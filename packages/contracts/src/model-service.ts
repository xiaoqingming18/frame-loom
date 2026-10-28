import { z } from 'zod';
import { Capability } from './capabilities.js';
import { Value } from './semantic-request.js';

export const ModelKind = z.enum(['chat', 'image', 'video', 'tts']);
export type ModelKind = z.infer<typeof ModelKind>;
export const CatalogFormat = z.enum(['openai', 'anthropic', 'gemini']);
export type CatalogFormat = z.infer<typeof CatalogFormat>;
export const Operation = z.enum(['submit', 'edit', 'query', 'content', 'voices']);
export type Operation = z.infer<typeof Operation>;
export const MediaTransport = z.enum(['auto', 'inline', 'url']);
export type MediaTransport = z.infer<typeof MediaTransport>;
const HttpUrl = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !/[\\\u0000-\u0020]/.test(value)
    );
  }, '地址只允许 HTTP(S)，不能包含凭据、片段或非法字符');
export const ServiceUrl = HttpUrl.refine(
  (value) => !new URL(value).search,
  '服务地址不能包含查询参数',
).refine(
  (value) =>
    !/\/(chat\/completions|responses|messages|models|images\/generations|audio\/speech)\/?$/.test(
      new URL(value).pathname,
    ),
  '请填写服务根地址',
);
export const OverrideUrl = HttpUrl.refine(
  (value) => !/[{}]/.test(value.replace(/\{(?:id|model|voice_id)\}/g, '')),
  '地址包含不支持的占位符',
);
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
        'xi-api-key',
        'api-key',
        'token',
        'cookie',
        'proxy-authorization',
      ].includes(value.toLowerCase()),
    '鉴权头请使用密钥字段，不能覆盖传输头',
  );
export const ChannelHeaders = z
  .record(
    HeaderName,
    z
      .string()
      .max(8192)
      .regex(/^[^\r\n]*$/),
  )
  .refine((value) => Object.keys(value).length <= 32, '请求头最多 32 个');
export const ChannelWrite = z.strictObject({
  name: z.string().trim().min(1).max(100),
  baseUrl: ServiceUrl,
  apiKey: z.string().max(8192).optional(),
  secretKey: z.string().max(8192).optional(),
  headers: ChannelHeaders.optional(),
  catalogFormat: CatalogFormat.default('openai'),
  concurrency: z.number().int().min(1).max(16).default(2),
  enabled: z.boolean(),
});
export type ChannelWrite = z.infer<typeof ChannelWrite>;
export const ChannelPatch = ChannelWrite.partial();
export type ChannelPatch = z.infer<typeof ChannelPatch>;
export const Channel = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  baseUrl: ServiceUrl,
  catalogFormat: CatalogFormat,
  concurrency: z.number().int().min(1).max(16),
  enabled: z.boolean(),
  hasKey: z.boolean(),
  keyHint: z.string().nullable(),
  hasSecretKey: z.boolean(),
  headerNames: z.array(z.string()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Channel = z.infer<typeof Channel>;
export const EndpointOverride = z.strictObject({
  submitUrl: OverrideUrl.optional(),
  operations: z.partialRecord(Operation, OverrideUrl).optional(),
  confirmedHosts: z
    .array(
      z
        .string()
        .min(1)
        .refine((v) => v === v.toLowerCase() && !/[\s/@?#]/.test(v), '请填写小写主机名，可带端口'),
    )
    .max(8)
    .default([]),
});
export type EndpointOverride = z.infer<typeof EndpointOverride>;
const FieldPath = z
  .string()
  .regex(/^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*){0,7}$/)
  .refine(
    (value) =>
      !value.split('.').some((part) => ['__proto__', 'prototype', 'constructor'].includes(part)),
    '不允许原型字段',
  );
export const ExtraParam = z
  .strictObject({
    key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
    label: z.string().min(1).max(40),
    type: z.enum(['string', 'number', 'boolean', 'enum']),
    values: z.array(Value).max(50).optional(),
    default: Value.optional(),
    path: FieldPath,
  })
  .superRefine((v, ctx) => {
    if (v.type === 'enum' && !v.values?.length)
      ctx.addIssue({ code: 'custom', path: ['values'], message: '枚举必须提供可选值' });
    if (
      v.default !== undefined &&
      (v.type === 'enum' ? !v.values?.includes(v.default) : typeof v.default !== v.type)
    )
      ctx.addIssue({ code: 'custom', path: ['default'], message: '默认值类型不匹配' });
  });
export type ExtraParam = z.infer<typeof ExtraParam>;
export const FixedField = z.strictObject({
  path: FieldPath,
  value: z
    .json()
    .refine(
      (value) => new TextEncoder().encode(JSON.stringify(value)).length <= 4096,
      '固定字段最多 4096 字节',
    ),
});
export type FixedField = z.infer<typeof FixedField>;
export const ModelWrite = z
  .strictObject({
    kind: ModelKind,
    upstreamModelId: z.string().trim().min(1).max(300),
    displayName: z.string().trim().min(1).max(300),
    protocolId: z.string().min(1).max(100).nullable(),
    endpointOverride: EndpointOverride.default({ confirmedHosts: [] }),
    transport: z
      .strictObject({
        image: MediaTransport.optional(),
        video: MediaTransport.optional(),
        audio: MediaTransport.optional(),
      })
      .default({}),
    capability: Capability,
    extras: z.array(ExtraParam).max(30).default([]),
    fixedFields: z.array(FixedField).max(30).default([]),
    concurrency: z.number().int().min(1).max(16).optional(),
    enabled: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.kind !== value.capability.kind)
      ctx.addIssue({ code: 'custom', path: ['capability'], message: '能力卡类别与模型不一致' });
    if (new Set(value.extras.map((item) => item.key)).size !== value.extras.length)
      ctx.addIssue({ code: 'custom', path: ['extras'], message: '附加参数键不能重复' });
    const paths = [...value.extras, ...value.fixedFields].map((item) => item.path);
    if (new Set(paths).size !== paths.length)
      ctx.addIssue({ code: 'custom', path: ['fixedFields'], message: '请求字段路径不能重复' });
  });
export type ModelWrite = z.infer<typeof ModelWrite>;
export const ModelCheck = z.strictObject({
  type: z.enum(['chat', 'media']),
  ok: z.boolean(),
  checkedAt: z.iso.datetime(),
  configHash: z.string(),
  mode: z.string().optional(),
  jobId: z.uuid().optional(),
  code: z.string().nullable(),
  message: z.string(),
});
export type ModelCheck = z.infer<typeof ModelCheck>;
export const Model = ModelWrite.safeExtend({
  id: z.uuid(),
  channelId: z.uuid(),
  configHash: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  endpoints: z.strictObject({
    operations: z.partialRecord(
      Operation,
      z.strictObject({ method: z.enum(['GET', 'POST']), url: z.string(), template: z.boolean() }),
    ),
    foreignHosts: z.array(z.string()),
    issues: z.array(z.string()),
  }),
  blockedReason: z.string().nullable(),
  lastCheck: ModelCheck.nullable(),
});
export type Model = z.infer<typeof Model>;
export const CatalogRequest = z.strictObject({
  baseUrl: ServiceUrl,
  catalogFormat: CatalogFormat,
  apiKey: z.string().max(8192).optional(),
  headers: ChannelHeaders.optional(),
  channelId: z.uuid().optional(),
});
export type CatalogRequest = z.infer<typeof CatalogRequest>;
export const CatalogCandidate = z.strictObject({
  id: z.string(),
  endpointTypes: z.array(z.string()),
  outputModalities: z.array(z.string()),
  kind: ModelKind.nullable(),
  protocolId: z.string().nullable(),
});
export type CatalogCandidate = z.infer<typeof CatalogCandidate>;
export const ModelDefaults = z.strictObject({
  chat: z.uuid().nullable(),
  image: z.uuid().nullable(),
  video: z.uuid().nullable(),
  tts: z.uuid().nullable(),
});
export type ModelDefaults = z.infer<typeof ModelDefaults>;
export const ModelDefaultsPatch = ModelDefaults.partial();
export const ModelExport = z.strictObject({
  schema: z.literal('frame-loom.model'),
  schemaVersion: z.literal(1),
  model: z.strictObject({
    ...ModelWrite.shape,
    enabled: z.never().optional(),
    endpointOverride: EndpointOverride.omit({ confirmedHosts: true }),
  }),
});
export type ModelExport = z.infer<typeof ModelExport>;

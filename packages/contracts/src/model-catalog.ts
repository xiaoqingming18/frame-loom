import { z } from 'zod';
import { ImageProtocol, MediaProtocol, VideoProtocol } from './generation.js';
import { LlmProtocol, RelativePath } from './models.js';

const Identifier = z.string().regex(/^[a-z][a-z0-9._-]{1,127}$/);
const Version = z.string().regex(/^v\d+(?:\.\d+){0,2}$/);
const CatalogUrl = z.url().refine((value) => {
  const url = new URL(value);
  return (
    ['http:', 'https:'].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  );
}, '服务地址只允许不带凭据和查询参数的 HTTP(S) 地址');

export const ServiceConnectionProtocol = z.union([
  LlmProtocol,
  ImageProtocol,
  VideoProtocol,
  z.enum(['openai-speech', 'minimax-t2a', 'kling-video', 'wan-video']),
]);
export type ServiceConnectionProtocol = z.infer<typeof ServiceConnectionProtocol>;

export const ServiceConnectionDefinition = z
  .strictObject({
    id: Identifier,
    version: Version,
    name: z.string().trim().min(1).max(120),
    protocol: ServiceConnectionProtocol,
    baseUrl: CatalogUrl,
    routes: z.record(z.string().min(1).max(40), RelativePath).default({}),
    credentialRef: Identifier.optional(),
    auth: z.enum(['bearer', 'api-key', 'custom-header', 'none']).default('bearer'),
    operations: z
      .array(z.enum(['submit', 'edit', 'query', 'content', 'upload', 'catalog']))
      .max(20),
    capabilities: z
      .strictObject({
        upload: z.enum(['inline', 'url', 'provider-file']).default('inline'),
        idempotency: z.boolean().default(false),
        cancel: z.boolean().default(false),
      })
      .default({ upload: 'inline', idempotency: false, cancel: false }),
  })
  .superRefine((value, ctx) => {
    if (value.routes.submit?.includes('{') && !value.routes.submit.includes('{model}'))
      ctx.addIssue({
        code: 'custom',
        path: ['routes', 'submit'],
        message: '提交路径只允许 {model} 占位符',
      });
  });
export type ServiceConnectionDefinition = z.infer<typeof ServiceConnectionDefinition>;

const ModelOperation = z.object({
  id: Identifier,
  status: z.enum(['supported', 'declared', 'unsupported']),
  input: z.record(z.string().max(80), z.unknown()).optional(),
});
export const ModelDefinition = z.strictObject({
  id: Identifier,
  version: Version,
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['chat', 'image', 'video', 'tts']),
  protocol: ServiceConnectionProtocol,
  aliases: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  operations: z.array(ModelOperation).min(1).max(32),
  capabilityVersion: Version,
  evidence: z.array(z.string().url()).max(20).default([]),
  profile: z.record(z.string().max(80), z.unknown()).default({}),
});
export type ModelDefinition = z.infer<typeof ModelDefinition>;

export const ModelBinding = z.strictObject({
  id: z.string().uuid().optional(),
  channelId: z.string().uuid(),
  connectionId: Identifier,
  modelDefinitionId: Identifier,
  upstreamModelId: z.string().trim().min(1).max(300),
  alias: z.string().trim().min(1).max(200).optional(),
  capabilityLimit: z.record(z.string().max(80), z.unknown()).default({}),
  enabled: z.boolean().default(true),
});
export type ModelBinding = z.infer<typeof ModelBinding>;

const MappingValue = z.union([z.string().max(200), z.number().finite(), z.boolean()]);
export const MappingRule = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('field'),
    from: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,79}$/),
    to: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,79}$/),
  }),
  z.object({
    type: z.literal('constant'),
    to: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,79}$/),
    value: MappingValue,
  }),
  z.object({
    type: z.literal('convert'),
    from: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,79}$/),
    to: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,79}$/),
    conversion: z.enum(['string', 'number', 'boolean', 'enum']),
    values: z.record(z.string().max(80), MappingValue).optional(),
  }),
]);
export type MappingRule = z.infer<typeof MappingRule>;
export const MappingDefinition = z.strictObject({
  version: Version,
  rules: z.array(MappingRule).max(100),
  inputRoles: z
    .partialRecord(z.enum(['reference', 'first_frame', 'last_frame', 'audio']), z.string().max(80))
    .default({}),
});
export type MappingDefinition = z.infer<typeof MappingDefinition>;

export const ModelImportPackage = z.strictObject({
  schema: z.literal('frame-loom.model-package'),
  schemaVersion: z.literal(1),
  source: z.string().trim().min(1).max(500),
  requires: z
    .array(z.object({ name: Identifier, version: Version }))
    .max(20)
    .default([]),
  connections: z.array(ServiceConnectionDefinition).max(50).default([]),
  definitions: z.array(ModelDefinition).max(500),
  bindings: z.array(ModelBinding).max(1000).default([]),
  mappings: z.record(Identifier, MappingDefinition).default({}),
});
export type ModelImportPackage = z.infer<typeof ModelImportPackage>;

export function validateMapping(mapping: MappingDefinition) {
  const parsed = MappingDefinition.parse(mapping);
  for (const rule of parsed.rules) {
    if (rule.type === 'convert' && rule.conversion === 'enum' && !rule.values)
      throw new z.ZodError([
        { code: 'custom', path: ['rules'], message: '枚举转换必须提供有限映射表' },
      ]);
  }
  return parsed;
}

export function effectiveCapabilities(
  definition: ModelDefinition,
  connection: ServiceConnectionDefinition,
  limit: Record<string, unknown> = {},
) {
  const declared = new Set(
    definition.operations
      .filter((operation) => operation.status === 'supported')
      .map((operation) => operation.id),
  );
  const operations = connection.operations.filter((operation) => declared.has(operation));
  return { ...definition.profile, ...limit, operations };
}

export const sevenVideoModelIds = [
  'seedance-2.5',
  'seedance-2.0',
  'seedance-2.0-fast',
  'kling-4.0',
  'kling-3.0',
  'wan-3.0',
  'minimax-h3',
] as const;

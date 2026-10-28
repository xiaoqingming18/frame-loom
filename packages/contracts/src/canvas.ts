import { z } from 'zod';
import { ImageEditRecipe } from './image-edit.js';
import { Sha256, MediaFile } from './generation-job.js';
import { InputRole, SemanticParams, Value, VideoModeId } from './semantic-request.js';

export const CANVAS_LIMITS = { nodes: 2000, edges: 4000, bytes: 8 * 1024 * 1024 } as const;
export const canvasDocumentBytes = (document: unknown): number =>
  new TextEncoder().encode(JSON.stringify(document)).byteLength;
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const CanvasId = z.string().regex(/^[a-z0-9-]{1,64}$/);
const Finite = z.number().finite();

export const CanvasGroupColor = z.enum([
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'purple',
]);
export type CanvasGroupColor = z.infer<typeof CanvasGroupColor>;
export const CanvasGroupData = z.strictObject({ color: CanvasGroupColor });
export type CanvasGroupData = z.infer<typeof CanvasGroupData>;

export const CanvasMediaVersion = z.strictObject({
  sha256: Sha256,
  mime: z.string().max(100),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().nonnegative().nullable().optional(),
  bytes: z.number().int().nonnegative().optional(),
  fps: z.number().positive().nullable().optional(),
  codec: z.string().nullable().optional(),
  audioCodec: z.string().nullable().optional(),
  sampleRate: z.number().int().positive().nullable().optional(),
  channels: z.number().int().positive().nullable().optional(),
  posterSha256: Sha256.optional(),
  jobId: z.string().uuid().optional(),
  createdAt: z.string().datetime(),
});
export type CanvasMediaVersion = z.infer<typeof CanvasMediaVersion>;
export const CanvasMediaData = z
  .strictObject({
    versions: z.array(CanvasMediaVersion).max(100),
    activeVersion: z.number().int().nonnegative(),
    prompt: z.string().max(32_000),
    mode: VideoModeId.optional(),
    inputOrder: z.array(Id).max(64),
    modelId: z.string().uuid().optional(),
    params: SemanticParams.optional(),
    pendingParams: SemanticParams.optional(),
    extras: z.record(z.string(), Value).optional(),
    mediaReferences: z
      .array(
        z.strictObject({
          id: Id,
          name: z.string().max(200),
          role: InputRole,
          media: MediaFile,
        }),
      )
      .max(50)
      .optional(),
    pendingJobId: z.string().uuid().optional(),
    pendingJobIds: z.array(z.string().uuid()).optional(),
    count: z.number().int().min(1).optional(),
    imageEdit: ImageEditRecipe.optional(),
  })
  .refine(
    (data) => data.versions.length === 0 || data.activeVersion < data.versions.length,
    '当前版本超出范围',
  );
export type CanvasMediaData = z.infer<typeof CanvasMediaData>;

/** 仅转换已发布的旧字段；未知参数不带入新的语义请求。 */
export function migrateCanvasMediaData(value: unknown, hasLastFrame = false): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const data = value as Record<string, unknown>;
  const aliases: Record<string, string> = {
    ratio: 'aspectRatio',
    aspect_ratio: 'aspectRatio',
    seconds: 'duration',
    generate_audio: 'audio',
    sound: 'audio',
  };
  const keys = new Set<string>(SemanticParams.keyof().options);
  const params = (raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const entries = Object.entries(raw);
    return Object.fromEntries(
      entries
        .filter(([key]) => keys.has(key) || Object.hasOwn(aliases, key))
        .sort(([a], [b]) => Number(keys.has(a)) - Number(keys.has(b)))
        .map(([key, value]) => [aliases[key] ?? key, value]),
    );
  };
  const { pendingJobId, ...rest } = data;
  const localLast =
    Array.isArray(data.mediaReferences) &&
    data.mediaReferences.some(
      (ref: unknown) =>
        !!ref && typeof ref === 'object' && 'role' in ref && ref.role === 'last_frame',
    );
  return {
    ...rest,
    ...(data.mode !== undefined
      ? {
          mode:
            data.mode === 'text'
              ? 't2v'
              : data.mode === 'frames'
                ? hasLastFrame || localLast
                  ? 'first_last'
                  : 'first'
                : data.mode,
        }
      : {}),
    ...(data.params !== undefined ? { params: params(data.params) } : {}),
    ...(data.pendingParams !== undefined ? { pendingParams: params(data.pendingParams) } : {}),
    ...(pendingJobId && !data.pendingJobIds ? { pendingJobIds: [pendingJobId] } : {}),
  };
}

/** 内置节点类型的 data schema；其他类型由前端注册表校验，engine 原样保存。 */
export const CANVAS_BUILTIN_DATA: Record<string, z.ZodType> = {
  image: CanvasMediaData,
  video: CanvasMediaData,
  audio: CanvasMediaData,
  group: CanvasGroupData,
};

export const CanvasNode = z.strictObject({
  id: Id,
  type: z.string().regex(/^[a-z][a-z0-9-]{0,63}(:[a-z][a-z0-9-]{0,63})?$/),
  typeVersion: z.number().int().positive(),
  position: z.strictObject({ x: Finite, y: Finite }),
  size: z.strictObject({
    width: z.number().positive().max(20_000),
    height: z.number().positive().max(20_000),
  }),
  parentId: Id.optional(),
  title: z.string().max(200).optional(),
  locked: z.boolean().optional(),
  tagId: z
    .string()
    .regex(/^[a-z0-9-]{1,64}$/)
    .optional(),
  data: z.unknown(),
});
export type CanvasNode = z.infer<typeof CanvasNode>;
export const TAGGABLE_NODE_TYPES = ['image', 'video', 'audio'] as const;
const HandleId = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);
export const CanvasEdge = z.strictObject({
  id: Id,
  source: Id,
  target: Id,
  sourceHandle: HandleId,
  targetHandle: HandleId,
});
export type CanvasEdge = z.infer<typeof CanvasEdge>;

export const CanvasDocument = z
  .strictObject({
    schemaVersion: z.literal(1),
    nodes: z.array(CanvasNode).max(CANVAS_LIMITS.nodes),
    edges: z.array(CanvasEdge).max(CANVAS_LIMITS.edges),
  })
  .transform((document) => ({
    ...document,
    nodes: document.nodes.map((node) =>
      (node.type === 'image' || node.type === 'video') && node.typeVersion < 3
        ? {
            ...node,
            typeVersion: 3,
            data: migrateCanvasMediaData(
              node.data,
              document.edges.some(
                (edge) => edge.target === node.id && edge.targetHandle === 'last_frame',
              ),
            ),
          }
        : node,
    ),
  }))
  .superRefine((document, context) => {
    if (canvasDocumentBytes(document) > CANVAS_LIMITS.bytes)
      context.addIssue({ code: 'custom', message: '画布文档不能超过 8 MiB' });
    const seen = new Map<string, CanvasNode>();
    document.nodes.forEach((node, index) => {
      const path = ['nodes', index];
      if (
        node.tagId !== undefined &&
        !TAGGABLE_NODE_TYPES.includes(node.type as (typeof TAGGABLE_NODE_TYPES)[number])
      )
        context.addIssue({
          code: 'custom',
          path: [...path, 'tagId'],
          message: '此节点类型不支持标签',
        });
      if (seen.has(node.id)) context.addIssue({ code: 'custom', path, message: '节点 id 重复' });
      if (node.parentId) {
        const parent = seen.get(node.parentId);
        // xyflow 要求父节点排在子节点之前；首期只支持一层分组。
        if (!parent || parent.type !== 'group' || parent.parentId || node.type === 'group')
          context.addIssue({ code: 'custom', path, message: '父节点必须是排在前面的顶层分组' });
      }
      const schema = Object.hasOwn(CANVAS_BUILTIN_DATA, node.type)
        ? CANVAS_BUILTIN_DATA[node.type]
        : undefined;
      const result = schema?.safeParse(node.data);
      if (result && !result.success)
        for (const issue of result.error.issues)
          context.addIssue({
            code: 'custom',
            path: [...path, 'data', ...issue.path.map(String)],
            message: issue.message,
          });
      seen.set(node.id, node);
    });
    const edges = new Set<string>();
    document.edges.forEach((edge, index) => {
      const path = ['edges', index];
      if (edges.has(edge.id)) context.addIssue({ code: 'custom', path, message: '连线 id 重复' });
      edges.add(edge.id);
      if (!seen.has(edge.source) || !seen.has(edge.target) || edge.source === edge.target)
        context.addIssue({ code: 'custom', path, message: '连线端点无效' });
    });
  });
export type CanvasDocument = z.infer<typeof CanvasDocument>;

export const CanvasEdgeDisplay = z.enum(['all', 'related', 'hidden']);
export type CanvasEdgeDisplay = z.infer<typeof CanvasEdgeDisplay>;
export const CanvasView = z.strictObject({
  viewport: z.strictObject({ x: Finite, y: Finite, zoom: z.number().min(0.1).max(4) }),
  minimap: z.boolean(),
  edgeDisplay: CanvasEdgeDisplay,
});
export type CanvasView = z.infer<typeof CanvasView>;

export const CanvasRecord = z.strictObject({
  id: CanvasId,
  revision: z.number().int().positive(),
  document: CanvasDocument,
  view: CanvasView.nullable(),
  updatedAt: z.string().datetime(),
});
export type CanvasRecord = z.infer<typeof CanvasRecord>;
export const CanvasSaveRequest = z.strictObject({
  revision: z.number().int().nonnegative(),
  document: CanvasDocument,
});
export type CanvasSaveRequest = z.infer<typeof CanvasSaveRequest>;
export const CanvasSaveResult = z.strictObject({ revision: z.number().int().positive() });
export type CanvasSaveResult = z.infer<typeof CanvasSaveResult>;

export function emptyCanvasDocument(): CanvasDocument {
  return { schemaVersion: 1, nodes: [], edges: [] };
}

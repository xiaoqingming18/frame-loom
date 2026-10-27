import { z } from 'zod';

export const ImageProtocol = z.enum(['openai-images', 'gemini-image', 'ark-images']);
export type ImageProtocol = z.infer<typeof ImageProtocol>;
export const VideoProtocol = z.enum([
  'ark-video-tasks',
  'minimax-video-v2',
  'openai-videos',
  'fastaitoken-video',
]);
export type VideoProtocol = z.infer<typeof VideoProtocol>;
export const MediaProtocol = z.enum([
  ...ImageProtocol.options,
  ...VideoProtocol.options,
  'openai-speech',
  'minimax-t2a',
]);
export type MediaProtocol = z.infer<typeof MediaProtocol>;
export const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const Value = z.union([z.string().max(2000), z.number().finite(), z.boolean()]);
export const GenerationInput = z
  .strictObject({
    kind: z.enum(['image', 'video', 'audio']),
    role: z.enum(['reference', 'first_frame', 'last_frame']).default('reference'),
    sha256: Sha256.optional(),
    dataUrl: z
      .string()
      .max(28_000_000)
      .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
      .optional(),
  })
  .refine((input) => !!input.sha256 !== !!input.dataUrl, '素材必须且只能提供哈希或内联数据');
export type GenerationInput = z.infer<typeof GenerationInput>;
export const GenerationRequest = z.strictObject({
  projectId: z.string().uuid().optional(),
  pageId: z.string().uuid().optional(),
  modelId: z.string().uuid(),
  mode: z.string().min(1).max(100),
  prompt: z.string().trim().min(1).max(32_000),
  params: z.record(z.string().max(100), Value).default({}),
  inputs: z.array(GenerationInput).max(16).default([]),
  source: z.enum(['manual', 'agent', 'canvas']).default('manual'),
});
export type GenerationRequest = z.infer<typeof GenerationRequest>;
export const ModelProfile = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['image', 'video', 'tts']),
  protocol: MediaProtocol,
  matchIds: z.array(z.string()),
  generic: z.boolean(),
  modes: z.array(z.object({ id: z.string(), name: z.string() })).min(1),
  params: z.array(
    z.strictObject({
      key: z.string(),
      name: z.string(),
      type: z.enum(['enum', 'number', 'string', 'boolean']),
      values: z.array(Value).optional(),
      notes: z.record(z.string(), z.string()).optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      default: Value,
      mapped: z.boolean().default(true),
    }),
  ),
  constraints: z.array(
    z.strictObject({
      when: z.object({
        mode: z.string().optional(),
        param: z.string().optional(),
        equals: Value.optional(),
        inputRole: z.enum(['reference', 'first_frame', 'last_frame']).optional(),
      }),
      param: z.string().optional(),
      allowed: z.array(Value).optional(),
      forbidRoles: z.array(z.enum(['reference', 'first_frame', 'last_frame'])).optional(),
      message: z.string(),
    }),
  ),
  inputs: z.array(
    z.strictObject({
      kind: z.enum(['image', 'video', 'audio']),
      maxCount: z.number().int().nonnegative(),
      maxBytes: z.number().int().positive(),
      mimeTypes: z.array(z.string()),
      minWidth: z.number().positive().optional(),
      maxWidth: z.number().positive().optional(),
      minHeight: z.number().positive().optional(),
      maxHeight: z.number().positive().optional(),
      maxDurationMs: z.number().positive().optional(),
      minDurationMs: z.number().positive().optional(),
      maxTotalDurationMs: z.number().positive().optional(),
      minFps: z.number().positive().optional(),
      maxFps: z.number().positive().optional(),
      codecs: z.array(z.string()).optional(),
      audioCodecs: z.array(z.string()).optional(),
      minRatio: z.number().positive().optional(),
      maxRatio: z.number().positive().optional(),
      transport: z.enum(['inline', 'url']),
    }),
  ),
  runtime: z.strictObject({
    concurrency: z.number().int().min(1).max(16),
    pollInitialMs: z.number().int().positive(),
    pollMaxMs: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
    submitTimeoutMs: z.number().int().positive(),
    supportsCancel: z.boolean(),
  }),
});
export type ModelProfile = z.infer<typeof ModelProfile>;
export const ModelProfileList = z.array(ModelProfile);
export type GenerationIssue = { field: string; message: string };

export function checkGenerationRequest(
  profile: ModelProfile,
  request: GenerationRequest,
): GenerationIssue[] {
  const issues: GenerationIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });
  if (!profile.modes.some((mode) => mode.id === request.mode)) add('mode', '当前档案不支持此模式');
  for (const [key, value] of Object.entries(request.params)) {
    const param = profile.params.find((item) => item.key === key);
    if (!param) {
      add(key, '参数不在档案白名单内');
      continue;
    }
    if (param.type === 'enum' && !param.values?.includes(value)) add(key, `${param.name}取值无效`);
    if (
      param.type === 'number' &&
      (typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (param.min !== undefined && value < param.min) ||
        (param.max !== undefined && value > param.max))
    )
      add(key, `${param.name}超出范围`);
    if (param.type === 'boolean' && typeof value !== 'boolean')
      add(key, `${param.name}必须为布尔值`);
    if (param.type === 'string' && typeof value !== 'string') add(key, `${param.name}必须为文本`);
  }
  for (const kind of ['image', 'video', 'audio'] as const) {
    const limit = profile.inputs.find((item) => item.kind === kind);
    const inputs = request.inputs.filter((input) => input.kind === kind);
    if (inputs.length > (limit?.maxCount ?? 0))
      add('inputs', `${kind}参考数量超过上限 ${limit?.maxCount ?? 0}`);
    for (const input of inputs) {
      if (!input.dataUrl || !limit) continue;
      const [prefix = '', data = ''] = input.dataUrl.split(',');
      const mime = prefix.slice(5, -7);
      const bytes = (data.length * 3) / 4 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
      if (!limit.mimeTypes.includes(mime) || bytes > limit.maxBytes)
        add('inputs', '参考素材格式或大小不符合档案');
    }
  }
  if (request.mode === 'text' && request.inputs.length) add('inputs', '文生模式不接受参考素材');
  if (request.mode === 'reference' && !request.inputs.length)
    add('inputs', '参考模式至少需要一个参考素材');
  if (profile.kind === 'video') {
    const frames = request.inputs.filter((input) => input.role !== 'reference');
    if (request.inputs.some((input) => input.kind !== 'image' && input.role !== 'reference'))
      add('inputs', '首尾帧必须是图片');
    if (request.mode === 'frames' && !frames.length) add('inputs', '首尾帧模式至少需要首帧或尾帧');
    if (request.mode === 'frames' && request.inputs.some((input) => input.role === 'reference'))
      add('inputs', '首尾帧与全模态参考互斥');
    if (request.mode !== 'frames' && frames.length) add('inputs', '请切换到首尾帧模式');
    for (const role of ['first_frame', 'last_frame'])
      if (frames.filter((input) => input.role === role).length > 1)
        add('inputs', '首帧与尾帧各限一张');
  }
  for (const rule of profile.constraints) {
    const when = rule.when;
    if (when.mode && when.mode !== request.mode) continue;
    if (
      when.param &&
      (request.params[when.param] ?? profile.params.find((p) => p.key === when.param)?.default) !==
        when.equals
    )
      continue;
    if (when.inputRole && !request.inputs.some((input) => input.role === when.inputRole)) continue;
    if (
      rule.param &&
      rule.allowed &&
      !rule.allowed.includes(
        request.params[rule.param] ??
          profile.params.find((p) => p.key === rule.param)?.default ??
          '',
      )
    )
      add(rule.param, rule.message);
    if (rule.forbidRoles && request.inputs.some((input) => rule.forbidRoles?.includes(input.role)))
      add('inputs', rule.message);
  }
  return issues;
}

export const GenerationStatus = z.enum([
  'pending',
  'submitting',
  'running',
  'downloading',
  'succeeded',
  'submit_unknown',
  'failed',
  'cancelled',
]);
export type GenerationStatus = z.infer<typeof GenerationStatus>;
export const GenerationErrorCategory = z.enum([
  'auth',
  'quota',
  'rate_limit',
  'moderation',
  'invalid_params',
  'input_unreachable',
  'timeout',
  'upstream',
  'network',
  'unknown',
]);
export type GenerationErrorCategory = z.infer<typeof GenerationErrorCategory>;
export const MediaFile = z.object({
  sha256: Sha256,
  mime: z.string(),
  bytes: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  fps: z.number().positive().nullable().optional(),
  codec: z.string().nullable().optional(),
  audioCodec: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type MediaFile = z.infer<typeof MediaFile>;
export const GenerationJob = z.object({
  id: z.string().uuid(),
  kind: z.enum(['image', 'video', 'tts']),
  channelModelId: z.string().uuid(),
  profileId: z.string(),
  status: GenerationStatus,
  request: GenerationRequest,
  remoteTaskId: z.string().nullable(),
  remoteStatus: z.string().nullable(),
  attempts: z.number().int(),
  nextPollAt: z.string().datetime().nullable(),
  errorCategory: GenerationErrorCategory.nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  outputs: z.array(MediaFile),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
});
export type GenerationJob = z.infer<typeof GenerationJob>;
export const GenerationJobList = z.array(GenerationJob);

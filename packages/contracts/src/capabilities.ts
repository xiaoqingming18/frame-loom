import { z } from 'zod';
import { InputRole, MediaKind, PromptRefSyntax, VideoModeId } from './semantic-request.js';

const Limit = z.number().finite().nonnegative().optional();
const Count = z.number().int().nonnegative().optional();
export const SamplingParam = z.enum([
  'temperature',
  'topP',
  'topK',
  'presencePenalty',
  'frequencyPenalty',
]);
export type SamplingParam = z.infer<typeof SamplingParam>;
export const Range = z
  .strictObject({ min: z.number(), max: z.number(), default: z.number() })
  .refine((v) => v.min <= v.default && v.default <= v.max, '默认值必须在范围内');
export type Range = z.infer<typeof Range>;
export const ChatCap = z.strictObject({
  kind: z.literal('chat'),
  contextWindow: Count,
  maxOutput: Count,
  inputModalities: z.array(z.enum(['image', 'pdf', 'audio'])),
  tools: z.boolean(),
  streaming: z.boolean(),
  reasoningLevels: z.array(z.string()),
  samplingParams: z.array(SamplingParam),
});
export type ChatCap = z.infer<typeof ChatCap>;
export const ImageCap = z.strictObject({
  kind: z.literal('image'),
  references: z.strictObject({ max: Count, maxBytes: Count, formats: z.array(z.string()) }),
  mask: z.strictObject({ semantics: z.enum(['alpha', 'black']) }).optional(),
  count: z.strictObject({ max: Count }),
  size: z.strictObject({
    wire: z.enum(['pixels', 'tier', 'ratio', 'none']),
    tiers: z.array(
      z.strictObject({
        name: z.string().min(1),
        enabled: z.boolean(),
        ratios: z.array(
          z.strictObject({
            ratio: z.string().regex(/^(?:[1-9]\d*:[1-9]\d*|adaptive)$/),
            pixels: z
              .string()
              .regex(/^[1-9]\d*x[1-9]\d*$/)
              .optional(),
            manual: z.boolean().optional(),
          }),
        ),
      }),
    ),
    default: z.strictObject({
      tier: z.string().optional(),
      ratio: z.string().optional(),
      auto: z.boolean().optional(),
    }),
    custom: z
      .strictObject({
        minEdge: Limit,
        maxEdge: Limit,
        multipleOf: Limit,
        minPixels: Limit,
        maxPixels: Limit,
        maxAspect: Limit,
      })
      .optional(),
    withReference: z.strictObject({ maxPixels: Limit }).optional(),
  }),
  quality: z.strictObject({ values: z.array(z.string()), default: z.string() }).optional(),
  background: z
    .strictObject({ transparent: z.boolean(), default: z.enum(['auto', 'transparent', 'opaque']) })
    .optional(),
  responseFormat: z.enum(['b64_json', 'url']).optional(),
  outputFormats: z.array(z.string()),
  compression: z.strictObject({ min: z.number(), max: z.number() }).optional(),
  seed: z.boolean(),
  negativePrompt: z.boolean(),
  promptMaxChars: Count,
});
export type ImageCap = z.infer<typeof ImageCap>;
export const MediaLimit = z.strictObject({
  max: Count,
  maxBytes: Count,
  minDurationSec: Limit,
  maxDurationSec: Limit,
  maxTotalSec: Limit,
  formats: z.array(z.string()).optional(),
});
export type MediaLimit = z.infer<typeof MediaLimit>;
export const VideoCap = z.strictObject({
  kind: z.literal('video'),
  modes: z.array(
    z.strictObject({
      id: VideoModeId,
      withReference: z.boolean().optional(),
      keyframes: z.strictObject({ min: Count, max: Count }).optional(),
      reference: z.strictObject({ accept: z.array(MediaKind), withFrames: z.boolean() }).optional(),
    }),
  ),
  defaultMode: VideoModeId,
  references: z.strictObject({
    image: MediaLimit.optional(),
    video: MediaLimit.optional(),
    audio: MediaLimit.optional(),
    totalCount: Count,
  }),
  duration: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('range'),
      min: z.number().nonnegative(),
      max: z.number().nonnegative(),
      step: z.number().positive(),
      default: z.number().nonnegative(),
      allowAuto: z.boolean().optional(),
    }),
    z.strictObject({
      kind: z.literal('values'),
      values: z.array(z.number().nonnegative()),
      default: z.number().nonnegative(),
      allowAuto: z.boolean().optional(),
    }),
    z.strictObject({ kind: z.literal('auto') }),
  ]),
  aspectRatios: z.array(z.string()),
  defaultAspectRatio: z.string().optional(),
  resolutions: z.array(z.string()),
  defaultResolution: z.string().optional(),
  audio: z.strictObject({
    mode: z.enum(['on', 'off', 'optional', 'unknown']),
    default: z.boolean().optional(),
  }),
  watermark: z.strictObject({ default: z.boolean() }).optional(),
  seed: z.boolean(),
  promptMaxChars: Count,
  promptRef: z.strictObject({
    syntax: PromptRefSyntax,
    base: z.union([z.literal(0), z.literal(1)]),
  }),
});
export type VideoCap = z.infer<typeof VideoCap>;
export const TtsCap = z.strictObject({
  kind: z.literal('tts'),
  voices: z.strictObject({
    sources: z.array(z.enum(['preset', 'remote', 'manual'])),
    presets: z.array(z.strictObject({ id: z.string(), name: z.string() })),
    default: z.string().optional(),
  }),
  instructions: z.boolean(),
  speed: Range.optional(),
  pitch: Range.optional(),
  volume: Range.optional(),
  formats: z.array(z.string()),
  defaultFormat: z.string().optional(),
  sampleRates: z.array(z.number().int().nonnegative()),
  defaultSampleRate: z.number().int().nonnegative().optional(),
  maxChars: Count,
  multiSpeaker: z.strictObject({ max: z.number().int().nonnegative() }).optional(),
});
export type TtsCap = z.infer<typeof TtsCap>;
export const Capability = z.discriminatedUnion('kind', [ChatCap, ImageCap, VideoCap, TtsCap]);
export type Capability = z.infer<typeof Capability>;
export function emptyCapability(kind: Capability['kind']): Capability {
  switch (kind) {
    case 'chat':
      return {
        kind,
        inputModalities: [],
        tools: false,
        streaming: true,
        reasoningLevels: [],
        samplingParams: [],
      };
    case 'image':
      return {
        kind,
        references: { max: 0, formats: [] },
        count: { max: 1 },
        size: { wire: 'none', tiers: [], default: {} },
        outputFormats: [],
        seed: false,
        negativePrompt: false,
      };
    case 'video':
      return {
        kind,
        modes: [],
        defaultMode: 't2v',
        references: {},
        duration: { kind: 'auto' },
        aspectRatios: [],
        resolutions: [],
        audio: { mode: 'unknown' },
        seed: false,
        promptRef: { syntax: 'ordinal', base: 1 },
      };
    case 'tts':
      return {
        kind,
        voices: { sources: ['manual'], presets: [] },
        instructions: false,
        formats: [],
        sampleRates: [],
      };
  }
}
export const VIDEO_MODE_LABELS: Record<VideoModeId, string> = {
  t2v: '文生视频',
  first: '首帧生视频',
  last: '仅尾帧',
  first_last: '首尾帧',
  keyframes: '多关键帧',
  reference: '全模态参考',
  edit: '视频编辑',
  extend: '视频续写',
};
export const MEDIA_ROLE_LABELS: Record<InputRole, string> = {
  first_frame: '首帧',
  last_frame: '尾帧',
  keyframe: '关键帧',
  reference: '参考素材',
  base_video: '待编辑视频',
};
export const SAMPLING_PARAM_LABELS: Record<SamplingParam, string> = {
  temperature: '温度',
  topP: 'Top P',
  topK: 'Top K',
  presencePenalty: '存在惩罚',
  frequencyPenalty: '频率惩罚',
};
export const IMAGE_QUALITY_LABELS: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '极致',
};
const help = '留空表示不限，由服务商校验；0 表示不支持';
export const CAPABILITY_FIELDS = [
  ['contextWindow', '上下文长度', 'token'],
  ['maxOutput', '最大输出', 'token'],
  ['inputModalities', '输入模态'],
  ['tools', '工具调用'],
  ['streaming', '流式'],
  ['reasoningLevels', '推理档位'],
  ['samplingParams', '采样参数'],
  ['references', '参考素材'],
  ['references.max', '参考图数量', '张'],
  ['references.maxBytes', '单张大小', '字节'],
  ['references.formats', '图片格式'],
  ['mask', '蒙版语义'],
  ['count.max', '生成数量上限', '个'],
  ['size', '尺寸'],
  ['size.wire', '尺寸发送方式'],
  ['size.tiers', '尺寸档位'],
  ['size.default', '默认尺寸'],
  ['size.custom', '自定义宽高约束'],
  ['size.withReference.maxPixels', '带参考图像素上限', '像素'],
  ['quality', '质量'],
  ['background', '透明背景'],
  ['responseFormat', '返回格式'],
  ['outputFormats', '输出格式'],
  ['compression', '压缩'],
  ['seed', '随机种子'],
  ['negativePrompt', '负向提示词'],
  ['promptMaxChars', '提示词字数', '字符'],
  ['modes', '生成方式'],
  ['defaultMode', '默认方式'],
  ['references.image', '图片限制'],
  ['references.video', '视频限制'],
  ['references.audio', '音频限制'],
  ['references.totalCount', '素材总数', '个'],
  ['duration', '时长', '秒'],
  ['aspectRatios', '比例'],
  ['defaultAspectRatio', '默认比例'],
  ['resolutions', '分辨率'],
  ['defaultResolution', '默认分辨率'],
  ['audio', '声音'],
  ['watermark', '水印'],
  ['promptRef', '提示词引用'],
  ['voices', '音色'],
  ['instructions', '风格指令'],
  ['speed', '语速'],
  ['pitch', '音调'],
  ['volume', '音量'],
  ['formats', '输出格式'],
  ['defaultFormat', '默认格式'],
  ['sampleRates', '采样率', 'Hz'],
  ['defaultSampleRate', '默认采样率', 'Hz'],
  ['maxChars', '文本字数', '字符'],
  ['multiSpeaker', '多说话人'],
].map(([path, label, unit]) => ({ path, label, ...(unit ? { unit } : {}), help }));

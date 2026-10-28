import type { ChatCap, ImageCap, VideoCap, TtsCap, SamplingParam } from './capabilities.js';
import { defaultTierPixels } from './image-size.js';
import type { ExtraParam, ModelKind, Operation } from './model-service.js';
import type {
  InputRole,
  MediaKind,
  PromptRefSyntax,
  SemanticParamKey,
  Value,
  VideoModeId,
} from './semantic-request.js';

export type AuthDriver = 'bearer' | 'x-api-key' | 'x-goog-api-key' | 'xi-api-key' | 'token';
export type OperationSpec = {
  method: 'GET' | 'POST';
  path: string;
  encoding?: 'json' | 'multipart' | 'none';
  auth?: boolean;
};
export type ProtocolRule = {
  when: {
    modes?: VideoModeId[];
    param?: { key: SemanticParamKey; equals: Value };
    media?: { role: InputRole; kind: MediaKind };
  };
  then:
    | { param: SemanticParamKey; only: Value[] }
    | { param: SemanticParamKey; exclude: Value[] }
    | { forbidRole: InputRole };
  message: string;
};
export type ChatCeiling = {
  inputModalities: ('image' | 'pdf' | 'audio')[];
  samplingParams: SamplingParam[];
  tools: boolean;
  reasoning: boolean;
};
export type ImageCeiling = {
  edit: boolean;
  mask: ('alpha' | 'black')[];
  transparentBackground: boolean;
  responseFormats: ('b64_json' | 'url')[];
  outputFormats: string[];
  compression: boolean;
  sizeWire: ('pixels' | 'tier' | 'ratio' | 'none')[];
  quality: boolean;
  seed: boolean;
  negativePrompt: boolean;
};
export type VideoCeiling = {
  modes: VideoModeId[];
  referenceKinds: MediaKind[];
  mixFramesWithReference: boolean;
  audioControl: boolean;
  watermark: boolean;
  seed: boolean;
  durationAuto: boolean;
  promptRefs: PromptRefSyntax[];
};
export type TtsCeiling = {
  voiceSources: ('preset' | 'remote' | 'manual')[];
  instructions: boolean;
  speed: boolean;
  pitch: boolean;
  volume: boolean;
  formats: string[];
  sampleRates: number[];
  multiSpeaker: boolean;
};
export type ImageSizeRule =
  | { kind: 'provider' }
  | {
      kind: 'area';
      tiers: Record<string, number>;
      multipleOf: number;
      minPixels: number;
      maxPixels: number;
      maxEdge?: number;
      maxAspect?: number;
      table?: Record<string, Record<string, string>>;
    };
export type ProtocolDescriptor = {
  id: string;
  version: 'v1';
  label: string;
  vendor: string;
  kinds: ModelKind[];
  auth: AuthDriver;
  fixedHeaders?: Record<string, string>;
  standardPrefix: '' | '/v1' | '/v1beta' | '/api/v1' | '/api/v3';
  operations: Partial<Record<Operation, OperationSpec>>;
  lifecycle: Partial<Record<ModelKind, 'stream' | 'sync' | 'async'>>;
  poll?: { initialMs: number; maxMs: number; timeoutMs: number };
  transports: Partial<Record<MediaKind, { allowed: ('inline' | 'url')[]; auto: 'inline' | 'url' }>>;
  ceiling: { chat?: ChatCeiling; image?: ImageCeiling; video?: VideoCeiling; tts?: TtsCeiling };
  sizeRule?: ImageSizeRule;
  rules: ProtocolRule[];
  mediaRules?: { modes: VideoModeId[]; role: InputRole; minDurationSec: number; message: string }[];
  reservedFields: string[];
  extensibleContainers?: string[];
  templates: { chat?: ChatCap; image?: ImageCap; video?: VideoCap; tts?: TtsCap };
  defaultExtras?: ExtraParam[];
  videoSizes?: Record<string, Record<string, string>>;
  customVideoSize?: boolean;
  extraPathPrefix?: string;
  sources: { url: string; checkedAt: string }[];
  notes?: string[];
  chatRuntime?: {
    api: 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai';
    compat: Record<string, boolean | string>;
  };
};

// 能力上限、模板与规则按 sources 所记日期核对官方文档。
const chat: ChatCap = {
  kind: 'chat',
  inputModalities: [],
  tools: false,
  streaming: true,
  reasoningLevels: [],
  samplingParams: [],
};
const image: ImageCap = {
  kind: 'image',
  references: { max: 0, formats: [] },
  count: { max: 1 },
  size: { wire: 'none', tiers: [], default: {} },
  outputFormats: [],
  seed: false,
  negativePrompt: false,
};
const video: VideoCap = {
  kind: 'video',
  modes: [{ id: 't2v' }],
  defaultMode: 't2v',
  references: {},
  duration: { kind: 'auto' },
  aspectRatios: [],
  resolutions: [],
  audio: { mode: 'unknown' },
  seed: false,
  promptRef: { syntax: 'ordinal', base: 1 },
};
const tts: TtsCap = {
  kind: 'tts',
  voices: { sources: ['manual'], presets: [] },
  instructions: false,
  formats: [],
  sampleRates: [],
};
function descriptor(
  id: string,
  label: string,
  kinds: ModelKind[],
  standardPrefix: ProtocolDescriptor['standardPrefix'],
  submit: string,
  auth: AuthDriver = 'bearer',
  operations: ProtocolDescriptor['operations'] = {},
): ProtocolDescriptor {
  return {
    id,
    version: 'v1',
    label,
    vendor: label.split(' ')[0],
    kinds,
    auth,
    standardPrefix,
    operations: { submit: { method: 'POST', path: submit, encoding: 'json' }, ...operations },
    lifecycle: Object.fromEntries(
      kinds.map((kind) => [kind, kind === 'chat' ? 'stream' : kind === 'video' ? 'async' : 'sync']),
    ),
    ...(kinds.includes('video')
      ? { poll: { initialMs: 2000, maxMs: 10000, timeoutMs: 600000 } }
      : {}),
    transports: {},
    ceiling: {
      ...(kinds.includes('chat')
        ? { chat: { inputModalities: [], samplingParams: [], tools: false, reasoning: false } }
        : {}),
      ...(kinds.includes('image')
        ? {
            image: {
              edit: false,
              mask: [],
              transparentBackground: false,
              responseFormats: [],
              outputFormats: [],
              compression: false,
              sizeWire: ['none'],
              quality: false,
              seed: false,
              negativePrompt: false,
            },
          }
        : {}),
      ...(kinds.includes('video')
        ? {
            video: {
              modes: ['t2v'],
              referenceKinds: [],
              mixFramesWithReference: false,
              audioControl: false,
              watermark: false,
              seed: false,
              durationAuto: true,
              promptRefs: ['ordinal'],
            },
          }
        : {}),
      ...(kinds.includes('tts')
        ? {
            tts: {
              voiceSources: ['manual'],
              instructions: false,
              speed: false,
              pitch: false,
              volume: false,
              formats: [],
              sampleRates: [],
              multiSpeaker: false,
            },
          }
        : {}),
    },
    templates: Object.fromEntries(
      kinds.map((kind) => [kind, structuredClone({ chat, image, video, tts }[kind])]),
    ),
    ...(kinds.includes('image') ? { sizeRule: { kind: 'provider' } } : {}),
    rules: [],
    reservedFields: ['model', 'prompt', 'input', 'messages', 'contents'],
    sources: [],
  };
}
export const OPENAI_CHAT = descriptor(
  'openai-chat',
  'OpenAI Chat Completions',
  ['chat'],
  '/v1',
  '/chat/completions',
);
export const OPENAI_RESPONSES = descriptor(
  'openai-responses',
  'OpenAI Responses',
  ['chat'],
  '/v1',
  '/responses',
);
export const ANTHROPIC_MESSAGES = descriptor(
  'anthropic-messages',
  'Anthropic Messages',
  ['chat'],
  '/v1',
  '/messages',
  'x-api-key',
);
export const GEMINI_GENERATE = descriptor(
  'gemini-generate',
  'Gemini generateContent',
  ['chat', 'image', 'tts'],
  '/v1beta',
  '/models/{model}:generateContent',
  'x-goog-api-key',
);
OPENAI_CHAT.chatRuntime = {
  api: 'openai-completions',
  compat: {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: true,
    supportsUsageInStreaming: true,
    maxTokensField: 'max_tokens',
    requiresReasoningContentOnAssistantMessages: false,
    thinkingFormat: 'openai',
    sendSessionAffinityHeaders: false,
    sessionAffinityFormat: 'openai',
    supportsLongCacheRetention: false,
  },
};
OPENAI_RESPONSES.chatRuntime = {
  api: 'openai-responses',
  compat: {
    supportsDeveloperRole: false,
    supportsMaxOutputTokens: true,
    sessionAffinityFormat: 'openai',
    supportsLongCacheRetention: false,
  },
};
ANTHROPIC_MESSAGES.chatRuntime = { api: 'anthropic-messages', compat: {} };
GEMINI_GENERATE.chatRuntime = { api: 'google-generative-ai', compat: {} };
for (const item of [OPENAI_CHAT, OPENAI_RESPONSES, ANTHROPIC_MESSAGES, GEMINI_GENERATE]) {
  const sampling: SamplingParam[] =
    item === GEMINI_GENERATE
      ? ['temperature', 'topP', 'topK', 'presencePenalty', 'frequencyPenalty']
      : item === ANTHROPIC_MESSAGES
        ? ['temperature', 'topP', 'topK']
        : ['temperature', 'topP', 'presencePenalty', 'frequencyPenalty'];
  item.ceiling.chat = {
    inputModalities: ['image'],
    samplingParams: sampling,
    tools: true,
    reasoning: true,
  };
  item.templates.chat = {
    kind: 'chat',
    inputModalities: ['image'],
    tools: false,
    streaming: true,
    reasoningLevels: [],
    samplingParams: [],
  };
}
OPENAI_CHAT.sources = [
  {
    url: 'https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create',
    checkedAt: '2026-10-29',
  },
];
OPENAI_RESPONSES.sources = [
  {
    url: 'https://developers.openai.com/api/reference/resources/responses/methods/create',
    checkedAt: '2026-10-29',
  },
];
ANTHROPIC_MESSAGES.sources = [
  { url: 'https://platform.claude.com/docs/en/api/messages', checkedAt: '2026-10-29' },
];
GEMINI_GENERATE.sources = [
  { url: 'https://ai.google.dev/api/generate-content', checkedAt: '2026-10-29' },
];
ANTHROPIC_MESSAGES.fixedHeaders = { 'anthropic-version': '2023-06-01' };
OPENAI_CHAT.reservedFields = [
  'model',
  'messages',
  'stream',
  'stream_options',
  'store',
  'max_tokens',
  'max_completion_tokens',
  'temperature',
  'top_p',
  'presence_penalty',
  'frequency_penalty',
  'tools',
  'tool_choice',
  'reasoning_effort',
];
OPENAI_RESPONSES.reservedFields = [
  'model',
  'input',
  'stream',
  'store',
  'max_output_tokens',
  'temperature',
  'top_p',
  'presence_penalty',
  'frequency_penalty',
  'tools',
  'tool_choice',
  'reasoning',
  'instructions',
  'include',
];
ANTHROPIC_MESSAGES.reservedFields = [
  'model',
  'messages',
  'system',
  'max_tokens',
  'stream',
  'temperature',
  'top_p',
  'top_k',
  'tools',
  'tool_choice',
  'thinking',
];
export const OPENAI_IMAGES = descriptor(
  'openai-images',
  'OpenAI Images',
  ['image'],
  '/v1',
  '/images/generations',
  'bearer',
  { edit: { method: 'POST', path: '/images/edits', encoding: 'multipart' } },
);
export const ARK_SEEDREAM = descriptor(
  'ark-seedream',
  '方舟 Seedream',
  ['image'],
  '/api/v3',
  '/images/generations',
);
const imageRatios = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'];
function imageTiers(rule: ImageSizeRule): ImageCap['size']['tiers'] {
  if (rule.kind === 'provider') return [];
  return Object.keys(rule.tiers).map((name) => ({
    name,
    enabled: true,
    ratios: imageRatios.flatMap((ratio) => {
      const pixels = defaultTierPixels(rule, name, ratio);
      return pixels ? [{ ratio, pixels }] : [];
    }),
  }));
}
OPENAI_IMAGES.sizeRule = {
  kind: 'area',
  tiers: { '1K': 1048576, '2K': 3686400, '4K': 8294400 },
  multipleOf: 16,
  minPixels: 655360,
  maxPixels: 8294400,
  maxEdge: 3840,
  maxAspect: 3,
};
OPENAI_IMAGES.transports = { image: { allowed: ['inline'], auto: 'inline' } };
OPENAI_IMAGES.ceiling.image = {
  edit: true,
  mask: ['alpha'],
  transparentBackground: true,
  responseFormats: ['b64_json', 'url'],
  outputFormats: ['png', 'jpeg', 'webp'],
  compression: true,
  sizeWire: ['pixels', 'none'],
  quality: true,
  seed: false,
  negativePrompt: false,
};
OPENAI_IMAGES.templates.image = {
  kind: 'image',
  references: { formats: ['image/png', 'image/jpeg', 'image/webp'] },
  mask: { semantics: 'alpha' },
  count: { max: 1 },
  size: {
    wire: 'pixels',
    tiers: imageTiers(OPENAI_IMAGES.sizeRule),
    default: { tier: '1K', ratio: '1:1' },
    custom: { multipleOf: 16, minPixels: 655360, maxPixels: 8294400, maxEdge: 3840, maxAspect: 3 },
  },
  quality: { values: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'], default: 'auto' },
  background: { transparent: true, default: 'auto' },
  outputFormats: ['png', 'jpeg', 'webp'],
  compression: { min: 0, max: 100 },
  seed: false,
  negativePrompt: false,
};
OPENAI_IMAGES.reservedFields = [
  'model',
  'prompt',
  'n',
  'size',
  'quality',
  'background',
  'output_format',
  'output_compression',
  'image',
  'image[]',
  'mask',
  'response_format',
];
OPENAI_IMAGES.sources = [
  {
    url: 'https://developers.openai.com/api/docs/guides/image-generation.md',
    checkedAt: '2026-10-29',
  },
];
OPENAI_IMAGES.notes = [
  '模板依据 GPT Image 2.5 Sunburst／Flare；文档未明确的输入数量与字数不预设上限。',
];

ARK_SEEDREAM.sizeRule = {
  kind: 'area',
  tiers: { '2K': 4194304, '3K': 9437184, '4K': 16777216 },
  multipleOf: 16,
  minPixels: 3686400,
  maxPixels: 16777216,
  maxAspect: 16,
  table: {
    '2K': Object.fromEntries(
      imageRatios.map((ratio, i) => [
        ratio,
        [
          '2048x2048',
          '2304x1728',
          '1728x2304',
          '2848x1600',
          '1600x2848',
          '2496x1664',
          '1664x2496',
          '3136x1344',
        ][i],
      ]),
    ),
    '3K': Object.fromEntries(
      imageRatios.map((ratio, i) => [
        ratio,
        [
          '3072x3072',
          '3456x2592',
          '2592x3456',
          '4096x2304',
          '2304x4096',
          '3744x2496',
          '2496x3744',
          '4704x2016',
        ][i],
      ]),
    ),
    '4K': Object.fromEntries(
      imageRatios.map((ratio, i) => [
        ratio,
        [
          '4096x4096',
          '4704x3520',
          '3520x4704',
          '5504x3040',
          '3040x5504',
          '4992x3328',
          '3328x4992',
          '6240x2656',
        ][i],
      ]),
    ),
  },
};
ARK_SEEDREAM.transports = { image: { allowed: ['inline', 'url'], auto: 'inline' } };
ARK_SEEDREAM.ceiling.image = {
  edit: false,
  mask: [],
  transparentBackground: false,
  responseFormats: ['url', 'b64_json'],
  outputFormats: ['png', 'jpeg'],
  compression: false,
  sizeWire: ['pixels', 'tier', 'none'],
  quality: false,
  seed: false,
  negativePrompt: false,
};
ARK_SEEDREAM.templates.image = {
  kind: 'image',
  references: {
    max: 14,
    maxBytes: 30 * 1024 * 1024,
    formats: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/bmp',
      'image/tiff',
      'image/gif',
      'image/heic',
      'image/heif',
    ],
  },
  count: { max: 1 },
  size: {
    wire: 'pixels',
    tiers: imageTiers(ARK_SEEDREAM.sizeRule),
    default: { tier: '2K', ratio: '1:1' },
    custom: { minPixels: 3686400, maxPixels: 16777216, maxAspect: 16 },
  },
  responseFormat: 'url',
  outputFormats: ['png', 'jpeg'],
  seed: false,
  negativePrompt: false,
};
ARK_SEEDREAM.reservedFields = [
  'model',
  'prompt',
  'image',
  'size',
  'response_format',
  'output_format',
  'sequential_image_generation',
  'seed',
];
ARK_SEEDREAM.sources = [
  {
    url: 'https://ark.volcengine.com/region:cn-beijing/docs/image-generation-api',
    checkedAt: '2026-10-29',
  },
];
ARK_SEEDREAM.defaultExtras = [
  { key: 'watermark', label: '水印', type: 'boolean', path: 'watermark', default: false },
];
ARK_SEEDREAM.notes = [
  '模板依据 Seedream 5.0 lite；5.0 pro／flash 的输入数量与尺寸范围不同，须显式编辑能力卡。watermark 可用附加参数配置，默认关闭。',
];

GEMINI_GENERATE.transports = { image: { allowed: ['inline'], auto: 'inline' } };
GEMINI_GENERATE.ceiling.image = {
  edit: false,
  mask: [],
  transparentBackground: false,
  responseFormats: [],
  outputFormats: [],
  compression: false,
  sizeWire: ['tier', 'ratio', 'none'],
  quality: false,
  seed: false,
  negativePrompt: false,
};
GEMINI_GENERATE.templates.image = {
  kind: 'image',
  references: {
    max: 14,
    formats: ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'],
  },
  count: { max: 1 },
  size: {
    wire: 'tier',
    tiers: ['1K', '2K', '4K'].map((name) => ({
      name,
      enabled: true,
      ratios: imageRatios.map((ratio) => ({ ratio })),
    })),
    default: { tier: '1K', ratio: '1:1' },
  },
  outputFormats: [],
  seed: false,
  negativePrompt: false,
};
GEMINI_GENERATE.reservedFields = [
  'contents',
  'generationConfig',
  'model',
  'systemInstruction',
  'tools',
  'toolConfig',
];
GEMINI_GENERATE.sources = [
  { url: 'https://ai.google.dev/gemini-api/docs/image-generation', checkedAt: '2026-10-29' },
];
GEMINI_GENERATE.notes = [
  '图像模板依据 Gemini 3.1 Flash Image 的 generateContent 接口；Interactions 不在本期实现。',
];
export const ARK_SEEDANCE = descriptor(
  'ark-seedance',
  '方舟 Seedance',
  ['video'],
  '/api/v3',
  '/contents/generations/tasks',
  'bearer',
  { query: { method: 'GET', path: '/contents/generations/tasks/{id}' } },
);
export const DASHSCOPE_WAN = descriptor(
  'dashscope-wan',
  '百炼 Wan 视频',
  ['video'],
  '/api/v1',
  '/services/aigc/video-generation/video-synthesis',
  'bearer',
  { query: { method: 'GET', path: '/tasks/{id}' } },
);
export const MINIMAX_VIDEO_V2 = descriptor(
  'minimax-video-v2',
  'MiniMax 视频 V2',
  ['video'],
  '',
  '/v2/video_generation',
  'bearer',
  { query: { method: 'GET', path: '/v2/query/video_generation/{id}' } },
);
export const KLING_OMNI = descriptor(
  'kling-omni',
  '可灵 Omni（新版）',
  ['video'],
  '',
  '/omni-video/{model}',
  'bearer',
  { query: { method: 'GET', path: '/tasks?task_ids={id}' } },
);
const videoRatios = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'];
const referenceModes: VideoCap['modes'] = [
  { id: 't2v' },
  { id: 'first' },
  { id: 'first_last' },
  { id: 'reference', reference: { accept: ['image', 'video', 'audio'], withFrames: false } },
];
function videoDescriptor(
  protocol: ProtocolDescriptor,
  template: VideoCap,
  ceiling: Partial<VideoCeiling>,
  source: string,
) {
  protocol.templates.video = template;
  protocol.ceiling.video = {
    modes: template.modes.map((mode) => mode.id),
    referenceKinds: ['image', 'video', 'audio'],
    mixFramesWithReference: false,
    audioControl: false,
    watermark: false,
    seed: false,
    durationAuto: false,
    promptRefs: ['ordinal'],
    ...ceiling,
  };
  protocol.transports = {
    image: { allowed: ['inline', 'url'], auto: 'inline' },
    video: { allowed: ['url'], auto: 'url' },
    audio: { allowed: ['url'], auto: 'url' },
  };
  protocol.sources = [{ url: source, checkedAt: '2026-10-29' }];
}
videoDescriptor(
  ARK_SEEDANCE,
  {
    kind: 'video',
    modes: [...structuredClone(referenceModes), { id: 'edit' }, { id: 'extend' }],
    defaultMode: 't2v',
    references: {
      image: {
        max: 30,
        maxBytes: 30 * 1024 * 1024,
        formats: [
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/bmp',
          'image/tiff',
          'image/gif',
          'image/heic',
          'image/heif',
        ],
      },
      video: {
        max: 10,
        minDurationSec: 2,
        maxDurationSec: 30,
        maxTotalSec: 30,
        formats: ['video/mp4', 'video/quicktime'],
      },
      audio: {
        max: 10,
        minDurationSec: 2,
        maxDurationSec: 30,
        maxTotalSec: 30,
        formats: ['audio/wav', 'audio/mpeg'],
      },
    },
    duration: { kind: 'range', min: 4, max: 30, step: 1, default: 5, allowAuto: true },
    aspectRatios: videoRatios,
    defaultAspectRatio: '16:9',
    resolutions: ['480p', '720p', '1080p'],
    defaultResolution: '720p',
    audio: { mode: 'optional', default: true },
    watermark: { default: false },
    seed: true,
    promptRef: { syntax: 'ordinal', base: 1 },
  },
  { audioControl: true, watermark: true, seed: true, durationAuto: true },
  'https://ark.volcengine.com/region:cn-beijing/docs/create-video-generation-task-api',
);
ARK_SEEDANCE.rules = [
  {
    when: { modes: ['edit', 'extend'] },
    then: { param: 'aspectRatio', only: ['adaptive'] },
    message: 'Seedance 编辑与续写由输入视频决定比例，只能选择自适应',
  },
  {
    when: { modes: ['edit'] },
    then: { param: 'duration', only: [-1] },
    message: 'Seedance 编辑保持输入视频时长，只能选择自动时长',
  },
  {
    when: { modes: ['first', 'first_last'] },
    then: { param: 'aspectRatio', only: ['adaptive'] },
    message: 'Seedance 首帧与首尾帧方式由输入图决定比例，只能选择自适应',
  },
];
ARK_SEEDANCE.mediaRules = [
  {
    modes: ['edit'],
    role: 'base_video',
    minDurationSec: 4,
    message: 'Seedance 待编辑视频至少需要 4 秒',
  },
];
ARK_SEEDANCE.reservedFields = [
  'model',
  'content',
  'ratio',
  'resolution',
  'duration',
  'generate_audio',
  'watermark',
  'seed',
  'omni_reference_task_type',
];
ARK_SEEDANCE.notes = [
  '模板依据 Seedance 2.5；编辑固定自适应比例与自动时长，续写仅固定自适应比例。',
];

videoDescriptor(
  DASHSCOPE_WAN,
  {
    kind: 'video',
    modes: structuredClone(referenceModes),
    defaultMode: 't2v',
    references: {
      image: {
        max: 10,
        maxBytes: 20 * 1024 * 1024,
        formats: ['image/jpeg', 'image/png', 'image/bmp', 'image/webp'],
      },
      video: {
        max: 5,
        maxBytes: 100 * 1024 * 1024,
        minDurationSec: 1,
        maxDurationSec: 15,
        maxTotalSec: 15,
        formats: ['video/mp4', 'video/quicktime'],
      },
      audio: {
        max: 5,
        maxBytes: 15 * 1024 * 1024,
        minDurationSec: 1,
        maxDurationSec: 15,
        maxTotalSec: 15,
        formats: ['audio/wav', 'audio/mpeg'],
      },
    },
    duration: { kind: 'range', min: 2, max: 30, step: 1, default: 5, allowAuto: true },
    aspectRatios: videoRatios,
    defaultAspectRatio: 'adaptive',
    resolutions: ['480P', '720P', '1080P'],
    defaultResolution: '1080P',
    audio: { mode: 'optional', default: true },
    seed: true,
    promptRef: { syntax: 'ordinal', base: 1 },
  },
  { audioControl: true, seed: true, durationAuto: true },
  'https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-api-reference',
);
DASHSCOPE_WAN.fixedHeaders = { 'X-DashScope-Async': 'enable' };
DASHSCOPE_WAN.poll = { initialMs: 15000, maxMs: 15000, timeoutMs: 600000 };
DASHSCOPE_WAN.reservedFields = [
  'model',
  'input',
  'parameters',
  'parameters.resolution',
  'parameters.duration',
  'parameters.ratio',
  'parameters.audio',
  'parameters.seed',
];
DASHSCOPE_WAN.extensibleContainers = ['parameters'];
DASHSCOPE_WAN.defaultExtras = [
  {
    key: 'promptExtend',
    label: '智能改写提示词',
    type: 'boolean',
    path: 'parameters.prompt_extend',
    default: true,
  },
];
DASHSCOPE_WAN.notes = ['模板依据 Wan 3.0；帧类素材与参考素材互斥。'];

videoDescriptor(
  MINIMAX_VIDEO_V2,
  {
    kind: 'video',
    modes: [{ id: 'last' }, ...structuredClone(referenceModes)],
    defaultMode: 't2v',
    references: {
      image: {
        max: 9,
        maxBytes: 30 * 1024 * 1024,
        formats: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
      },
      video: {
        max: 3,
        maxBytes: 50 * 1024 * 1024,
        minDurationSec: 2,
        maxDurationSec: 15,
        maxTotalSec: 15,
        formats: ['video/mp4', 'video/quicktime'],
      },
      audio: {
        max: 3,
        maxBytes: 15 * 1024 * 1024,
        minDurationSec: 2,
        maxDurationSec: 15,
        maxTotalSec: 15,
        formats: ['audio/wav', 'audio/mpeg'],
      },
    },
    duration: { kind: 'range', min: 4, max: 15, step: 1, default: 5 },
    aspectRatios: videoRatios,
    defaultAspectRatio: '16:9',
    resolutions: ['768P', '2K'],
    defaultResolution: '768P',
    audio: { mode: 'unknown' },
    seed: false,
    promptRef: { syntax: 'ordinal', base: 1 },
  },
  {},
  'https://platform.minimax.io/docs/api-reference/video-generation-v2-create',
);
MINIMAX_VIDEO_V2.rules = [
  {
    when: { modes: ['t2v'] },
    then: { param: 'aspectRatio', exclude: ['adaptive'] },
    message: 'MiniMax 文生视频必须选择具体比例',
  },
  {
    when: { modes: ['first', 'last', 'first_last'] },
    then: { param: 'aspectRatio', only: ['adaptive'] },
    message: 'MiniMax 帧生视频的比例由输入图片决定',
  },
];
MINIMAX_VIDEO_V2.reservedFields = ['model', 'content', 'duration', 'resolution', 'ratio'];
MINIMAX_VIDEO_V2.notes = [
  '模板依据 MiniMax-H3；未发现显式声音开关，保持未确认。官方字段为 content 内文本与 ratio，不发送顶层 prompt／aspect_ratio。',
];

videoDescriptor(
  KLING_OMNI,
  {
    kind: 'video',
    modes: [
      { id: 't2v' },
      { id: 'first', withReference: true },
      { id: 'last', withReference: true },
      { id: 'first_last', withReference: true },
      { id: 'keyframes', withReference: true, keyframes: { min: 1, max: 10 } },
      { id: 'reference', reference: { accept: ['image', 'video'], withFrames: true } },
      { id: 'edit', withReference: true },
    ],
    defaultMode: 't2v',
    references: {
      image: { max: 10, maxBytes: 30 * 1024 * 1024, formats: ['image/jpeg', 'image/png'] },
      video: {
        max: 5,
        maxBytes: 300 * 1024 * 1024,
        minDurationSec: 3,
        maxDurationSec: 30,
        maxTotalSec: 30,
        formats: ['video/mp4', 'video/quicktime'],
      },
      totalCount: 15,
    },
    duration: { kind: 'range', min: 3, max: 30, step: 1, default: 10, allowAuto: true },
    aspectRatios: ['21:9', '16:9', '9:16', '1:1', 'adaptive'],
    defaultAspectRatio: 'adaptive',
    resolutions: ['720p', '1080p'],
    defaultResolution: '1080p',
    audio: { mode: 'unknown' },
    watermark: { default: false },
    seed: false,
    promptRef: { syntax: '@image_n', base: 1 },
  },
  {
    referenceKinds: ['image', 'video'],
    mixFramesWithReference: true,
    watermark: true,
    durationAuto: true,
    promptRefs: ['@image_n'],
  },
  'https://kling.ai/document-api/api/video/4-0/video-omni.md',
);
KLING_OMNI.reservedFields = ['contents', 'settings', 'options', 'options.watermark_info'];
KLING_OMNI.extensibleContainers = ['options'];
KLING_OMNI.notes = [
  '模板依据 Kling 4.0；voice 需要服务商音色 ID，不能把本地音频 URL 当 voice_id，首批不声明音频输入。官方未声明 audio 布尔字段，不虚构开关或参考视频静音规则。',
];
export const OPENAI_VIDEOS = descriptor(
  'openai-videos',
  'OpenAI Videos 兼容',
  ['video'],
  '/v1',
  '/videos',
  'bearer',
  {
    query: { method: 'GET', path: '/videos/{id}' },
    content: { method: 'GET', path: '/videos/{id}/content', auth: true },
  },
);
export const NEWAPI_VIDEO = descriptor(
  'newapi-video',
  'new-api 统一视频',
  ['video'],
  '/v1',
  '/video/generations',
  'bearer',
  { query: { method: 'GET', path: '/video/generations/{id}' } },
);
OPENAI_VIDEOS.operations.submit!.encoding = 'multipart';
OPENAI_VIDEOS.videoSizes = {
  '720p': { '16:9': '1280x720', '9:16': '720x1280' },
  '1080p': { '16:9': '1920x1080', '9:16': '1080x1920' },
};
videoDescriptor(
  OPENAI_VIDEOS,
  {
    kind: 'video',
    modes: [{ id: 't2v' }, { id: 'first' }],
    defaultMode: 't2v',
    references: { image: { max: 1, formats: ['image/jpeg', 'image/png', 'image/webp'] } },
    duration: { kind: 'values', values: [4, 8, 12, 16, 20], default: 8 },
    aspectRatios: ['16:9', '9:16'],
    defaultAspectRatio: '16:9',
    resolutions: ['720p', '1080p'],
    defaultResolution: '720p',
    audio: { mode: 'on' },
    seed: false,
    promptRef: { syntax: 'ordinal', base: 1 },
  },
  { referenceKinds: ['image'] },
  'https://developers.openai.com/api/docs/guides/video-generation.md',
);
OPENAI_VIDEOS.transports = { image: { allowed: ['inline'], auto: 'inline' } };
OPENAI_VIDEOS.reservedFields = ['model', 'prompt', 'seconds', 'size', 'input_reference'];
OPENAI_VIDEOS.notes = [
  '官方已于 2026-09-24 下线，仅用于中转兼容格式。模板依据保留的 Sora 2／Pro 文档；OpenRouter 当前使用另一套 JSON 接口，不将其字段混入历史 multipart 格式。',
];

videoDescriptor(
  NEWAPI_VIDEO,
  {
    kind: 'video',
    modes: [
      { id: 't2v' },
      { id: 'first' },
      { id: 'reference', reference: { accept: ['image'], withFrames: false } },
    ],
    defaultMode: 't2v',
    references: { image: { max: 1, formats: ['image/jpeg', 'image/png', 'image/webp'] } },
    duration: { kind: 'auto' },
    aspectRatios: [],
    resolutions: [],
    audio: { mode: 'unknown' },
    seed: true,
    promptRef: { syntax: 'ordinal', base: 1 },
  },
  { referenceKinds: ['image'], seed: true, durationAuto: true },
  'https://doc.newapi.pro/api/generate-video/',
);
NEWAPI_VIDEO.transports = { image: { allowed: ['inline', 'url'], auto: 'inline' } };
NEWAPI_VIDEO.customVideoSize = true;
NEWAPI_VIDEO.extraPathPrefix = 'metadata.';
NEWAPI_VIDEO.reservedFields = [
  'model',
  'prompt',
  'duration',
  'width',
  'height',
  'size',
  'image',
  'seed',
  'metadata',
];
NEWAPI_VIDEO.extensibleContainers = ['metadata'];
NEWAPI_VIDEO.notes = [
  '统一协议没有型号无关的分辨率与时长上限；模板不虚构范围，接入后编辑能力卡。厂商附加参数写入 metadata。',
];
export const OPENAI_SPEECH = descriptor(
  'openai-speech',
  'OpenAI Speech',
  ['tts'],
  '/v1',
  '/audio/speech',
);
export const MINIMAX_T2A = descriptor(
  'minimax-t2a',
  'MiniMax T2A v2',
  ['tts'],
  '/v1',
  '/t2a_v2',
  'bearer',
  { voices: { method: 'POST', path: '/get_voice', encoding: 'json' } },
);
export const ELEVENLABS = descriptor(
  'elevenlabs',
  'ElevenLabs',
  ['tts'],
  '/v1',
  '/text-to-speech/{voice_id}',
  'xi-api-key',
  { voices: { method: 'GET', path: '/voices' } },
);
OPENAI_SPEECH.ceiling.tts = {
  voiceSources: ['preset', 'manual'],
  instructions: true,
  speed: true,
  pitch: false,
  volume: false,
  formats: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'],
  sampleRates: [],
  multiSpeaker: false,
};
OPENAI_SPEECH.templates.tts = {
  kind: 'tts',
  voices: {
    sources: ['preset', 'manual'],
    presets: [
      'alloy',
      'ash',
      'ballad',
      'coral',
      'echo',
      'fable',
      'nova',
      'onyx',
      'sage',
      'shimmer',
      'verse',
      'marin',
      'cedar',
    ].map((id) => ({ id, name: id })),
    default: 'coral',
  },
  instructions: true,
  speed: { min: 0.25, max: 4, default: 1 },
  formats: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'],
  defaultFormat: 'mp3',
  sampleRates: [],
  maxChars: 4096,
};
OPENAI_SPEECH.reservedFields = [
  'model',
  'input',
  'voice',
  'instructions',
  'response_format',
  'speed',
];
OPENAI_SPEECH.sources = [
  {
    url: 'https://developers.openai.com/api/docs/guides/text-to-speech.md',
    checkedAt: '2026-10-29',
  },
  {
    url: 'https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create',
    checkedAt: '2026-10-29',
  },
];
OPENAI_SPEECH.notes = [
  'OpenAI 官方 TTS 将于 2027-01-06 停服，主要用于中转站。模板依据 gpt-4o-mini-tts。',
];

MINIMAX_T2A.ceiling.tts = {
  voiceSources: ['remote', 'manual'],
  instructions: false,
  speed: true,
  pitch: true,
  volume: true,
  formats: ['mp3', 'wav', 'pcm', 'flac', 'opus'],
  sampleRates: [8000, 16000, 22050, 24000, 32000, 44100],
  multiSpeaker: false,
};
MINIMAX_T2A.templates.tts = {
  kind: 'tts',
  voices: { sources: ['remote', 'manual'], presets: [] },
  instructions: false,
  speed: { min: 0.5, max: 2, default: 1 },
  pitch: { min: -12, max: 12, default: 0 },
  volume: { min: 0.01, max: 10, default: 1 },
  formats: ['mp3', 'wav', 'pcm', 'flac', 'opus'],
  defaultFormat: 'mp3',
  sampleRates: [8000, 16000, 22050, 24000, 32000, 44100],
  defaultSampleRate: 32000,
  maxChars: 9999,
};
MINIMAX_T2A.reservedFields = [
  'model',
  'text',
  'stream',
  'voice_setting',
  'voice_setting.voice_id',
  'voice_setting.speed',
  'voice_setting.vol',
  'voice_setting.pitch',
  'audio_setting',
  'audio_setting.sample_rate',
  'audio_setting.format',
  'audio_setting.channel',
  'output_format',
];
MINIMAX_T2A.extensibleContainers = ['voice_setting', 'audio_setting'];
MINIMAX_T2A.sources = [
  {
    url: 'https://platform.minimax.io/docs/api-reference/speech-t2a-http.md',
    checkedAt: '2026-10-29',
  },
  {
    url: 'https://platform.minimax.io/docs/api-reference/voice-management-get',
    checkedAt: '2026-10-29',
  },
];
MINIMAX_T2A.notes = [
  '模板依据 speech-2.8-hd；volume 为开区间 (0,10]，表单最小使用 0.01。G.711 输出不在首批支持范围。',
];

ELEVENLABS.operations.voices!.path = '/v2/voices';
ELEVENLABS.standardPrefix = '';
ELEVENLABS.operations.submit!.path = '/v1/text-to-speech/{voice_id}';
ELEVENLABS.ceiling.tts = {
  voiceSources: ['remote', 'manual'],
  instructions: false,
  speed: true,
  pitch: false,
  volume: false,
  formats: ['mp3_44100_128', 'mp3_22050_32', 'pcm_24000', 'pcm_44100'],
  sampleRates: [],
  multiSpeaker: false,
};
ELEVENLABS.templates.tts = {
  kind: 'tts',
  voices: { sources: ['remote', 'manual'], presets: [] },
  instructions: false,
  formats: ['mp3_44100_128', 'mp3_22050_32', 'pcm_24000', 'pcm_44100'],
  defaultFormat: 'mp3_44100_128',
  sampleRates: [],
};
ELEVENLABS.reservedFields = ['text', 'model_id', 'voice_settings', 'voice_settings.speed'];
ELEVENLABS.extensibleContainers = ['voice_settings'];
ELEVENLABS.sources = [
  {
    url: 'https://elevenlabs.io/docs/api-reference/text-to-speech/convert.mdx',
    checkedAt: '2026-10-29',
  },
  { url: 'https://elevenlabs.io/docs/api-reference/voices/search', checkedAt: '2026-10-29' },
];
ELEVENLABS.notes = [
  '模板依据 Eleven Multilingual v2；输出格式使用官方编码名称，采样率包含于格式，不另发字段。',
];

GEMINI_GENERATE.ceiling.tts = {
  voiceSources: ['preset', 'manual'],
  instructions: true,
  speed: false,
  pitch: false,
  volume: false,
  formats: ['wav'],
  sampleRates: [24000],
  multiSpeaker: true,
};
GEMINI_GENERATE.templates.tts = {
  kind: 'tts',
  voices: {
    sources: ['preset', 'manual'],
    presets: [
      'Zephyr',
      'Puck',
      'Charon',
      'Kore',
      'Fenrir',
      'Leda',
      'Orus',
      'Aoede',
      'Callirrhoe',
      'Autonoe',
      'Enceladus',
      'Iapetus',
      'Umbriel',
      'Algieba',
      'Despina',
      'Erinome',
      'Algenib',
      'Rasalgethi',
      'Laomedeia',
      'Achernar',
      'Alnilam',
      'Schedar',
      'Gacrux',
      'Pulcherrima',
      'Achird',
      'Zubenelgenubi',
      'Vindemiatrix',
      'Sadachbia',
      'Sadaltager',
      'Sulafat',
    ].map((id) => ({ id, name: id })),
    default: 'Kore',
  },
  instructions: true,
  formats: ['wav'],
  defaultFormat: 'wav',
  sampleRates: [24000],
  defaultSampleRate: 24000,
  multiSpeaker: { max: 2 },
};
GEMINI_GENERATE.sources.push(
  { url: 'https://ai.google.dev/gemini-api/docs/speech-generation', checkedAt: '2026-10-29' },
  { url: 'https://ai.google.dev/api/generate-content', checkedAt: '2026-10-29' },
);
GEMINI_GENERATE.extensibleContainers = ['generationConfig', 'generationConfig.speechConfig'];
GEMINI_GENERATE.reservedFields.push(
  'generationConfig.responseModalities',
  'generationConfig.imageConfig',
  'generationConfig.speechConfig',
  'generationConfig.speechConfig.voiceConfig',
);
GEMINI_GENERATE.notes.push(
  'TTS 使用 generateContent 的 prebuiltVoiceConfig；多说话人配置通过固定字段 generationConfig.speechConfig.multiSpeakerVoiceConfig 提供。按返回 MIME 接受 WAV 或封装 24kHz 单声道 L16，不按模型名分支。',
);
export const PROTOCOLS: readonly ProtocolDescriptor[] = [
  OPENAI_CHAT,
  OPENAI_RESPONSES,
  ANTHROPIC_MESSAGES,
  GEMINI_GENERATE,
  OPENAI_IMAGES,
  ARK_SEEDREAM,
  ARK_SEEDANCE,
  DASHSCOPE_WAN,
  MINIMAX_VIDEO_V2,
  KLING_OMNI,
  OPENAI_VIDEOS,
  NEWAPI_VIDEO,
  OPENAI_SPEECH,
  MINIMAX_T2A,
  ELEVENLABS,
];
export function getProtocol(id: string) {
  return PROTOCOLS.find((protocol) => protocol.id === id);
}
export function protocolsForKind(kind: ModelKind) {
  return PROTOCOLS.filter((protocol) => protocol.kinds.includes(kind));
}

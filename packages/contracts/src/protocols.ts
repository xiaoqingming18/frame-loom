import type { ChatCap, ImageCap, VideoCap, TtsCap, SamplingParam } from './capabilities.js';
import type { ModelKind, Operation } from './model-service.js';
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
  reservedFields: string[];
  templates: { chat?: ChatCap; image?: ImageCap; video?: VideoCap; tts?: TtsCap };
  sources: { url: string; checkedAt: string }[];
  notes?: string[];
};

// 03 核对官方文档后补全能力上限、模板、规则与来源。
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

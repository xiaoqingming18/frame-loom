import { ModelProfile } from '@frame-loom/contracts';

const runtime = {
  concurrency: 1,
  pollInitialMs: 5000,
  pollMaxMs: 30_000,
  timeoutMs: 3_600_000,
  submitTimeoutMs: 120_000,
  supportsCancel: false,
};
const modes = [
  { id: 'text', name: '文生视频' },
  { id: 'frames', name: '首尾帧' },
  { id: 'reference', name: '全模态参考' },
];
const image = {
  kind: 'image',
  maxCount: 9,
  maxBytes: 20 * 1024 * 1024,
  mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
  minWidth: 256,
  maxWidth: 5760,
  minHeight: 256,
  maxHeight: 5760,
  minRatio: 0.4,
  maxRatio: 2.5,
  transport: 'inline',
};
const video = {
  kind: 'video',
  maxCount: 3,
  maxBytes: 50 * 1024 * 1024,
  mimeTypes: ['video/mp4'],
  minWidth: 256,
  maxWidth: 5760,
  minHeight: 256,
  maxHeight: 5760,
  minRatio: 0.4,
  maxRatio: 2.5,
  minDurationMs: 2000,
  maxDurationMs: 15_000,
  maxTotalDurationMs: 15_000,
  minFps: 23.976,
  maxFps: 60,
  codecs: ['h264', 'hevc'],
  audioCodecs: ['aac', 'mp3'],
  transport: 'url',
};
const audio = {
  kind: 'audio',
  maxCount: 3,
  maxBytes: 15 * 1024 * 1024,
  mimeTypes: ['audio/mpeg', 'audio/wav'],
  minDurationMs: 2000,
  maxDurationMs: 15_000,
  maxTotalDurationMs: 15_000,
  transport: 'url',
};
const ratio = {
  key: 'ratio',
  name: '画面比例',
  type: 'enum',
  values: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
  default: '16:9',
};
const minimax = [
  { model: 'MiniMax-H3', resolutions: ['768P', '2K'], min: 4 },
  { model: 'MiniMax-H3-Highspeed', resolutions: ['768P'], min: 4 },
  { model: 'MiniMax-H3-Lite', resolutions: ['480P', '768P'], min: 4 },
  { model: 'MiniMax-H3-Max', resolutions: ['480P', '768P'], min: 5 },
].map(({ model, resolutions, min }) =>
  ModelProfile.parse({
    id: model.toLowerCase(),
    name: model,
    kind: 'video',
    protocol: 'minimax-video-v2',
    matchIds: [model],
    generic: false,
    modes,
    params: [
      { key: 'resolution', name: '分辨率', type: 'enum', values: resolutions, default: '768P' },
      {
        key: 'duration',
        name: '时长（秒）',
        type: 'enum',
        values: Array.from({ length: 16 - min }, (_, i) => i + min),
        default: 5,
      },
      {
        ...ratio,
        ...(model.endsWith('Lite')
          ? { values: ratio.values.filter((value) => value !== 'adaptive') }
          : {}),
      },
    ],
    constraints: [
      {
        when: { mode: 'text' },
        param: 'ratio',
        allowed: ratio.values.filter((value) => value !== 'adaptive'),
        message: '文生视频必须指定画面比例',
      },
    ],
    inputs: [image, video, audio],
    runtime,
  }),
);
const seedance = ['doubao-seedance-2-0', 'doubao-seedance-2-0-fast'].map((model) =>
  ModelProfile.parse({
    id: model,
    name: model.endsWith('fast') ? 'Seedance 2.0 Fast' : 'Seedance 2.0',
    kind: 'video',
    protocol: 'ark-video-tasks',
    matchIds: [model, `${model}-260128`],
    generic: false,
    modes,
    params: [
      {
        key: 'resolution',
        name: '分辨率',
        type: 'enum',
        values: ['480p', '720p'],
        default: '720p',
      },
      {
        key: 'duration',
        name: '时长（秒）',
        type: 'enum',
        values: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        default: 5,
      },
      ratio,
      { key: 'generate_audio', name: '生成音频', type: 'boolean', default: true },
      { key: 'watermark', name: '水印', type: 'boolean', default: true },
    ],
    constraints: [],
    inputs: [image, { ...video, minFps: 24 }, audio],
    runtime,
  }),
);
const sora = ModelProfile.parse({
  id: 'openai-videos-default',
  name: 'Sora 兼容渠道',
  kind: 'video',
  protocol: 'openai-videos',
  matchIds: ['sora-2', 'sora-2-pro'],
  generic: false,
  modes: modes.slice(0, 2).map((mode) => (mode.id === 'frames' ? { ...mode, name: '首帧' } : mode)),
  params: [
    { key: 'seconds', name: '时长（秒）', type: 'enum', values: ['4', '8', '12'], default: '4' },
    {
      key: 'size',
      name: '尺寸',
      type: 'enum',
      values: ['720x1280', '1280x720'],
      default: '1280x720',
    },
  ],
  constraints: [
    {
      when: {},
      forbidRoles: ['last_frame'],
      message: '此协议仅支持一张首帧，不支持尾帧或全模态参考',
    },
  ],
  inputs: [{ ...image, maxCount: 1 }],
  runtime,
});
export const videoProfiles: ModelProfile[] = [
  ...seedance,
  ...minimax,
  sora,
  ModelProfile.parse({
    id: 'fastaitoken-video-generic',
    name: 'FastAIToken 视频',
    kind: 'video',
    protocol: 'fastaitoken-video',
    matchIds: [
      'seedance-2.5-token',
      'seedance-2.5-pro-token',
      'seedance-2.0-token',
      'minimax-h3-time',
      'wan-3.0-time',
    ],
    generic: true,
    modes: modes.map((mode) => (mode.id === 'frames' ? { ...mode, name: '首尾帧' } : mode)),
    params: [],
    constraints: [],
    inputs: [image, video, audio],
    runtime,
  }),
  ...(['ark-video-tasks', 'minimax-video-v2', 'openai-videos'] as const).map((protocol) =>
    ModelProfile.parse({
      id: `${protocol}-generic`,
      name: `通用 ${protocol}（保守参数）`,
      kind: 'video',
      protocol,
      matchIds: [],
      generic: true,
      modes: [{ id: 'text', name: '文生视频' }],
      params: protocol === 'minimax-video-v2' ? minimax[0].params : [],
      constraints: [],
      inputs: [],
      runtime,
    }),
  ),
];

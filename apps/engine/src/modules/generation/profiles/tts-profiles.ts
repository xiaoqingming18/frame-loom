import { ModelProfile } from '@frame-loom/contracts';

const runtime = {
  concurrency: 1,
  pollInitialMs: 5000,
  pollMaxMs: 30_000,
  timeoutMs: 900_000,
  submitTimeoutMs: 180_000,
  supportsCancel: false,
};
const definitions = [
  {
    protocol: 'openai-speech',
    name: 'OpenAI 语音',
    ids: ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'],
    params: [
      {
        key: 'voice',
        name: '音色',
        type: 'enum',
        values: [
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
        ],
        default: 'alloy',
      },
      {
        key: 'response_format',
        name: '格式',
        type: 'enum',
        values: ['mp3', 'wav'],
        default: 'mp3',
      },
      { key: 'speed', name: '语速', type: 'number', min: 0.25, max: 4, default: 1 },
    ],
  },
  {
    protocol: 'minimax-t2a',
    name: 'MiniMax T2A',
    ids: ['speech-2.6-hd', 'speech-2.6-turbo', 'speech-02-hd', 'speech-02-turbo'],
    params: [
      { key: 'voice_id', name: '音色 ID', type: 'string', default: '' },
      { key: 'format', name: '格式', type: 'enum', values: ['mp3', 'wav'], default: 'mp3' },
      { key: 'speed', name: '语速', type: 'number', min: 0.5, max: 2, default: 1 },
      {
        key: 'sample_rate',
        name: '采样率',
        type: 'enum',
        values: [16000, 24000, 32000, 44100],
        default: 32000,
      },
    ],
  },
];
export const ttsProfiles = definitions.flatMap((item) => [
  ModelProfile.parse({
    id: `${item.protocol}-default`,
    name: item.name,
    kind: 'tts',
    protocol: item.protocol,
    matchIds: item.ids,
    generic: false,
    modes: [{ id: 'text', name: '文本转语音' }],
    params: item.params,
    constraints: [],
    inputs: [],
    runtime,
  }),
  ModelProfile.parse({
    id: `${item.protocol}-generic`,
    name: `通用 ${item.name}`,
    kind: 'tts',
    protocol: item.protocol,
    matchIds: [],
    generic: true,
    modes: [{ id: 'text', name: '文本转语音' }],
    params: [],
    constraints: [],
    inputs: [],
    runtime,
  }),
]);

// 旧版 tts-1 不支持新增音色；能力按精确型号分开，避免默认选择不可用音色。
const openai = ttsProfiles.find((profile) => profile.id === 'openai-speech-default')!;
openai.matchIds = ['gpt-4o-mini-tts'];
ttsProfiles.push({
  ...structuredClone(openai),
  id: 'openai-speech-tts-1',
  name: 'OpenAI TTS 1',
  matchIds: ['tts-1', 'tts-1-hd'],
  params: openai.params.map((param) =>
    param.key === 'voice'
      ? { ...param, values: ['alloy', 'echo', 'fable', 'nova', 'onyx', 'shimmer'] }
      : param,
  ),
});

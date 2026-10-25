import { ModelProfile, type ChannelModelWrite, ImageProtocol } from '@frame-loom/contracts';
import { DomainError } from '../../../core/http/domain-error.js';

const runtime = {
  concurrency: 1,
  pollInitialMs: 5000,
  pollMaxMs: 30_000,
  timeoutMs: 900_000,
  submitTimeoutMs: 180_000,
  supportsCancel: false,
};
const imageInput = {
  kind: 'image',
  maxCount: 4,
  maxBytes: 20 * 1024 * 1024,
  mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
  minWidth: 1,
  maxWidth: 16_384,
  minHeight: 1,
  maxHeight: 16_384,
  transport: 'inline',
};
const modes = [
  { id: 'text', name: '文生图' },
  { id: 'reference', name: '参考图' },
];
const definitions = [
  {
    protocol: 'openai-images',
    name: 'OpenAI 图片',
    ids: ['gpt-image-1', 'gpt-image-1.5', 'gpt-image-2'],
    params: [
      {
        key: 'size',
        name: '尺寸',
        type: 'enum',
        values: ['1024x1024', '1536x1024', '1024x1536'],
        default: '1024x1024',
      },
      {
        key: 'quality',
        name: '质量',
        type: 'enum',
        values: ['auto', 'low', 'medium', 'high'],
        default: 'auto',
      },
      { key: 'n', name: '图片数量', type: 'enum', values: [1], default: 1 },
    ],
  },
  {
    protocol: 'gemini-image',
    name: 'Gemini 图片',
    ids: ['gemini-2.5-flash-image', 'gemini-3-pro-image-preview'],
    params: [
      {
        key: 'aspectRatio',
        name: '画面比例',
        type: 'enum',
        values: ['1:1', '16:9', '9:16', '4:3', '3:4'],
        default: '1:1',
      },
    ],
  },
  {
    protocol: 'ark-images',
    name: 'Seedream 图片',
    ids: ['doubao-seedream-4-0-250828', 'doubao-seedream-4-5-251128'],
    params: [
      { key: 'size', name: '尺寸', type: 'enum', values: ['2K', '4K'], default: '2K' },
      { key: 'watermark', name: '水印', type: 'boolean', default: true },
    ],
  },
];

export const imageProfiles: ModelProfile[] = definitions.flatMap((definition) => [
  ModelProfile.parse({
    id: `${definition.protocol}-default`,
    name: definition.name,
    kind: 'image',
    protocol: definition.protocol,
    matchIds: definition.ids,
    generic: false,
    modes,
    params: definition.params,
    constraints: [],
    inputs: [imageInput],
    runtime,
  }),
  ModelProfile.parse({
    id: `${definition.protocol}-generic`,
    name: `通用 ${definition.name}`,
    kind: 'image',
    protocol: definition.protocol,
    matchIds: [],
    generic: true,
    modes,
    params: [],
    constraints: [],
    inputs: [{ ...imageInput, maxCount: 1 }],
    runtime,
  }),
]);

export function imageProfile(
  model: Pick<ChannelModelWrite, 'kind' | 'protocol' | 'profileId' | 'upstreamModelId'>,
): ModelProfile {
  if (model.kind !== 'image' || !ImageProtocol.safeParse(model.protocol).success)
    throw new DomainError('INVALID_PROTOCOL', 422, '请选择支持的图片协议');
  const selected = model.profileId
    ? imageProfiles.find(
        (profile) => profile.id === model.profileId && profile.protocol === model.protocol,
      )
    : (imageProfiles.find(
        (profile) =>
          profile.protocol === model.protocol && profile.matchIds.includes(model.upstreamModelId),
      ) ?? imageProfiles.find((profile) => profile.protocol === model.protocol && profile.generic));
  if (!selected) throw new DomainError('INVALID_PROFILE', 422, '档案不存在或与模型协议不匹配');
  return selected;
}

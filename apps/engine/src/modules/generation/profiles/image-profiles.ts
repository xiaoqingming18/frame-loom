import {
  ModelProfile,
  type ChannelModelWrite,
  ImageProtocol,
  IMAGE_ASPECT_RATIOS,
  IMAGE_RESOLUTIONS,
  IMAGE_QUALITIES,
  IMAGE_BACKGROUNDS,
} from '@frame-loom/contracts';
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
type Param = ModelProfile['params'][number];
function choice(
  key: string,
  name: string,
  values: readonly string[],
  defaultValue: string,
  notes?: Record<string, string>,
): Param {
  return {
    key,
    name,
    type: 'enum',
    values: [...values],
    default: defaultValue,
    mapped: true,
    notes,
  };
}
const ratios = choice('aspectRatio', '比例', IMAGE_ASPECT_RATIOS, '1:1');
const resolution = choice('resolution', '清晰度', IMAGE_RESOLUTIONS, '2K');
const quality = choice('quality', '画质', IMAGE_QUALITIES.slice(0, 3), 'medium');
const background = choice('background', '背景', IMAGE_BACKGROUNDS, 'auto');
const fixedRatios = choice('aspectRatio', '比例', ['1:1', '3:2', '2:3'], '1:1');
const geminiRatios = choice('aspectRatio', '比例', IMAGE_ASPECT_RATIOS.slice(0, 10), '1:1');
const experimentalResolution = { ...resolution, notes: { '4K': '实验' } };
const seedreamResolution = choice('resolution', '清晰度', ['2K', '4K'], '2K');
const watermark: Param = {
  key: 'watermark',
  name: '水印',
  type: 'boolean',
  default: true,
  mapped: true,
};
const fixedOpenaiParams = [fixedRatios, quality, background];
const seedreamParams = [ratios, seedreamResolution, watermark];

function profile(
  protocol: ImageProtocol,
  suffix: string,
  name: string,
  matchIds: string[],
  params: Param[],
): ModelProfile {
  return ModelProfile.parse({
    id: `${protocol}-${suffix}`,
    name,
    kind: 'image',
    imageEditCapabilities:
      protocol === 'openai-images'
        ? {
            operations:
              suffix === 'generic' ? ['angle', 'lighting'] : ['angle', 'lighting', 'emotion'],
            maxReferenceImages: suffix === 'generic' ? 1 : 3,
            openAiImageEdit: true,
            mask: suffix !== 'gpt-image-2.5',
          }
        : {
            operations: ['angle', 'lighting'],
            maxReferenceImages: suffix === 'generic' ? 1 : imageInput.maxCount,
            openAiImageEdit: false,
            mask: false,
          },
    protocol,
    matchIds,
    generic: suffix === 'generic',
    modes,
    params,
    constraints: [],
    inputs: [{ ...imageInput, maxCount: suffix === 'generic' ? 1 : imageInput.maxCount }],
    runtime,
  });
}

export const imageProfiles: ModelProfile[] = [
  profile(
    'openai-images',
    'default',
    'OpenAI GPT Image 1',
    ['gpt-image-1', 'chatgpt-image'],
    fixedOpenaiParams,
  ),
  profile(
    'openai-images',
    'gpt-image-2',
    'OpenAI GPT Image 2',
    ['gpt-image-2'],
    [ratios, experimentalResolution, quality, { ...background, notes: { transparent: '预览' } }],
  ),
  profile(
    'openai-images',
    'gpt-image-2.5',
    'OpenAI GPT Image 2.5',
    ['gpt-image-2.5'],
    [
      ratios,
      experimentalResolution,
      choice('quality', '画质', IMAGE_QUALITIES, 'medium'),
      background,
    ],
  ),
  profile('openai-images', 'generic', '通用 OpenAI 图片', [], fixedOpenaiParams),
  profile(
    'gemini-image',
    'default',
    'Gemini 2.5 Flash Image',
    ['gemini-2.5-flash-image'],
    [geminiRatios],
  ),
  profile(
    'gemini-image',
    'gemini-3-pro',
    'Gemini 3 Pro Image',
    ['gemini-3-pro-image'],
    [geminiRatios, resolution],
  ),
  profile(
    'gemini-image',
    'gemini-3.1-flash',
    'Gemini 3.1 Flash Image',
    ['gemini-3.1-flash-image'],
    [geminiRatios, resolution],
  ),
  profile('gemini-image', 'generic', '通用 Gemini 图片', [], [geminiRatios]),
  profile(
    'ark-images',
    'default',
    'Seedream 4.0',
    ['doubao-seedream-4-0'],
    [ratios, resolution, watermark],
  ),
  profile('ark-images', 'seedream-4.5', 'Seedream 4.5', ['doubao-seedream-4-5'], seedreamParams),
  profile('ark-images', 'generic', '通用 Seedream 图片', [], seedreamParams),
];

export function imageProfile(
  model: Pick<ChannelModelWrite, 'kind' | 'protocol' | 'profileId' | 'upstreamModelId'>,
): ModelProfile {
  if (model.kind !== 'image' || !ImageProtocol.safeParse(model.protocol).success)
    throw new DomainError('INVALID_PROTOCOL', 422, '请选择支持的图片协议');
  const selected = model.profileId
    ? imageProfiles.find(
        (profile) => profile.id === model.profileId && profile.protocol === model.protocol,
      )
    : (imageProfiles
        .filter((profile) => profile.protocol === model.protocol)
        .flatMap((profile) =>
          profile.matchIds
            .filter((prefix) => model.upstreamModelId.startsWith(prefix))
            .map((prefix) => ({ profile, length: prefix.length })),
        )
        .sort((a, b) => b.length - a.length)[0]?.profile ??
      imageProfiles.find((profile) => profile.protocol === model.protocol && profile.generic));
  if (!selected) throw new DomainError('INVALID_PROFILE', 422, '档案不存在或与模型协议不匹配');
  return selected;
}

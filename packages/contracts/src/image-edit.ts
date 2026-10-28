import { z } from 'zod';
import type { ModelProfile } from './generation.js';
import type { ImageCap } from './capabilities.js';
import type { ProtocolDescriptor } from './protocols.js';

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const FaceBox = z.strictObject({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});
const Source = z.strictObject({
  nodeId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  sha256: Sha256,
});
const Common = { version: z.literal(1), source: Source };

const ImageEditRecipeUnion = z.discriminatedUnion('operation', [
  z.strictObject({
    ...Common,
    operation: z.literal('angle'),
    horizontalAngle: z.number().int().min(-180).max(180),
    pitchAngle: z.number().int().min(-60).max(60),
    cameraDistance: z.number().min(1).max(10),
    lens: z.enum(['standard', 'wide']),
  }),
  z.strictObject({
    ...Common,
    operation: z.literal('lighting'),
    azimuth: z.number().int().min(0).max(359),
    elevation: z.number().int().min(-80).max(80),
    brightness: z.number().int().min(0).max(100),
    rimLight: z.boolean(),
    stylePreset: z.string().max(64),
    smartMode: z.boolean(),
    lightColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
  z.strictObject({
    ...Common,
    operation: z.literal('emotion'),
    targetFace: FaceBox,
    editRegion: FaceBox,
    imageWidth: z.number().int().positive().max(16384),
    imageHeight: z.number().int().positive().max(16384),
    presetId: z.string().min(1).max(64),
    intimacy: z.number().int().min(-2).max(2),
    arousal: z.number().int().min(-2).max(2),
    characterName: z.string().max(100),
    maskMode: z.enum(['provider', 'local']),
    artifacts: z
      .strictObject({ crop: Sha256, identity: Sha256, mask: Sha256.optional() })
      .optional(),
    postProcess: z.enum(['pending', 'composing', 'complete']).default('pending'),
  }),
]);
export const ImageEditRecipe = ImageEditRecipeUnion.superRefine((recipe, context) => {
  if (recipe.operation !== 'emotion') return;
  for (const [name, box] of [
    ['目标人脸框', recipe.targetFace],
    ['编辑区域', recipe.editRegion],
  ] as const)
    if (box.x + box.width > recipe.imageWidth || box.y + box.height > recipe.imageHeight)
      context.addIssue({ code: 'custom', path: [name], message: `${name}超出源图片范围` });
});
export type ImageEditRecipe = z.infer<typeof ImageEditRecipe>;

export const ImageEditCapabilities = z.strictObject({
  operations: z.array(z.enum(['angle', 'lighting', 'emotion'])).max(3),
  maxReferenceImages: z.number().int().min(1).max(50),
  openAiImageEdit: z.boolean(),
  mask: z.boolean(),
});
export type ImageEditCapabilities = z.infer<typeof ImageEditCapabilities>;

export function imageEditSupport(cap: ImageCap, descriptor: ProtocolDescriptor) {
  const max = cap.references.max ?? Infinity;
  const available = max >= 1;
  const emotion = !!descriptor.ceiling.image?.edit && max >= 2;
  const mask =
    emotion &&
    max >= 3 &&
    !!cap.mask &&
    !!descriptor.ceiling.image?.mask.includes(cap.mask.semantics);
  return {
    angle: { available, mask: false, ...(!available ? { reason: '至少需要一个参考图' } : {}) },
    lighting: { available, mask: false, ...(!available ? { reason: '至少需要一个参考图' } : {}) },
    emotion: {
      available: emotion,
      mask,
      ...(!emotion ? { reason: '需要编辑接口与至少两个参考图' } : {}),
    },
  };
}

export function imageEditCapabilityIssue(
  recipe: ImageEditRecipe,
  profile: Pick<ModelProfile, 'kind' | 'protocol' | 'modes' | 'inputs' | 'imageEditCapabilities'>,
): string | undefined {
  const capability = profile.imageEditCapabilities;
  if (!capability) return '所选模型的图片编辑能力尚未确认，请更新模型定义';
  if (
    recipe.operation === 'emotion' &&
    (profile.protocol !== 'openai-images' || !capability.openAiImageEdit)
  )
    return '表情编辑需要 OpenAI Images 编辑协议';
  if (!capability.operations.includes(recipe.operation)) return '所选模型已禁用此图片编辑操作';
  if (
    profile.kind !== 'image' ||
    !['openai-images', 'gemini-image', 'ark-images'].includes(profile.protocol)
  )
    return '所选模型协议不支持图片编辑';
  if (!profile.modes.some((mode) => mode.id === 'reference')) return '所选模型未开放参考图模式';
  const maxReferences = Math.min(
    capability.maxReferenceImages,
    profile.inputs.find((input) => input.kind === 'image' && input.transport === 'inline')
      ?.maxCount ?? 0,
  );
  if (recipe.operation === 'emotion' && recipe.maskMode === 'provider' && !capability.mask)
    return '所选模型不支持蒙版';
  const requiredReferences =
    recipe.operation === 'emotion' ? (recipe.maskMode === 'provider' ? 3 : 2) : 1;
  if (maxReferences < requiredReferences)
    return `${recipe.operation === 'emotion' ? '表情编辑' : '图片编辑'}需要至少 ${requiredReferences} 个图片参考`;
  return undefined;
}

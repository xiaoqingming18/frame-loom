import { z } from 'zod';
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
const Pixel = z.number().int().nonnegative().max(32768);
const Geometry = z.strictObject({
  crop: z.strictObject({ x: Pixel, y: Pixel, width: Pixel.positive(), height: Pixel.positive() }),
  pad: z.strictObject({ left: Pixel, right: Pixel, top: Pixel, bottom: Pixel }),
  expected: z.strictObject({
    ratio: z.number().finite().positive().optional(),
    width: Pixel.positive().optional(),
    height: Pixel.positive().optional(),
  }),
});
const Common = { version: z.literal(1), source: Source, geometry: Geometry.optional() };

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
    ...(recipe.geometry ? [['几何裁切', recipe.geometry.crop] as const] : []),
  ] as const)
    if (box.x + box.width > recipe.imageWidth || box.y + box.height > recipe.imageHeight)
      context.addIssue({ code: 'custom', path: [name], message: `${name}超出源图片范围` });
});
export type ImageEditRecipe = z.infer<typeof ImageEditRecipe>;

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

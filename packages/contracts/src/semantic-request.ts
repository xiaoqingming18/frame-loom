import { z } from 'zod';
import { ImageEditRecipe } from './image-edit.js';

export const Value = z.union([z.string(), z.number().finite(), z.boolean()]);
export type Value = z.infer<typeof Value>;
export const VideoModeId = z.enum([
  't2v',
  'first',
  'last',
  'first_last',
  'keyframes',
  'reference',
  'edit',
  'extend',
]);
export type VideoModeId = z.infer<typeof VideoModeId>;
export const InputRole = z.enum([
  'first_frame',
  'last_frame',
  'keyframe',
  'reference',
  'base_video',
]);
export type InputRole = z.infer<typeof InputRole>;
export const MediaKind = z.enum(['image', 'video', 'audio']);
export type MediaKind = z.infer<typeof MediaKind>;
export const PromptRefSyntax = z.enum(['ordinal', '@image_n', '<IMAGE_n>']);
export type PromptRefSyntax = z.infer<typeof PromptRefSyntax>;
export const SemanticParams = z.strictObject({
  aspectRatio: z.string().optional(),
  tier: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  quality: z.string().optional(),
  background: z.string().optional(),
  outputFormat: z.string().optional(),
  compression: z.number().optional(),
  count: z.number().optional(),
  seed: z.number().optional(),
  negativePrompt: z.string().optional(),
  duration: z.number().optional(),
  resolution: z.string().optional(),
  audio: z.boolean().optional(),
  watermark: z.boolean().optional(),
  voice: z.string().optional(),
  instructions: z.string().optional(),
  speed: z.number().optional(),
  pitch: z.number().optional(),
  volume: z.number().optional(),
  format: z.string().optional(),
  sampleRate: z.number().optional(),
});
export type SemanticParams = z.infer<typeof SemanticParams>;
export type SemanticParamKey = keyof SemanticParams;
export const SemanticInput = z.strictObject({
  role: InputRole,
  kind: MediaKind,
  order: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type SemanticInput = z.infer<typeof SemanticInput>;
export const SemanticRequest = z.strictObject({
  modelId: z.uuid(),
  projectId: z.uuid().optional(),
  pageId: z.uuid().optional(),
  mode: VideoModeId.optional(),
  prompt: z.string().trim().min(1).max(32000),
  inputs: z.array(SemanticInput).max(50),
  params: SemanticParams.default({}),
  extras: z.record(z.string(), Value).default({}),
  imageEdit: ImageEditRecipe.optional(),
  source: z.enum(['canvas', 'test', 'agent', 'manual']).default('manual'),
});
export type SemanticRequest = z.infer<typeof SemanticRequest>;

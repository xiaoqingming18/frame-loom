import { z } from 'zod';
import { SemanticRequest } from './semantic-request.js';

export const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const GenerationStatus = z.enum([
  'pending',
  'submitting',
  'running',
  'downloading',
  'succeeded',
  'submit_unknown',
  'paused',
  'download_failed',
  'failed',
  'cancelled',
]);
export type GenerationStatus = z.infer<typeof GenerationStatus>;
export const GenerationErrorCategory = z.enum([
  'auth',
  'quota',
  'rate_limit',
  'moderation',
  'invalid_params',
  'input_unreachable',
  'timeout',
  'upstream',
  'network',
  'unknown',
]);
export type GenerationErrorCategory = z.infer<typeof GenerationErrorCategory>;
export const MediaFile = z.object({
  sha256: Sha256,
  mime: z.string(),
  bytes: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  fps: z.number().positive().nullable().optional(),
  codec: z.string().nullable().optional(),
  audioCodec: z.string().nullable().optional(),
  sampleRate: z.number().int().positive().nullable().optional(),
  channels: z.number().int().positive().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type MediaFile = z.infer<typeof MediaFile>;
export const GenerationJob = z.object({
  id: z.string().uuid(),
  kind: z.enum(['image', 'video', 'tts']),
  modelId: z.string().uuid(),
  status: GenerationStatus,
  recoveryAction: z
    .enum(['none', 'query', 'download', 'idempotent_submit', 'prepare', 'new_job'])
    .optional(),
  canCancelRemote: z.boolean().optional(),
  cancellation: z.enum(['requested', 'confirmed', 'unknown']).optional(),
  request: SemanticRequest,
  remoteTaskId: z.string().nullable(),
  remoteStatus: z.string().nullable(),
  attempts: z.number().int(),
  nextPollAt: z.string().datetime().nullable(),
  errorCategory: GenerationErrorCategory.nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  diagnostic: z
    .object({
      stage: z.enum(['validation', 'upload', 'submit', 'query', 'download', 'cancel']),
      method: z.string(),
      route: z.string(),
      httpStatus: z.number().optional(),
      requestId: z.string().optional(),
    })
    .nullable()
    .optional(),
  outputs: z.array(MediaFile),
  usage: z.unknown().optional(),
  configHash: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
});
export type GenerationJob = z.infer<typeof GenerationJob>;
export const GenerationJobList = z.array(GenerationJob);

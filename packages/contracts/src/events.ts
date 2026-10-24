import { z } from 'zod';

export const EngineEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heartbeat'), timestamp: z.iso.datetime({ offset: true }) }),
  z.object({ type: z.literal('generation.job.updated'), jobId: z.string().min(1) }),
]);

export type EngineEvent = z.infer<typeof EngineEvent>;

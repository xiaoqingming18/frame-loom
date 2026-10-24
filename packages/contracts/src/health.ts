import { z } from 'zod';

export const HealthResponse = z.object({
  status: z.literal('ok'),
  engineVersion: z.string(),
  schemaVersion: z.string(),
  startedAt: z.iso.datetime({ offset: true }),
});

export type HealthResponse = z.infer<typeof HealthResponse>;

import { z } from 'zod';

export const VoiceWrite = z.strictObject({
  voiceId: z.string().trim().min(1).max(300),
  name: z.string().trim().min(1).max(100),
});
export type VoiceWrite = z.infer<typeof VoiceWrite>;
export const Voice = VoiceWrite.extend({
  id: z.string().optional(),
  source: z.enum(['builtin', 'saved', 'provider']),
});
export const VoiceDirectory = z.object({
  param: z.string(),
  canFetch: z.boolean(),
  canManual: z.boolean(),
  voices: z.array(Voice),
});
export type VoiceDirectory = z.infer<typeof VoiceDirectory>;

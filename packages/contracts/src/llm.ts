import { z } from 'zod';

export const ProviderErrorCode = z.enum([
  'AUTH_FAILED',
  'CONNECTION_FAILED',
  'RATE_LIMITED',
  'UPSTREAM_ERROR',
  'INVALID_RESPONSE',
  'INCOMPLETE_STREAM',
  'REQUEST_TIMEOUT',
  'REQUEST_ABORTED',
]);
export type ProviderErrorCode = z.infer<typeof ProviderErrorCode>;
export const ModelUsage = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative(),
  totalTokens: z.number().nonnegative(),
});
export type ModelUsage = z.infer<typeof ModelUsage>;
export const TestChatRequest = z.strictObject({
  modelId: z.string().uuid(),
  messages: z
    .array(
      z.strictObject({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(32_000),
      }),
    )
    .min(1)
    .max(50),
});
export type TestChatRequest = z.infer<typeof TestChatRequest>;
export const LlmEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text.delta'), delta: z.string() }),
  z.object({ type: z.literal('thinking.delta'), delta: z.string() }),
  z.object({ type: z.literal('done'), usage: ModelUsage, stopReason: z.string() }),
  z.object({ type: z.literal('error'), code: ProviderErrorCode, message: z.string() }),
]);
export type LlmEvent = z.infer<typeof LlmEvent>;

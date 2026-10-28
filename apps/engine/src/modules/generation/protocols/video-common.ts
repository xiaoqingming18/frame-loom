import { z } from 'zod';
import type { SemanticRequest, VideoCap } from '@frame-loom/contracts';
import type { AdapterContext, AdapterResult } from './types.js';
import { dataUrl, invalidResponse } from './common.js';
import { GenerationFailure } from './http.js';

export async function queryResult(parse: () => Promise<AdapterResult>): Promise<AdapterResult> {
  try {
    return await parse();
  } catch (error) {
    if (error instanceof GenerationFailure && error.code === 'INVALID_RESPONSE')
      return {
        status: 'failed',
        category: 'upstream',
        code: 'INVALID_RESPONSE',
        message: '上游查询返回无法识别',
      };
    throw error;
  }
}

export const providerFailure = (code: string | number | undefined): AdapterResult => {
  const value = String(code ?? '').toLowerCase();
  return {
    status: 'failed',
    category: /moderation|sensitive|content|1026/.test(value)
      ? 'moderation'
      : /auth|api.?key|1004/.test(value)
        ? 'auth'
        : /balance|quota|1008/.test(value)
          ? 'quota'
          : /rate|1002/.test(value)
            ? 'rate_limit'
            : /invalid|2013/.test(value)
              ? 'invalid_params'
              : 'upstream',
    code: 'VIDEO_FAILED',
    message: '上游视频任务失败',
  };
};
export function videoState(
  id: string | undefined,
  status: string | undefined,
  outputs: string[],
  running: string[],
  succeeded: string[],
  failed: string[],
  code?: string | number,
): AdapterResult {
  if (status && failed.includes(status)) return providerFailure(code);
  if (status && succeeded.includes(status)) {
    if (!outputs.length || outputs.some((url) => !z.url().safeParse(url).success))
      return invalidResponse();
    return {
      status: 'succeeded',
      outputs: outputs.map((url) => ({ kind: 'url', url, mime: 'video/mp4' })),
    };
  }
  if (id && status && running.includes(status))
    return { status: 'running', remoteTaskId: id, remoteStatus: status };
  return invalidResponse();
}
export async function roleContent(ctx: AdapterContext, request: SemanticRequest) {
  const inputs = [...request.inputs].sort((a, b) => a.order - b.order);
  const content: unknown[] = [{ type: 'text', text: ctx.resolvePrompt(request.prompt, inputs) }];
  for (const input of inputs) {
    const type = `${input.kind}_url`;
    const role = input.role === 'reference' ? `reference_${input.kind}` : input.role;
    const url =
      input.kind === 'image' ? await dataUrl(ctx, input.sha256) : ctx.referenceUrl(input.sha256);
    content.push({ type, [type]: { url }, role });
  }
  return content;
}
export function durationValue(request: SemanticRequest, cap: VideoCap) {
  return request.params.duration ?? (cap.duration.kind === 'auto' ? -1 : cap.duration.default);
}

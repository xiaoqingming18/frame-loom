import { z } from 'zod';
import { MINIMAX_VIDEO_V2 } from '@frame-loom/contracts';
import { GenerationFailure } from './http.js';
import { endpointCall, jsonCall, jsonResult, invalidResponse } from './common.js';
import {
  durationValue,
  providerFailure,
  queryResult,
  roleContent,
  videoState,
} from './video-common.js';
import type { ProtocolAdapter } from './types.js';

const response = z.object({
  task_id: z.string().optional(),
  base_resp: z.object({ status_code: z.number() }).optional(),
  error: z.object({ type: z.string().optional(), http_code: z.string().optional() }).optional(),
  task: z
    .object({
      id: z.string().optional(),
      status: z.string(),
      content: z.object({ url: z.string().optional() }).optional(),
      usage: z.unknown().optional(),
    })
    .optional(),
});
export const minimaxVideoV2: ProtocolAdapter = {
  descriptor: MINIMAX_VIDEO_V2,
  async buildSubmit(ctx, req, cap) {
    if (cap.kind !== 'video')
      throw new GenerationFailure('invalid_params', 'INVALID_KIND', '需要视频能力卡');
    return jsonCall(ctx, MINIMAX_VIDEO_V2, req, {
      model: ctx.snapshot.upstreamModelId,
      content: await roleContent(ctx, req),
      duration: durationValue(req, cap),
      resolution: req.params.resolution ?? cap.defaultResolution,
      ratio: req.params.aspectRatio ?? cap.defaultAspectRatio,
    });
  },
  parseSubmit: (_ctx, res) => {
    const body = jsonResult(res, response);
    if (body.base_resp?.status_code)
      return Promise.resolve(providerFailure(body.base_resp.status_code));
    if (body.error) return Promise.resolve(providerFailure(body.error.type));
    if (!body.task_id) return invalidResponse();
    return Promise.resolve({
      status: 'running',
      remoteTaskId: body.task_id,
      remoteStatus: 'queued',
    });
  },
  buildQuery: (ctx, id) => endpointCall(ctx, MINIMAX_VIDEO_V2, 'query', { id }),
  parseQuery: (_ctx, res) =>
    queryResult(() => {
      const body = jsonResult(res, response);
      if (body.base_resp?.status_code)
        return Promise.resolve(providerFailure(body.base_resp.status_code));
      if (body.error) return Promise.resolve(providerFailure(body.error.type));
      const task = body.task;
      const result = videoState(
        task?.id ?? body.task_id,
        task?.status,
        task?.content?.url ? [task.content.url] : [],
        ['queued', 'pending', 'processing', 'running'],
        ['succeeded'],
        ['failed', 'cancelled', 'expired'],
      );
      return Promise.resolve(
        result.status === 'succeeded' ? { ...result, usage: task?.usage } : result,
      );
    }),
};

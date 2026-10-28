import { z } from 'zod';
import { DASHSCOPE_WAN } from '@frame-loom/contracts';
import { GenerationFailure } from './http.js';
import { dataUrl, endpointCall, jsonCall, jsonResult } from './common.js';
import { durationValue, providerFailure, queryResult, videoState } from './video-common.js';
import type { ProtocolAdapter } from './types.js';

const response = z.object({
  output: z
    .object({
      task_id: z.string().optional(),
      task_status: z.string().optional(),
      video_url: z.string().optional(),
      code: z.string().optional(),
    })
    .optional(),
  code: z.string().optional(),
});
export const dashscopeWan: ProtocolAdapter = {
  descriptor: DASHSCOPE_WAN,
  async buildSubmit(ctx, req, cap) {
    if (cap.kind !== 'video')
      throw new GenerationFailure('invalid_params', 'INVALID_KIND', '需要视频能力卡');
    const inputs = [...req.inputs].sort((a, b) => a.order - b.order);
    const media = await Promise.all(
      inputs.map(async (input) => ({
        type: input.role === 'reference' ? `reference_${input.kind}` : input.role,
        url:
          input.kind === 'image'
            ? await dataUrl(ctx, input.sha256)
            : ctx.referenceUrl(input.sha256),
      })),
    );
    return jsonCall(ctx, DASHSCOPE_WAN, req, {
      model: ctx.snapshot.upstreamModelId,
      input: { prompt: ctx.resolvePrompt(req.prompt, inputs), ...(media.length ? { media } : {}) },
      parameters: {
        resolution: req.params.resolution ?? cap.defaultResolution,
        ratio: req.params.aspectRatio ?? cap.defaultAspectRatio,
        duration: durationValue(req, cap),
        audio: req.params.audio ?? cap.audio.default,
        seed: req.params.seed,
      },
    });
  },
  parseSubmit: (_ctx, res) => {
    const body = jsonResult(res, response);
    return Promise.resolve(
      body.code
        ? providerFailure(body.code)
        : videoState(
            body.output?.task_id,
            body.output?.task_status,
            body.output?.video_url ? [body.output.video_url] : [],
            ['PENDING', 'RUNNING'],
            ['SUCCEEDED'],
            ['FAILED', 'CANCELED', 'UNKNOWN'],
            body.output?.code,
          ),
    );
  },
  buildQuery: (ctx, id) => endpointCall(ctx, DASHSCOPE_WAN, 'query', { id }),
  parseQuery: (ctx, res) => queryResult(() => dashscopeWan.parseSubmit(ctx, res)),
};

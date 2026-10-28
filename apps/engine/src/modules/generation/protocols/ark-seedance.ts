import { z } from 'zod';
import { ARK_SEEDANCE } from '@frame-loom/contracts';
import { GenerationFailure } from './http.js';
import { endpointCall, jsonCall, jsonResult } from './common.js';
import {
  durationValue,
  providerFailure,
  queryResult,
  roleContent,
  videoState,
} from './video-common.js';
import type { ProtocolAdapter } from './types.js';

const response = z.object({
  id: z.string().optional(),
  status: z.string().optional(),
  content: z.object({ video_url: z.string().optional() }).optional(),
  error: z.object({ code: z.string().optional() }).optional(),
});
export const arkSeedance: ProtocolAdapter = {
  descriptor: ARK_SEEDANCE,
  async buildSubmit(ctx, req, cap) {
    if (cap.kind !== 'video')
      throw new GenerationFailure('invalid_params', 'INVALID_KIND', '需要视频能力卡');
    return jsonCall(ctx, ARK_SEEDANCE, req, {
      model: ctx.snapshot.upstreamModelId,
      content: await roleContent(ctx, req),
      ratio: req.params.aspectRatio ?? cap.defaultAspectRatio,
      resolution: req.params.resolution ?? cap.defaultResolution,
      duration: durationValue(req, cap),
      generate_audio: req.params.audio ?? cap.audio.default,
      watermark: req.params.watermark ?? cap.watermark?.default,
      seed: req.params.seed,
    });
  },
  parseSubmit: (_ctx, res) => {
    const body = jsonResult(res, response);
    return Promise.resolve(
      body.error
        ? providerFailure(body.error.code)
        : videoState(
            body.id,
            body.status ?? (body.id ? 'queued' : undefined),
            body.content?.video_url ? [body.content.video_url] : [],
            ['queued', 'running'],
            ['succeeded'],
            ['failed', 'expired', 'cancelled'],
          ),
    );
  },
  buildQuery: (ctx, id) => endpointCall(ctx, ARK_SEEDANCE, 'query', { id }),
  parseQuery: (_ctx, res) =>
    queryResult(() => {
      const body = jsonResult(res, response);
      return Promise.resolve(
        body.error
          ? providerFailure(body.error.code)
          : videoState(
              body.id,
              body.status,
              body.content?.video_url ? [body.content.video_url] : [],
              ['queued', 'running'],
              ['succeeded'],
              ['failed', 'expired', 'cancelled'],
            ),
      );
    }),
};

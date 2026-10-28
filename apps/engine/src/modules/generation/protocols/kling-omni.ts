import { z } from 'zod';
import { KLING_OMNI } from '@frame-loom/contracts';
import { GenerationFailure } from './http.js';
import { dataUrl, endpointCall, jsonCall, jsonResult, invalidResponse } from './common.js';
import { durationValue, providerFailure, queryResult, videoState } from './video-common.js';
import type { ProtocolAdapter } from './types.js';

const task = z.object({
  id: z.string(),
  status: z.string(),
  outputs: z.array(z.object({ type: z.string(), url: z.string().optional() })).optional(),
});
const response = z.object({ code: z.number(), data: z.union([task, z.array(task)]).optional() });
export const klingOmni: ProtocolAdapter = {
  descriptor: KLING_OMNI,
  async buildSubmit(ctx, req, cap) {
    if (cap.kind !== 'video')
      throw new GenerationFailure('invalid_params', 'INVALID_KIND', '需要视频能力卡');
    const inputs = [...req.inputs].sort((a, b) => a.order - b.order);
    const counts = { image: 1, video: 1, audio: 1 };
    const contents: unknown[] = [{ type: 'prompt', text: ctx.resolvePrompt(req.prompt, inputs) }];
    for (const input of inputs) {
      if (input.kind === 'audio')
        throw new GenerationFailure(
          'invalid_params',
          'INVALID_INPUT',
          '可灵音色 ID 不能使用本地音频代替',
        );
      const type =
        input.role === 'keyframe'
          ? 'middle_frame'
          : input.role === 'reference'
            ? input.kind === 'image'
              ? 'refer_image'
              : 'feature_video'
            : input.role;
      contents.push({
        type,
        url:
          input.kind === 'image'
            ? await dataUrl(ctx, input.sha256)
            : ctx.referenceUrl(input.sha256),
        id: `${input.kind}_${counts[input.kind]++}`,
      });
    }
    const duration = durationValue(req, cap);
    return jsonCall(ctx, KLING_OMNI, req, {
      contents,
      settings: {
        resolution: req.params.resolution ?? cap.defaultResolution,
        aspect_ratio: req.params.aspectRatio ?? cap.defaultAspectRatio,
        duration: duration === -1 ? undefined : duration,
      },
      options: { watermark_info: { enabled: req.params.watermark ?? cap.watermark?.default } },
    });
  },
  parseSubmit: (_ctx, res) => {
    const body = jsonResult(res, response);
    if (body.code) return Promise.resolve(providerFailure(body.code));
    const result = Array.isArray(body.data) ? body.data[0] : body.data;
    if (!result) return invalidResponse();
    return Promise.resolve(
      videoState(
        result.id,
        result.status,
        (result.outputs ?? []).flatMap((output) =>
          output.type === 'video' && output.url ? [output.url] : [],
        ),
        ['submitted', 'processing'],
        ['succeeded'],
        ['failed'],
      ),
    );
  },
  buildQuery: (ctx, id) => endpointCall(ctx, KLING_OMNI, 'query', { id }),
  parseQuery: (ctx, res) => queryResult(() => klingOmni.parseSubmit(ctx, res)),
};

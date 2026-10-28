import { z } from 'zod';
import { NEWAPI_VIDEO } from '@frame-loom/contracts';
import { GenerationFailure } from './http.js';
import { dataUrl, endpointCall, jsonCall, jsonResult, invalidResponse } from './common.js';
import { durationValue, providerFailure, queryResult, videoState } from './video-common.js';
import type { ProtocolAdapter } from './types.js';

const response = z.object({
  id: z.string().optional(),
  task_id: z.string().optional(),
  status: z.string().optional(),
  url: z.string().optional(),
  error: z.object({ code: z.union([z.string(), z.number()]).nullish() }).nullish(),
});
export const newapiVideo: ProtocolAdapter = {
  descriptor: NEWAPI_VIDEO,
  async buildSubmit(ctx, req, cap) {
    if (cap.kind !== 'video')
      throw new GenerationFailure('invalid_params', 'INVALID_KIND', '需要视频能力卡');
    const inputs = [...req.inputs].sort((a, b) => a.order - b.order);
    const duration = durationValue(req, cap);
    let width = req.params.width;
    let height = req.params.height;
    const resolution = req.params.resolution ?? cap.defaultResolution;
    const ratio = req.params.aspectRatio ?? cap.defaultAspectRatio;
    if (width === undefined && height === undefined && (resolution || ratio)) {
      const edge = Number(resolution?.match(/^(\d+)p$/i)?.[1]);
      const parts = ratio?.match(/^(\d+):(\d+)$/);
      if (!edge || !parts)
        throw new GenerationFailure(
          'invalid_params',
          'INVALID_VIDEO_SIZE',
          '请填写自定义宽高，或选择数字分辨率与画面比例',
        );
      const aspect = Number(parts[1]) / Number(parts[2]);
      width = Math.round((edge * Math.max(1, aspect)) / 2) * 2;
      height = Math.round((edge * Math.max(1, 1 / aspect)) / 2) * 2;
    }
    const body: Record<string, unknown> = {
      model: ctx.snapshot.upstreamModelId,
      prompt: ctx.resolvePrompt(req.prompt, inputs),
      duration: duration === -1 ? undefined : duration,
      width,
      height,
      image: inputs[0] ? await dataUrl(ctx, inputs[0].sha256) : undefined,
      seed: req.params.seed,
    };
    return jsonCall(ctx, NEWAPI_VIDEO, req, body);
  },
  parseSubmit: (_ctx, res) => {
    const body = jsonResult(res, response);
    if (body.error?.code) return Promise.resolve(providerFailure(body.error.code));
    const id = body.task_id ?? body.id;
    if (!id) return invalidResponse();
    return Promise.resolve(
      videoState(
        id,
        body.status ?? 'processing',
        body.url ? [body.url] : [],
        ['queued', 'in_progress', 'processing'],
        ['completed', 'succeeded'],
        ['failed'],
        body.error?.code ?? undefined,
      ),
    );
  },
  buildQuery: (ctx, id) => endpointCall(ctx, NEWAPI_VIDEO, 'query', { id }),
  parseQuery: (ctx, res) =>
    queryResult(() => {
      const body = jsonResult(res, response);
      if (!body.status) return invalidResponse();
      return newapiVideo.parseSubmit(ctx, res);
    }),
};

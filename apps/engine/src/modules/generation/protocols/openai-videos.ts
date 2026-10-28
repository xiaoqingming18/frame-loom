import { z } from 'zod';
import { OPENAI_VIDEOS } from '@frame-loom/contracts';
import { GenerationFailure } from './http.js';
import { appendFields, appendMedia, endpointCall, jsonResult, invalidResponse } from './common.js';
import { durationValue, providerFailure, queryResult } from './video-common.js';
import type { ProtocolAdapter, AdapterResult } from './types.js';

const response = z.object({
  id: z.string().optional(),
  status: z.string().optional(),
  error: z.object({ code: z.string().optional() }).nullish(),
});
function parse(res: Parameters<ProtocolAdapter['parseSubmit']>[1]): AdapterResult {
  const body = jsonResult(res, response);
  if (body.error || body.status === 'failed') return providerFailure(body.error?.code);
  if (!body.id) return invalidResponse();
  if (body.status === 'completed')
    return { status: 'succeeded', outputs: [{ kind: 'content', ref: body.id, mime: 'video/mp4' }] };
  if (body.status === 'queued' || body.status === 'in_progress')
    return { status: 'running', remoteTaskId: body.id, remoteStatus: body.status };
  return invalidResponse();
}
export const openaiVideos: ProtocolAdapter = {
  descriptor: OPENAI_VIDEOS,
  async buildSubmit(ctx, req, cap) {
    if (cap.kind !== 'video')
      throw new GenerationFailure('invalid_params', 'INVALID_KIND', '需要视频能力卡');
    const resolution = req.params.resolution ?? cap.defaultResolution ?? '';
    const ratio = req.params.aspectRatio ?? cap.defaultAspectRatio ?? '';
    const size = OPENAI_VIDEOS.videoSizes?.[resolution]?.[ratio];
    if (!size)
      throw new GenerationFailure('invalid_params', 'INVALID_SIZE', '协议不支持该分辨率与比例组合');
    const inputs = [...req.inputs].sort((a, b) => a.order - b.order);
    const body: Record<string, unknown> = {
      model: ctx.snapshot.upstreamModelId,
      prompt: ctx.resolvePrompt(req.prompt, inputs),
      seconds: String(durationValue(req, cap)),
      size,
    };
    ctx.applyExtras(body, ctx.snapshot.extras, ctx.snapshot.fixedFields, req.extras);
    const form = new FormData();
    appendFields(form, body);
    if (inputs[0]) await appendMedia(form, 'input_reference', ctx, inputs[0].sha256);
    return { ...endpointCall(ctx, OPENAI_VIDEOS, 'submit'), body: form };
  },
  parseSubmit: (_ctx, res) => Promise.resolve(parse(res)),
  buildQuery: (ctx, id) => endpointCall(ctx, OPENAI_VIDEOS, 'query', { id }),
  parseQuery: (_ctx, res) => queryResult(() => Promise.resolve(parse(res))),
  buildContent: (ctx, id) => endpointCall(ctx, OPENAI_VIDEOS, 'content', { id }),
};

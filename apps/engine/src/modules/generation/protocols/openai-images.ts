import { OPENAI_IMAGES, resolveImageSize } from '@frame-loom/contracts';
import type { ProtocolAdapter } from './types.js';
import { appendFields, appendMedia, endpointCall, imageResult, jsonCall } from './common.js';
import { GenerationFailure } from './http.js';

export const openaiImages: ProtocolAdapter = {
  descriptor: OPENAI_IMAGES,
  submitTimeoutMs: 300_000,
  async buildSubmit(ctx, request, cap) {
    if (cap.kind !== 'image')
      throw new GenerationFailure('invalid_params', 'INVALID_KIND', '需要图像能力卡');
    const size = resolveImageSize(cap, request.params, request.inputs.length > 0);
    const inputs = [...request.inputs].sort((a, b) => a.order - b.order);
    const params = request.params;
    const background = params.background ?? cap.background?.default;
    const body: Record<string, unknown> = {
      model: ctx.snapshot.upstreamModelId,
      prompt: ctx.resolvePrompt(request.prompt, inputs),
      n: 1,
      size: size.width && size.height ? `${size.width}x${size.height}` : undefined,
      quality: params.quality ?? cap.quality?.default,
      background,
      output_format: params.outputFormat ?? (background === 'transparent' ? 'png' : undefined),
      output_compression: params.compression,
    };
    if (!request.inputs.length) return jsonCall(ctx, OPENAI_IMAGES, request, body);
    ctx.applyExtras(body, ctx.snapshot.extras, ctx.snapshot.fixedFields, request.extras);
    const form = new FormData();
    appendFields(form, body);
    const mask =
      request.imageEdit?.operation === 'emotion' ? request.imageEdit.artifacts?.mask : undefined;
    for (const input of inputs)
      await appendMedia(form, input.sha256 === mask ? 'mask' : 'image[]', ctx, input.sha256);
    return { ...endpointCall(ctx, OPENAI_IMAGES, 'edit'), body: form };
  },
  parseSubmit: (_ctx, result) => Promise.resolve(imageResult(result, 'image/png')),
};

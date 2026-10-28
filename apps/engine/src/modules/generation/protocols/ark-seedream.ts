import { ARK_SEEDREAM, resolveImageSize } from '@frame-loom/contracts';
import type { ProtocolAdapter } from './types.js';
import { dataUrl, imageResult, jsonCall } from './common.js';
import { GenerationFailure } from './http.js';

export const arkSeedream: ProtocolAdapter = {
  descriptor: ARK_SEEDREAM,
  async buildSubmit(ctx, request, cap) {
    if (cap.kind !== 'image')
      throw new GenerationFailure('invalid_params', 'INVALID_KIND', '需要图像能力卡');
    const size = resolveImageSize(cap, request.params, request.inputs.length > 0);
    const inputs = [...request.inputs].sort((a, b) => a.order - b.order);
    return jsonCall(ctx, ARK_SEEDREAM, request, {
      model: ctx.snapshot.upstreamModelId,
      prompt: ctx.resolvePrompt(request.prompt, inputs),
      image: request.inputs.length
        ? await Promise.all(inputs.map((input) => dataUrl(ctx, input.sha256)))
        : undefined,
      size: size.width && size.height ? `${size.width}x${size.height}` : size.tier,
      sequential_image_generation: 'disabled',
      response_format: cap.responseFormat ?? 'url',
      output_format: request.params.outputFormat,
    });
  },
  parseSubmit: (_ctx, result) => Promise.resolve(imageResult(result, 'image/jpeg')),
};

import { imageRequestSize, resolveImageParams } from '@frame-loom/contracts';
import { imageProfile } from '../profiles/image-profiles.js';
import type { GenerationAdapter } from './types.js';
import { imageOutputs, imageResponse } from './image-response.js';

export const arkImages: GenerationAdapter = {
  protocol: 'ark-images',
  async submit(ctx, request) {
    const profile =
      ctx.profile ??
      imageProfile({
        kind: 'image',
        protocol: 'ark-images',
        profileId: null,
        upstreamModelId: ctx.model,
      });
    const { params } = resolveImageParams(profile, request.params);
    return imageOutputs(
      await imageResponse(
        await fetch(`${ctx.baseUrl}/images/generations`, {
          method: 'POST',
          headers: {
            ...ctx.headers,
            Authorization: `Bearer ${ctx.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: ctx.model,
            prompt: request.prompt,
            size: imageRequestSize(profile, params),
            watermark: params.watermark,
            ...(request.inputs.length
              ? { image: request.inputs.map((input) => input.dataUrl) }
              : {}),
            response_format: 'url',
          }),
          signal: ctx.signal,
          redirect: 'error',
        }),
      ),
      'image/jpeg',
    );
  },
};

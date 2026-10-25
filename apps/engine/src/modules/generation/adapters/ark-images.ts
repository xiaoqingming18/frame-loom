import type { GenerationAdapter } from './types.js';
import { imageOutputs, imageResponse } from './image-response.js';

export const arkImages: GenerationAdapter = {
  protocol: 'ark-images',
  async submit(ctx, request) {
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
            ...request.params,
            ...(request.inputs.length
              ? { image: request.inputs.map((input) => input.dataUrl) }
              : {}),
            response_format: 'url',
          }),
          signal: ctx.signal,
          redirect: 'error',
        }),
      ),
    );
  },
};

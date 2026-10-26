import { imageRequestSize, resolveImageParams } from '@frame-loom/contracts';
import { imageProfile } from '../profiles/image-profiles.js';
import type { GenerationAdapter } from './types.js';
import { imageOutputs, imageResponse } from './image-response.js';

export const openaiImages: GenerationAdapter = {
  protocol: 'openai-images',
  async submit(ctx, request) {
    const profile =
      ctx.profile ??
      imageProfile({
        kind: 'image',
        protocol: 'openai-images',
        profileId: null,
        upstreamModelId: ctx.model,
      });
    const { params } = resolveImageParams(profile, request.params);
    const payload = {
      model: ctx.model,
      prompt: request.prompt,
      size: imageRequestSize(profile, params),
      quality: params.quality,
      background: params.background,
      ...(params.background === 'transparent' ? { output_format: 'png' } : {}),
    };
    const headers = new Headers({ ...ctx.headers, Authorization: `Bearer ${ctx.apiKey}` });
    let body: FormData | string;
    if (request.inputs.length) {
      const form = new FormData();
      for (const [key, value] of Object.entries(payload)) form.append(key, String(value));
      for (const [index, input] of request.inputs.entries()) {
        const [prefix = '', base64 = ''] = input.dataUrl!.split(',');
        const mime = prefix.slice(5, -7);
        form.append(
          'image[]',
          new Blob([Buffer.from(base64, 'base64')], { type: mime }),
          `reference-${index}.${mime.split('/')[1]}`,
        );
      }
      body = form;
    } else {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(payload);
    }
    return imageOutputs(
      await imageResponse(
        await fetch(`${ctx.baseUrl}/images/${request.inputs.length ? 'edits' : 'generations'}`, {
          method: 'POST',
          headers,
          body,
          signal: ctx.signal,
          redirect: 'error',
        }),
      ),
    );
  },
};

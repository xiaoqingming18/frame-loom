import { z } from 'zod';
import { resolveImageParams, resolveModelOperation } from '@frame-loom/contracts';
import { imageProfile } from '../profiles/image-profiles.js';
import { GenerationFailure, adapterFetch, type GenerationAdapter } from './types.js';
import { imageResponse } from './image-response.js';

export const geminiImage: GenerationAdapter = {
  protocol: 'gemini-image',
  async submit(ctx, request) {
    const profile =
      ctx.profile ??
      imageProfile({
        kind: 'image',
        protocol: 'gemini-image',
        profileId: null,
        upstreamModelId: ctx.model,
      });
    const { params } = resolveImageParams(profile, request.params);
    const json = await imageResponse(
      await adapterFetch(
        ctx,
        resolveModelOperation(ctx.baseUrl, ctx.connection, 'gemini-image', 'submit', {
          model: ctx.model.replace(/^models\//, ''),
        }),
        {
          method: 'POST',
          headers: {
            ...ctx.headers,
            'x-goog-api-key': ctx.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  { text: request.prompt },
                  ...request.inputs.map((input) => {
                    const [prefix = '', data = ''] = input.dataUrl!.split(',');
                    return { inlineData: { mimeType: prefix.slice(5, -7), data } };
                  }),
                ],
              },
            ],
            generationConfig: {
              responseModalities: ['TEXT', 'IMAGE'],
              imageConfig: {
                aspectRatio: params.aspectRatio,
                ...(params.resolution ? { imageSize: params.resolution } : {}),
              },
            },
          }),
          signal: ctx.signal,
          redirect: 'error',
        },
      ),
    );
    const parsed = z
      .object({
        promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
        candidates: z
          .array(
            z.object({
              finishReason: z.string().optional(),
              content: z
                .object({
                  parts: z.array(
                    z.object({
                      inlineData: z
                        .object({ mimeType: z.string(), data: z.string().min(1) })
                        .optional(),
                    }),
                  ),
                })
                .optional(),
            }),
          )
          .optional(),
        usageMetadata: z.unknown().optional(),
      })
      .safeParse(json);
    if (!parsed.success)
      throw new GenerationFailure('upstream', 'INVALID_RESPONSE', '图片响应格式无效', false, true);
    const result = parsed.data;
    if (
      result.promptFeedback?.blockReason ||
      result.candidates?.some((item) =>
        ['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'RECITATION'].includes(
          item.finishReason ?? '',
        ),
      )
    )
      throw new GenerationFailure('moderation', 'SAFETY', '内容未通过审核');
    const outputs =
      result.candidates?.flatMap(
        (item) =>
          item.content?.parts.flatMap((part) =>
            part.inlineData ? [{ mime: part.inlineData.mimeType, data: part.inlineData.data }] : [],
          ) ?? [],
      ) ?? [];
    if (!outputs.length)
      throw new GenerationFailure(
        'upstream',
        'NO_IMAGE',
        '未收到图片，提交结果需要确认',
        false,
        true,
      );
    return { status: 'succeeded', outputs, usage: result.usageMetadata };
  },
};

import { z } from 'zod';
import { GEMINI_GENERATE, resolveImageSize } from '@frame-loom/contracts';
import { GenerationFailure } from './http.js';
import { invalidResponse, jsonCall, jsonResult } from './common.js';
import type { ProtocolAdapter, OutputRef } from './types.js';
import { audioResult, pcmWav } from './audio.js';

const response = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(
              z.object({
                inlineData: z.object({ data: z.string(), mimeType: z.string() }).optional(),
              }),
            ),
          })
          .optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  usageMetadata: z.unknown().optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
});
export const geminiGenerate: ProtocolAdapter = {
  descriptor: GEMINI_GENERATE,
  async buildSubmit(ctx, request, cap) {
    if (cap.kind === 'tts') {
      const configured = ctx.snapshot.fixedFields.find(
        (field) => field.path === 'generationConfig.speechConfig.multiSpeakerVoiceConfig',
      );
      const parsed = configured
        ? z
            .object({
              speakerVoiceConfigs: z
                .array(
                  z.object({
                    speaker: z.string().min(1),
                    voiceConfig: z.object({
                      prebuiltVoiceConfig: z.object({ voiceName: z.string().min(1) }),
                    }),
                  }),
                )
                .min(1)
                .max(cap.multiSpeaker?.max ?? 0),
            })
            .safeParse(configured.value)
        : undefined;
      if (parsed && !parsed.success)
        throw new GenerationFailure(
          'invalid_params',
          'INVALID_SPEAKERS',
          '多说话人配置无效或超过能力卡人数上限',
        );
      const multi = parsed?.success ? parsed.data : undefined;
      return jsonCall(ctx, GEMINI_GENERATE, request, {
        contents: [
          { role: 'user', parts: [{ text: ctx.resolvePrompt(request.prompt, request.inputs) }] },
        ],
        ...(request.params.instructions
          ? { systemInstruction: { parts: [{ text: request.params.instructions }] } }
          : {}),
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: multi
            ? { multiSpeakerVoiceConfig: multi }
            : {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: request.params.voice ?? cap.voices.default },
                },
              },
        },
      });
    }
    if (cap.kind !== 'image')
      throw new GenerationFailure('invalid_params', 'INVALID_KIND', '当前适配器需要图像能力卡');
    const inputs = [...request.inputs].sort((a, b) => a.order - b.order);
    const parts: unknown[] = [{ text: ctx.resolvePrompt(request.prompt, inputs) }];
    for (const input of inputs) {
      const media = await ctx.fetchMedia(input.sha256);
      parts.push({
        inlineData: { mimeType: media.mime, data: Buffer.from(media.bytes).toString('base64') },
      });
    }
    const size = resolveImageSize(cap, request.params, request.inputs.length > 0);
    return jsonCall(ctx, GEMINI_GENERATE, request, {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: size.ratio, imageSize: size.tier },
      },
    });
  },
  parseSubmit: (ctx, result) => {
    const body = jsonResult(result, response);
    if (
      body.promptFeedback?.blockReason ||
      body.candidates?.some((candidate) =>
        ['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT'].includes(candidate.finishReason ?? ''),
      )
    )
      return Promise.resolve({
        status: 'failed',
        category: 'moderation',
        code: 'CONTENT_BLOCKED',
        message: '内容未通过上游审核',
      });
    const outputs: OutputRef[] = (body.candidates ?? []).flatMap((candidate) =>
      (candidate.content?.parts ?? []).flatMap((part) => {
        const data = part.inlineData;
        if (!data) return [];
        if (ctx.snapshot.kind === 'tts') {
          if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data.data)) return invalidResponse();
          const bytes = Buffer.from(data.data, 'base64');
          const mime = data.mimeType.toLowerCase();
          const pcm = /^audio\/(?:l16|pcm)(?:;|$)/.test(mime);
          if (!pcm && mime !== 'audio/wav') return invalidResponse();
          if (pcm && /rate=(?!24000(?:;|$))\d+/.test(mime)) return invalidResponse();
          const audio = audioResult(pcm ? pcmWav(bytes) : bytes, 'audio/wav');
          return audio.status === 'succeeded' ? audio.outputs : invalidResponse();
        }
        if (!data.mimeType.startsWith('image/') || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.data))
          return invalidResponse();
        return [{ kind: 'data' as const, base64: data.data, mime: data.mimeType }];
      }),
    );
    if (!outputs.length) return invalidResponse();
    return Promise.resolve({ status: 'succeeded', outputs, usage: body.usageMetadata });
  },
};

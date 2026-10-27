import { z } from 'zod';
import { resolveModelOperation } from '@frame-loom/contracts';
import type { GenerationAdapter } from './types.js';
import { GenerationFailure, adapterFetch } from './types.js';
import { imageResponse } from './image-response.js';

const AudioResult = z.object({
  data: z.object({ audio: z.string().regex(/^(?:[a-f0-9]{2})+$/i) }),
  base_resp: z.object({ status_code: z.literal(0) }).optional(),
  extra_info: z
    .object({
      audio_format: z.string().optional(),
      audio_length: z.number().optional(),
      audio_sample_rate: z.number().optional(),
      usage_characters: z.number().int().nonnegative().optional(),
      word_count: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export const openaiSpeech: GenerationAdapter = {
  protocol: 'openai-speech',
  async submit(ctx, request) {
    const response = await adapterFetch(
      ctx,
      resolveModelOperation(ctx.baseUrl, ctx.connection, 'openai-speech', 'submit'),
      {
        method: 'POST',
        headers: {
          ...ctx.headers,
          Authorization: `Bearer ${ctx.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: ctx.model, input: request.prompt, ...request.params }),
        signal: ctx.signal,
        redirect: 'error',
      },
    );
    if (!response.ok) await imageResponse(response);
    const data = Buffer.from(await response.arrayBuffer());
    if (!data.length) throw new GenerationFailure('upstream', 'EMPTY_AUDIO', '语音接口未返回音频');
    const format = String(request.params.response_format ?? 'mp3');
    return {
      status: 'succeeded',
      outputs: [
        { data: data.toString('base64'), mime: format === 'wav' ? 'audio/wav' : 'audio/mpeg' },
      ],
    };
  },
};

export const minimaxT2a: GenerationAdapter = {
  protocol: 'minimax-t2a',
  async submit(ctx, request) {
    const { voice_id, speed, format, sample_rate } = request.params;
    const baseUrl = ctx.connection?.contractVersion
      ? ctx.baseUrl
      : ctx.baseUrl.replace(/\/anthropic$/, '');
    const response = await adapterFetch(
      ctx,
      resolveModelOperation(baseUrl, ctx.connection, 'minimax-t2a', 'submit'),
      {
        method: 'POST',
        headers: {
          ...ctx.headers,
          Authorization: `Bearer ${ctx.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: ctx.model,
          text: request.prompt,
          voice_setting: { voice_id, speed },
          audio_setting: { format, sample_rate },
        }),
        signal: ctx.signal,
        redirect: 'error',
      },
    );
    const json = await imageResponse(response);
    const parsed = AudioResult.safeParse(json);
    if (!parsed.success)
      throw new GenerationFailure('upstream', 'INVALID_RESPONSE', 'MiniMax 语音响应格式无效');
    const audioFormat =
      parsed.data.extra_info?.audio_format ?? String(request.params.format ?? 'mp3');
    const audio = Buffer.from(parsed.data.data.audio, 'hex');
    if (!audio.length)
      throw new GenerationFailure('upstream', 'EMPTY_AUDIO', 'MiniMax 语音接口未返回音频');
    return {
      status: 'succeeded',
      outputs: [
        {
          data: audio.toString('base64'),
          mime: audioFormat === 'wav' ? 'audio/wav' : 'audio/mpeg',
        },
      ],
      usage: parsed.data.extra_info,
    };
  },
};

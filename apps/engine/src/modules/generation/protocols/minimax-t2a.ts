import { z } from 'zod';
import { MINIMAX_T2A } from '@frame-loom/contracts';
import { GenerationFailure, send } from './http.js';
import { endpointCall, invalidResponse, jsonCall, jsonResult } from './common.js';
import { audioResult, pcmWav } from './audio.js';
import { providerFailure } from './video-common.js';
import type { ProtocolAdapter } from './types.js';

const response = z.object({
  data: z.object({ audio: z.string() }).nullish(),
  extra_info: z
    .object({
      audio_format: z.string().optional(),
      audio_sample_rate: z.number().optional(),
      audio_size: z.number().optional(),
    })
    .optional(),
  base_resp: z.object({ status_code: z.number() }),
});
const voice = z.object({ voice_id: z.string(), voice_name: z.string().optional() });
const directory = z.object({
  system_voice: z.array(voice).optional(),
  voice_cloning: z.array(voice).optional(),
  voice_generation: z.array(voice).optional(),
  base_resp: z.object({ status_code: z.number() }),
});
export const minimaxT2a: ProtocolAdapter = {
  descriptor: MINIMAX_T2A,
  buildSubmit(ctx, req, cap) {
    if (cap.kind !== 'tts')
      throw new GenerationFailure('invalid_params', 'INVALID_KIND', '需要 TTS 能力卡');
    if (!(req.params.voice ?? cap.voices.default))
      throw new GenerationFailure('invalid_params', 'VOICE_REQUIRED', '请选择音色');
    return Promise.resolve(
      jsonCall(ctx, MINIMAX_T2A, req, {
        model: ctx.snapshot.upstreamModelId,
        text: ctx.resolvePrompt(req.prompt, req.inputs),
        stream: false,
        voice_setting: {
          voice_id: req.params.voice ?? cap.voices.default,
          speed: req.params.speed ?? cap.speed?.default,
          vol: req.params.volume ?? cap.volume?.default,
          pitch: req.params.pitch ?? cap.pitch?.default,
        },
        audio_setting: {
          sample_rate: req.params.sampleRate ?? cap.defaultSampleRate,
          format: req.params.format ?? cap.defaultFormat,
          channel: 1,
        },
        output_format: 'hex',
      }),
    );
  },
  parseSubmit: (_ctx, res) => {
    const body = jsonResult(res, response);
    if (body.base_resp.status_code) {
      const result = providerFailure(body.base_resp.status_code);
      return Promise.resolve({ ...result, code: 'TTS_FAILED', message: '上游语音生成失败' });
    }
    const hex = body.data?.audio;
    if (!hex || hex.length % 2 || !/^[a-f0-9]+$/i.test(hex)) return invalidResponse();
    const bytes = Buffer.from(hex, 'hex');
    if (body.extra_info?.audio_size !== undefined && body.extra_info.audio_size !== bytes.length)
      return invalidResponse();
    const format = body.extra_info?.audio_format ?? 'mp3';
    const mime = (
      { mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', opus: 'audio/ogg' } as Record<
        string,
        string
      >
    )[format];
    if (format === 'pcm')
      return Promise.resolve(
        audioResult(pcmWav(bytes, body.extra_info?.audio_sample_rate ?? 32000), 'audio/wav'),
      );
    if (!mime) return invalidResponse();
    return Promise.resolve(audioResult(bytes, mime));
  },
  async listVoices(ctx) {
    const call = endpointCall(ctx, MINIMAX_T2A, 'voices');
    const body = jsonResult(
      await send(
        {
          ...call,
          headers: { ...call.headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ voice_type: 'all' }),
        },
        ctx,
      ),
      directory,
    );
    if (body.base_resp.status_code)
      throw new GenerationFailure('upstream', 'VOICE_CATALOG_FAILED', '上游音色目录读取失败');
    return [
      ...(body.system_voice ?? []),
      ...(body.voice_cloning ?? []),
      ...(body.voice_generation ?? []),
    ].map((voice) => ({ id: voice.voice_id, name: voice.voice_name ?? voice.voice_id }));
  },
};

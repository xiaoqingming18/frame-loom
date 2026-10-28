import { z } from 'zod';
import { ELEVENLABS } from '@frame-loom/contracts';
import { GenerationFailure, send } from './http.js';
import { endpointCall, invalidResponse, jsonCall, jsonResult } from './common.js';
import { binaryAudio } from './audio.js';
import type { ProtocolAdapter } from './types.js';

const directory = z.object({
  voices: z.array(z.object({ voice_id: z.string(), name: z.string() })),
  has_more: z.boolean().optional(),
  next_page_token: z.string().nullish(),
});
export const elevenlabs: ProtocolAdapter = {
  descriptor: ELEVENLABS,
  buildSubmit(ctx, req, cap) {
    if (cap.kind !== 'tts')
      throw new GenerationFailure('invalid_params', 'INVALID_KIND', '需要 TTS 能力卡');
    const voice = req.params.voice ?? cap.voices.default;
    if (!voice) throw new GenerationFailure('invalid_params', 'VOICE_REQUIRED', '请选择音色');
    const call = jsonCall(
      ctx,
      ELEVENLABS,
      req,
      {
        text: ctx.resolvePrompt(req.prompt, req.inputs),
        model_id: ctx.snapshot.upstreamModelId,
        voice_settings: { speed: req.params.speed ?? cap.speed?.default },
      },
      'submit',
      { voice_id: voice },
    );
    const url = new URL(call.url);
    url.searchParams.set(
      'output_format',
      req.params.format ?? cap.defaultFormat ?? 'mp3_44100_128',
    );
    const format = url.searchParams.get('output_format')!;
    return Promise.resolve({
      ...call,
      url: url.href,
      responseAudio: {
        format,
        ...(format.startsWith('pcm_') ? { sampleRate: Number(format.slice(4)) } : {}),
      },
    });
  },
  parseSubmit: (_ctx, res) => Promise.resolve(binaryAudio(res)),
  async listVoices(ctx) {
    const voices: { id: string; name: string }[] = [];
    const tokens = new Set<string>();
    let next: string | undefined;
    do {
      const call = endpointCall(ctx, ELEVENLABS, 'voices');
      const url = new URL(call.url);
      url.searchParams.set('page_size', '100');
      if (next) url.searchParams.set('next_page_token', next);
      const body = jsonResult(await send({ ...call, url: url.href }, ctx), directory);
      voices.push(...body.voices.map((voice) => ({ id: voice.voice_id, name: voice.name })));
      if (voices.length > 10000)
        throw new GenerationFailure('upstream', 'VOICE_LIMIT', '音色目录超过 10000 条');
      next = body.has_more ? (body.next_page_token ?? undefined) : undefined;
      if (body.has_more && (!next || tokens.has(next))) return invalidResponse();
      if (next) tokens.add(next);
    } while (next);
    return [...new Map(voices.map((voice) => [voice.id, voice])).values()];
  },
};

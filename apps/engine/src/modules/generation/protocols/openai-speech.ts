import { OPENAI_SPEECH } from '@frame-loom/contracts';
import { GenerationFailure } from './http.js';
import { jsonCall } from './common.js';
import { binaryAudio } from './audio.js';
import type { ProtocolAdapter } from './types.js';

export const openaiSpeech: ProtocolAdapter = {
  descriptor: OPENAI_SPEECH,
  buildSubmit(ctx, req, cap) {
    if (cap.kind !== 'tts')
      throw new GenerationFailure('invalid_params', 'INVALID_KIND', '需要 TTS 能力卡');
    const format = req.params.format ?? cap.defaultFormat ?? 'mp3';
    return Promise.resolve({
      ...jsonCall(ctx, OPENAI_SPEECH, req, {
        model: ctx.snapshot.upstreamModelId,
        input: ctx.resolvePrompt(req.prompt, req.inputs),
        voice: req.params.voice ?? cap.voices.default,
        instructions: req.params.instructions,
        response_format: format,
        speed: req.params.speed ?? cap.speed?.default,
      }),
      responseAudio: { format, sampleRate: 24000 },
    });
  },
  parseSubmit: (_ctx, res) => Promise.resolve(binaryAudio(res)),
};

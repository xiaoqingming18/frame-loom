import type { AdapterResult, HttpResult } from './types.js';
import { invalidResponse } from './common.js';

export function pcmWav(bytes: Uint8Array, sampleRate = 24000): Uint8Array {
  if (!bytes.length || bytes.byteLength % 2) return invalidResponse();
  const header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(bytes.byteLength + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(bytes.byteLength, 40);
  return Buffer.concat([header, bytes]);
}
export function audioResult(bytes: Uint8Array, mime: string): AdapterResult {
  const buffer = Buffer.from(bytes);
  if (buffer.length < 16) return invalidResponse();
  if (
    mime === 'audio/wav' &&
    (buffer.length < 44 ||
      buffer.toString('ascii', 0, 4) !== 'RIFF' ||
      buffer.toString('ascii', 8, 12) !== 'WAVE' ||
      buffer.readUInt32LE(4) + 8 > buffer.length)
  )
    return invalidResponse();
  return {
    status: 'succeeded',
    outputs: [{ kind: 'data', base64: buffer.toString('base64'), mime }],
  };
}
export function binaryAudio(result: HttpResult, sampleRate = 24000): AdapterResult {
  let type = result.headers.get('content-type')?.split(';')[0]?.toLowerCase();
  const format = result.responseAudio?.format;
  if (type === 'application/octet-stream' && format)
    type = format.startsWith('pcm')
      ? 'audio/pcm'
      : format.startsWith('mp3')
        ? 'audio/mpeg'
        : (
            { opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac' } as Record<
              string,
              string
            >
          )[format];
  if (type === 'audio/pcm' || type === 'audio/l16')
    return audioResult(
      pcmWav(result.bytes, result.responseAudio?.sampleRate ?? sampleRate),
      'audio/wav',
    );
  const mime = type === 'audio/mp3' ? 'audio/mpeg' : type === 'audio/x-wav' ? 'audio/wav' : type;
  if (!mime || !['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/aac'].includes(mime))
    return invalidResponse();
  return audioResult(result.bytes, mime);
}

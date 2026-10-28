import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffprobe from '@ffprobe-installer/ffprobe';
import { z } from 'zod';
import { GenerationFailure } from './protocols/http.js';

const Probe = z.object({
  format: z.object({ format_name: z.string(), duration: z.string() }),
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
      avg_frame_rate: z.string().optional(),
      sample_rate: z.string().optional(),
      channels: z.number().int().positive().optional(),
    }),
  ),
});
export async function probeMedia(path: string) {
  try {
    // 只探测本地文件，禁止容器引用网络协议；限制探测时间和输出量。
    const { stdout } = await promisify(execFile)(
      ffprobe.path,
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file',
        '-show_format',
        '-show_streams',
        '-of',
        'json',
        path,
      ],
      { timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true },
    );
    const info = Probe.parse(JSON.parse(stdout));
    const video = info.streams.find((stream) => stream.codec_type === 'video');
    const audio = info.streams.find((stream) => stream.codec_type === 'audio');
    const durationMs = Math.round(Number(info.format.duration) * 1000);
    const [numerator, denominator] = (video?.avg_frame_rate ?? '0/1').split('/').map(Number);
    const fps = video ? numerator / denominator : null;
    const container = info.format.format_name.split(',');
    const format =
      video && (container.includes('mp4') || container.includes('mov'))
        ? { mime: 'video/mp4', ext: 'mp4' }
        : !video && container.includes('mp3')
          ? { mime: 'audio/mpeg', ext: 'mp3' }
          : !video && container.includes('wav')
            ? { mime: 'audio/wav', ext: 'wav' }
            : !video && container.includes('ogg')
              ? { mime: 'audio/ogg', ext: 'ogg' }
              : !video && container.includes('flac')
                ? { mime: 'audio/flac', ext: 'flac' }
                : !video && container.includes('aac')
                  ? { mime: 'audio/aac', ext: 'aac' }
                  : null;
    if (
      !format ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0 ||
      (video && (!video.width || !video.height || !fps || !Number.isFinite(fps)))
    )
      throw new Error('不支持的媒体格式');
    return {
      ...format,
      width: video?.width ?? null,
      height: video?.height ?? null,
      durationMs,
      fps,
      codec: video?.codec_name ?? audio?.codec_name ?? null,
      audioCodec: audio?.codec_name ?? null,
      sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
      channels: audio?.channels ?? null,
    };
  } catch {
    throw new GenerationFailure(
      'invalid_params',
      'INVALID_MEDIA',
      '无法探测媒体，请使用有效 MP4/MOV、MP3、WAV、OGG、FLAC 或 AAC 文件',
    );
  }
}

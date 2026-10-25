import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';

const extensions = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

export function mediaHash(url: string): string | undefined {
  // 检查原始字符串，避免 URL 规范化吞掉路径穿越片段。
  return /^frame-media:\/\/([a-f0-9]{64})\/?$/.exec(url)?.[1];
}

export function mediaRange(
  header: string | null,
  size: number,
): { start: number; end: number } | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) throw new RangeError('范围无效');
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start > end ||
    start >= size
  )
    throw new RangeError('范围无效');
  return { start, end };
}

export async function serveMedia(root: string, request: Request): Promise<Response> {
  const hash = mediaHash(request.url);
  if (!hash || !['GET', 'HEAD'].includes(request.method))
    return new Response(null, { status: 403 });
  for (const [ext, mime] of Object.entries(extensions)) {
    const path = join(root, `${hash}.${ext}`);
    let size: number;
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      size = stat.size;
    } catch {
      continue;
    }
    let range: ReturnType<typeof mediaRange>;
    try {
      range = mediaRange(request.headers.get('range'), size);
    } catch {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    const headers: Record<string, string> = {
      'Content-Type': mime,
      'Content-Length': String(range ? range.end - range.start + 1 : size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    };
    if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    const body =
      request.method === 'HEAD'
        ? null
        : (Readable.toWeb(
            createReadStream(path, { ...range, signal: request.signal }),
          ) as ReadableStream<Uint8Array>);
    return new Response(body, { status: range ? 206 : 200, headers });
  }
  return new Response(null, { status: 404 });
}

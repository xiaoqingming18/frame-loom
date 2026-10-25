import type { CanvasMediaVersion, MediaFile } from '@frame-loom/contracts';
import type { CanvasHost } from '../host';

export const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'];
// 与 engine 的 ffprobe 白名单一致：视频只接受 MP4／MOV 容器。
export const VIDEO_MIME = ['video/mp4', 'video/quicktime'];

export function mediaKind(file: Blob): 'image' | 'video' | null {
  if (IMAGE_MIME.includes(file.type)) return 'image';
  if (VIDEO_MIME.includes(file.type)) return 'video';
  return null;
}

export function toVersion(media: MediaFile, posterSha256?: string): CanvasMediaVersion {
  return {
    sha256: media.sha256,
    mime: media.mime,
    width: media.width,
    height: media.height,
    durationMs: media.durationMs,
    ...(posterSha256 ? { posterSha256 } : {}),
    createdAt: new Date().toISOString(),
  };
}

/** 在浏览器中抽取视频首帧作为封面；失败时返回 null，节点仍可正常使用。 */
export async function extractPoster(url: string, signal?: AbortSignal): Promise<Blob | null> {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 15_000);
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      video.addEventListener('loadeddata', () => {
        // 首帧常是黑场，略微向后取帧。
        video.currentTime = Math.min(0.1, video.duration || 0);
      });
      video.addEventListener('seeked', () => {
        clearTimeout(timer);
        resolve();
      });
      video.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('decode'));
      });
    });
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight, 1));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

/** 上传媒体文件并生成节点数据所需的版本记录。 */
export async function importMedia(
  host: CanvasHost,
  file: Blob,
  signal?: AbortSignal,
): Promise<{ kind: 'image' | 'video'; version: CanvasMediaVersion }> {
  const kind = mediaKind(file);
  if (!kind) throw new Error('只支持 PNG、JPEG、WebP 图片和 MP4、MOV 视频');
  const media = await host.media.upload(file, signal);
  if (!media.mime.startsWith(`${kind}/`)) throw new Error('文件实际类型与扩展名不符');
  if (kind === 'image') return { kind, version: toVersion(media) };
  const poster = await extractPoster(host.media.url(media.sha256), signal);
  const posterMedia = poster ? await host.media.upload(poster, signal).catch(() => null) : null;
  return { kind, version: toVersion(media, posterMedia?.sha256) };
}

import { CanvasMediaData, type CanvasNode } from '@frame-loom/contracts';
import type { CanvasHost } from '../host';

/** 包含所有版本及视频封面；找不到的媒体仍保留引用，供缺失占位和以后恢复。 */
export async function adoptMedia(host: CanvasHost, nodes: CanvasNode[]) {
  if (!host.media.adopt) return [];
  const hashes = new Set<string>();
  for (const node of nodes) {
    if (node.type !== 'image' && node.type !== 'video') continue;
    const parsed = CanvasMediaData.safeParse(node.data);
    if (!parsed.success) continue;
    for (const version of parsed.data.versions) {
      hashes.add(version.sha256);
      if (version.posterSha256) hashes.add(version.posterSha256);
    }
    for (const reference of parsed.data.mediaReferences ?? []) hashes.add(reference.media.sha256);
  }
  if (!hashes.size) return [];
  const result = await host.media.adopt([...hashes]);
  return result.missing;
}

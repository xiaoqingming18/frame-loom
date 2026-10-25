import type { CanvasDocument, CanvasEdge, CanvasNode } from '@frame-loom/contracts';
import { emptyMedia } from './nodes/media';

export const sha = (char: string) => char.repeat(64);

export function media(
  id: string,
  type: 'image' | 'video' = 'image',
  extra: Partial<CanvasNode> = {},
): CanvasNode {
  return {
    id,
    type,
    typeVersion: 1,
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
    title: id,
    data: emptyMedia(type === 'video' ? 'text' : undefined),
    ...extra,
  };
}

export function group(id: string, extra: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id,
    type: 'group',
    typeVersion: 1,
    position: { x: 0, y: 0 },
    size: { width: 400, height: 300 },
    data: { color: 'gray' },
    ...extra,
  };
}

export function edge(
  id: string,
  source: string,
  target: string,
  targetHandle = 'reference',
): CanvasEdge {
  return { id, source, target, sourceHandle: 'out', targetHandle };
}

export function doc(nodes: CanvasNode[], edges: CanvasEdge[] = []): CanvasDocument {
  return { schemaVersion: 1, nodes, edges };
}

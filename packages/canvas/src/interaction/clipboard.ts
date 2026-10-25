import { z } from 'zod';
import { CanvasEdge, CanvasNode, type CanvasDocument } from '@frame-loom/contracts';
import { absolutePosition, boundsOf, newId, type Point } from '../commands/commands';

export const CLIPBOARD_MIME = 'application/x-frame-loom-canvas';
export const CLIPBOARD_PREFIX = 'frame-loom-canvas/v1:';
export const CLIPBOARD_MAX_BYTES = 4 * 1024 * 1024;

const Payload = z.strictObject({
  nodes: z.array(CanvasNode).min(1).max(500),
  edges: z.array(CanvasEdge).max(1000),
});
export type ClipboardPayload = z.infer<typeof Payload>;

/** 复制选中节点及其内部连线；选中分组时连带子节点，坐标统一换成绝对坐标。 */
export function copySelection(
  document: CanvasDocument,
  ids: ReadonlySet<string>,
): ClipboardPayload | null {
  const picked = new Set(
    document.nodes
      .filter((node) => ids.has(node.id) || (node.parentId && ids.has(node.parentId)))
      .map((node) => node.id),
  );
  if (!picked.size) return null;
  const nodes = document.nodes
    .filter((node) => picked.has(node.id))
    .map((node) => {
      if (node.parentId && picked.has(node.parentId)) return node;
      const copy = { ...node, position: absolutePosition(document, node) };
      delete copy.parentId;
      return copy;
    });
  const edges = document.edges.filter((edge) => picked.has(edge.source) && picked.has(edge.target));
  return { nodes, edges };
}

export function serialize(payload: ClipboardPayload): string {
  return CLIPBOARD_PREFIX + JSON.stringify(payload);
}

/** 剪贴板内容不可信：限制大小并严格校验结构。 */
export function deserialize(text: string): ClipboardPayload | null {
  if (!text.startsWith(CLIPBOARD_PREFIX) || text.length > CLIPBOARD_MAX_BYTES) return null;
  try {
    const parsed = Payload.safeParse(JSON.parse(text.slice(CLIPBOARD_PREFIX.length)));
    if (!parsed.success) return null;
    const ids = new Set(parsed.data.nodes.map((node) => node.id));
    if (ids.size !== parsed.data.nodes.length) return null;
    return {
      nodes: parsed.data.nodes,
      edges: parsed.data.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
    };
  } catch {
    return null;
  }
}

/** 重新生成 id 并把包围盒左上角放到目标点；外部连线已在复制时丢弃。 */
export function instantiate(
  payload: ClipboardPayload,
  at: Point,
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const ids = new Map(payload.nodes.map((node) => [node.id, newId()]));
  const roots = payload.nodes.filter((node) => !node.parentId || !ids.has(node.parentId));
  const bounds = boundsOf(roots.map((node) => ({ ...node.position, ...node.size })))!;
  const edgeIds = new Map(payload.edges.map((edge) => [edge.id, newId()]));
  const nodes = payload.nodes.map((node) => {
    const isRoot = !node.parentId || !ids.has(node.parentId);
    const copy: CanvasNode = {
      ...node,
      id: ids.get(node.id)!,
      position: isRoot
        ? {
            x: Math.round(at.x + node.position.x - bounds.x),
            y: Math.round(at.y + node.position.y - bounds.y),
          }
        : node.position,
      data: remapInputOrder(node.data, edgeIds),
    };
    if (isRoot) delete copy.parentId;
    else copy.parentId = ids.get(node.parentId!);
    delete copy.locked;
    return copy;
  });
  const edges = payload.edges.map((edge) => ({
    ...edge,
    id: edgeIds.get(edge.id)!,
    source: ids.get(edge.source)!,
    target: ids.get(edge.target)!,
  }));
  return { nodes, edges };
}

function remapInputOrder(data: unknown, edgeIds: Map<string, string>): unknown {
  const value = data as { inputOrder?: unknown } | null;
  if (!value || !Array.isArray(value.inputOrder)) return data;
  return {
    ...value,
    inputOrder: value.inputOrder
      .filter((id): id is string => typeof id === 'string' && edgeIds.has(id))
      .map((id) => edgeIds.get(id)!),
  };
}

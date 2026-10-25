import type { Edge, Node } from '@xyflow/react';
import type { CanvasDocument, CanvasEdgeDisplay, CanvasNode } from '@frame-loom/contracts';

export type FlowNode = Node<{
  node: CanvasNode;
  upload?: { error: string | null; retry(): void; cancel(): void };
}>;

/** 把文档节点转换为 xyflow 节点；同一文档节点复用缓存对象，避免整图重渲染。 */
export function createNodeMapper() {
  let cache = new Map<CanvasNode, { selected: boolean; flow: FlowNode }>();
  return (document: CanvasDocument, selected: ReadonlySet<string>, hand: boolean): FlowNode[] => {
    const next = new Map<CanvasNode, { selected: boolean; flow: FlowNode }>();
    const nodes = document.nodes.map((node) => {
      const isSelected = selected.has(node.id);
      const cached = cache.get(node);
      const flow =
        cached && cached.selected === isSelected && cached.flow.draggable === !(node.locked || hand)
          ? cached.flow
          : {
              id: node.id,
              type: node.type,
              position: node.position,
              width: node.size.width,
              height: node.size.height,
              ...(node.parentId ? { parentId: node.parentId } : {}),
              selected: isSelected,
              draggable: !(node.locked || hand),
              selectable: !hand,
              connectable: !node.locked,
              // 分组始终位于子节点和普通节点之下。
              zIndex: node.type === 'group' ? -1 : 0,
              className: node.type === 'group' ? 'canvas-flow-group' : 'canvas-flow-node',
              data: { node },
            };
      next.set(node, { selected: isSelected, flow });
      return flow;
    });
    cache = next;
    return nodes;
  };
}

export function toFlowEdges(
  document: CanvasDocument,
  selected: ReadonlySet<string>,
  display: CanvasEdgeDisplay,
  focus: ReadonlySet<string>,
  kinds: Map<string, string>,
): Edge[] {
  return document.edges.map((edge) => {
    const related = focus.has(edge.source) || focus.has(edge.target);
    // focus 由调用方决定：related 为选中与悬停节点，hidden 只含悬停节点，用于临时显示。
    const hidden = display !== 'all' && !related && !selected.has(edge.id);
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      selected: selected.has(edge.id),
      hidden,
      className: `canvas-edge canvas-edge-${kinds.get(edge.source) ?? 'image'}`,
      reconnectable: true,
    };
  });
}

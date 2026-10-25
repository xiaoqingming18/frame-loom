import type {
  CanvasDocument,
  CanvasEdge,
  CanvasGroupColor,
  CanvasNode,
} from '@frame-loom/contracts';
import { CANVAS_LIMITS } from '@frame-loom/contracts';
import { checkConnection, invalidEdges, type ConnectionAttempt } from '../registry/connections';
import type { NodeRegistry } from '../registry/registry';

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

export const newId = () => crypto.randomUUID().replaceAll('-', '').slice(0, 20);

export class CanvasCommandError extends Error {}

export function absolutePosition(document: CanvasDocument, node: CanvasNode): Point {
  const parent = node.parentId && document.nodes.find((item) => item.id === node.parentId);
  return parent
    ? { x: parent.position.x + node.position.x, y: parent.position.y + node.position.y }
    : node.position;
}

export function absoluteRect(document: CanvasDocument, node: CanvasNode): Rect {
  return { ...absolutePosition(document, node), ...node.size };
}

export function boundsOf(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** 保持 xyflow 要求的父节点在前顺序。 */
export function orderParents(nodes: CanvasNode[]): CanvasNode[] {
  const groups = nodes.filter((node) => !node.parentId);
  const children = nodes.filter((node) => node.parentId);
  const result: CanvasNode[] = [];
  for (const node of groups) {
    result.push(node);
    result.push(...children.filter((child) => child.parentId === node.id));
  }
  return result;
}

function ensureLimits(document: CanvasDocument): CanvasDocument {
  if (document.nodes.length > CANVAS_LIMITS.nodes)
    throw new CanvasCommandError(`画布最多 ${CANVAS_LIMITS.nodes} 个节点`);
  if (document.edges.length > CANVAS_LIMITS.edges)
    throw new CanvasCommandError(`画布最多 ${CANVAS_LIMITS.edges} 条连线`);
  return document;
}

export function createNode(
  registry: NodeRegistry,
  type: string,
  center: Point,
  data?: unknown,
  size?: { width: number; height: number },
): CanvasNode {
  const definition = registry.get(type);
  if (!definition) throw new CanvasCommandError(`未知节点类型：${type}`);
  const nodeSize = size ?? definition.defaultSize;
  return {
    id: newId(),
    type,
    typeVersion: definition.version,
    position: {
      x: Math.round(center.x - nodeSize.width / 2),
      y: Math.round(center.y - nodeSize.height / 2),
    },
    size: nodeSize,
    title: definition.label,
    data: data ?? definition.createData(),
  };
}

export function addNodes(document: CanvasDocument, nodes: CanvasNode[], edges: CanvasEdge[] = []) {
  return ensureLimits({
    ...document,
    nodes: orderParents([...document.nodes, ...nodes]),
    edges: [...document.edges, ...edges],
  });
}

export function updateNode(
  document: CanvasDocument,
  id: string,
  patch: Partial<Omit<CanvasNode, 'id' | 'type'>>,
): CanvasDocument {
  let changed = false;
  const nodes = document.nodes.map((node) => {
    if (node.id !== id) return node;
    changed = true;
    return { ...node, ...patch };
  });
  return changed ? { ...document, nodes } : document;
}

export function updateData<Data>(
  document: CanvasDocument,
  id: string,
  change: (data: Data) => Data,
): CanvasDocument {
  const node = document.nodes.find((item) => item.id === id);
  return node ? updateNode(document, id, { data: change(node.data as Data) }) : document;
}

export function moveNodes(document: CanvasDocument, positions: Map<string, Point>): CanvasDocument {
  if (!positions.size) return document;
  let changed = false;
  const nodes = document.nodes.map((node) => {
    const position = positions.get(node.id);
    if (!position || (position.x === node.position.x && position.y === node.position.y))
      return node;
    changed = true;
    return { ...node, position };
  });
  return changed ? { ...document, nodes } : document;
}

export function nudge(document: CanvasDocument, ids: ReadonlySet<string>, delta: Point) {
  // 选中分组时子节点随组移动，不重复位移。
  const positions = new Map<string, Point>();
  for (const node of document.nodes)
    if (ids.has(node.id) && !node.locked && !(node.parentId && ids.has(node.parentId)))
      positions.set(node.id, { x: node.position.x + delta.x, y: node.position.y + delta.y });
  return moveNodes(document, positions);
}

export function deleteElements(
  document: CanvasDocument,
  nodeIds: ReadonlySet<string>,
  edgeIds: ReadonlySet<string> = new Set(),
): CanvasDocument {
  const removed = new Set(
    document.nodes.filter((node) => nodeIds.has(node.id) && !node.locked).map((node) => node.id),
  );
  // 删除分组时保留子节点，换算为绝对坐标后脱离分组。
  const nodes = document.nodes
    .filter((node) => !removed.has(node.id))
    .map((node) =>
      node.parentId && removed.has(node.parentId)
        ? { ...node, parentId: undefined, position: absolutePosition(document, node) }
        : node,
    )
    .map(stripUndefinedParent);
  const edges = document.edges.filter(
    (edge) => !edgeIds.has(edge.id) && !removed.has(edge.source) && !removed.has(edge.target),
  );
  if (nodes.length === document.nodes.length && edges.length === document.edges.length)
    return document;
  return { ...document, nodes: orderParents(dropFromInputOrder(nodes, edges)), edges };
}

function stripUndefinedParent(node: CanvasNode): CanvasNode {
  if (node.parentId !== undefined || !('parentId' in node)) return node;
  const copy = { ...node };
  delete copy.parentId;
  return copy;
}

/** 删除连线后，清理目标节点 `inputOrder` 里已不存在的边 id。 */
function dropFromInputOrder(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasNode[] {
  const alive = new Set(edges.map((edge) => edge.id));
  return nodes.map((node) => {
    const data = node.data as { inputOrder?: string[] } | null;
    return Array.isArray(data?.inputOrder) && data.inputOrder.some((id) => !alive.has(id))
      ? { ...node, data: { ...data, inputOrder: data.inputOrder.filter((id) => alive.has(id)) } }
      : node;
  });
}

export function connect(
  registry: NodeRegistry,
  document: CanvasDocument,
  attempt: ConnectionAttempt,
): CanvasDocument {
  const verdict = checkConnection(registry, document, attempt);
  if (!verdict.ok) throw new CanvasCommandError(verdict.reason);
  const edge: CanvasEdge = {
    id: newId(),
    source: attempt.source,
    target: attempt.target,
    sourceHandle: attempt.sourceHandle!,
    targetHandle: attempt.targetHandle!,
  };
  const next = ensureLimits({ ...document, edges: [...document.edges, edge] });
  return updateData<{ inputOrder?: string[] }>(next, edge.target, (data) =>
    Array.isArray(data?.inputOrder) ? { ...data, inputOrder: [...data.inputOrder, edge.id] } : data,
  );
}

export function reconnect(
  registry: NodeRegistry,
  document: CanvasDocument,
  edgeId: string,
  attempt: ConnectionAttempt,
): CanvasDocument {
  const verdict = checkConnection(registry, document, attempt, edgeId);
  if (!verdict.ok) throw new CanvasCommandError(verdict.reason);
  const old = document.edges.find((edge) => edge.id === edgeId);
  if (!old) return document;
  const withoutOld = deleteElements(document, new Set(), new Set([edgeId]));
  return connect(registry, withoutOld, attempt);
}

/** 修改节点数据（例如切换视频方式），并删除因此失效的连线；返回删除条数。 */
export function changeDataDroppingEdges<Data>(
  registry: NodeRegistry,
  document: CanvasDocument,
  id: string,
  change: (data: Data) => Data,
): { document: CanvasDocument; dropped: number } {
  const next = updateData(document, id, change);
  const dropped = invalidEdges(registry, next, id);
  return {
    document: dropped.length
      ? deleteElements(next, new Set(), new Set(dropped.map((edge) => edge.id)))
      : next,
    dropped: dropped.length,
  };
}

export const GROUP_PADDING = { x: 24, top: 48, bottom: 24 };

export function groupNodes(
  registry: NodeRegistry,
  document: CanvasDocument,
  ids: ReadonlySet<string>,
  color: CanvasGroupColor = 'gray',
): { document: CanvasDocument; groupId: string } {
  // 选中分组时连同其子节点一起并入新分组，首期只支持一层。
  const members = document.nodes.filter(
    (node) => ids.has(node.id) && node.type !== 'group' && !node.locked,
  );
  const dissolved = document.nodes.filter((node) => ids.has(node.id) && node.type === 'group');
  const absorbed = document.nodes.filter(
    (node) => node.parentId && dissolved.some((group) => group.id === node.parentId),
  );
  const all = [...new Map([...members, ...absorbed].map((node) => [node.id, node])).values()];
  if (all.length < 1) throw new CanvasCommandError('请选择要分组的节点');
  const bounds = boundsOf(all.map((node) => absoluteRect(document, node)))!;
  const group = createNode(registry, 'group', { x: 0, y: 0 }, { color });
  group.position = { x: bounds.x - GROUP_PADDING.x, y: bounds.y - GROUP_PADDING.top };
  group.size = {
    width: bounds.width + GROUP_PADDING.x * 2,
    height: bounds.height + GROUP_PADDING.top + GROUP_PADDING.bottom,
  };
  const memberIds = new Set(all.map((node) => node.id));
  const dissolvedIds = new Set(dissolved.map((node) => node.id));
  const nodes = document.nodes
    .filter((node) => !dissolvedIds.has(node.id))
    .map((node) => {
      if (memberIds.has(node.id)) {
        const absolute = absolutePosition(document, node);
        return {
          ...node,
          parentId: group.id,
          position: { x: absolute.x - group.position.x, y: absolute.y - group.position.y },
        };
      }
      if (node.parentId && dissolvedIds.has(node.parentId))
        return stripUndefinedParent({
          ...node,
          parentId: undefined,
          position: absolutePosition(document, node),
        });
      return node;
    });
  return {
    document: ensureLimits({ ...document, nodes: orderParents([group, ...nodes]) }),
    groupId: group.id,
  };
}

export function ungroup(document: CanvasDocument, ids: ReadonlySet<string>): CanvasDocument {
  const groups = new Set(
    document.nodes
      .filter((node) => node.type === 'group' && (ids.has(node.id) || false))
      .map((node) => node.id),
  );
  // 选中子节点时解散其所在分组。
  for (const node of document.nodes)
    if (ids.has(node.id) && node.parentId) groups.add(node.parentId);
  if (!groups.size) return document;
  return deleteElements(
    document,
    new Set([...groups].filter((id) => !document.nodes.find((node) => node.id === id)?.locked)),
  );
}

/** 拖动结束时判断节点是否落入或离开分组。 */
export function reparentAfterDrag(
  document: CanvasDocument,
  ids: ReadonlySet<string>,
): CanvasDocument {
  const groups = document.nodes.filter((node) => node.type === 'group');
  let changed = false;
  const nodes = document.nodes.map((node) => {
    if (!ids.has(node.id) || node.type === 'group') return node;
    const rect = absoluteRect(document, node);
    const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const target = [...groups]
      .reverse()
      .find(
        (group) =>
          center.x >= group.position.x &&
          center.x <= group.position.x + group.size.width &&
          center.y >= group.position.y &&
          center.y <= group.position.y + group.size.height,
      );
    if ((target?.id ?? undefined) === node.parentId) return node;
    changed = true;
    return stripUndefinedParent({
      ...node,
      parentId: target?.id,
      position: target
        ? { x: rect.x - target.position.x, y: rect.y - target.position.y }
        : { x: rect.x, y: rect.y },
    });
  });
  return changed ? { ...document, nodes: orderParents(nodes) } : document;
}

/** 让分组框贴合子节点。 */
export function fitGroup(document: CanvasDocument, groupId: string): CanvasDocument {
  const group = document.nodes.find((node) => node.id === groupId);
  const children = document.nodes.filter((node) => node.parentId === groupId);
  if (!group || !children.length) return document;
  const bounds = boundsOf(children.map((node) => absoluteRect(document, node)))!;
  const position = { x: bounds.x - GROUP_PADDING.x, y: bounds.y - GROUP_PADDING.top };
  const delta = { x: position.x - group.position.x, y: position.y - group.position.y };
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (node.id === groupId)
        return {
          ...node,
          position,
          size: {
            width: bounds.width + GROUP_PADDING.x * 2,
            height: bounds.height + GROUP_PADDING.top + GROUP_PADDING.bottom,
          },
        };
      if (node.parentId === groupId)
        return {
          ...node,
          position: { x: node.position.x - delta.x, y: node.position.y - delta.y },
        };
      return node;
    }),
  };
}

export function reorder(document: CanvasDocument, ids: ReadonlySet<string>, to: 'front' | 'back') {
  // 只在同一父级内调整顺序；渲染层按数组顺序叠放。
  const picked = document.nodes.filter((node) => ids.has(node.id));
  if (!picked.length) return document;
  const rest = document.nodes.filter((node) => !ids.has(node.id));
  return {
    ...document,
    nodes: orderParents(to === 'front' ? [...rest, ...picked] : [...picked, ...rest]),
  };
}

export function setLocked(document: CanvasDocument, ids: ReadonlySet<string>, locked: boolean) {
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (!ids.has(node.id)) return node;
      if (locked) return { ...node, locked: true };
      const copy = { ...node };
      delete copy.locked;
      return copy;
    }),
  };
}

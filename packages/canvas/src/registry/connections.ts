import type { CanvasDocument, CanvasEdge, CanvasNode } from '@frame-loom/contracts';
import type { NodeRegistry, PortDataType } from './registry';

export interface ConnectionAttempt {
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
}

export type ConnectionVerdict = { ok: true } | { ok: false; reason: string };

const kindLabels: Record<PortDataType, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  text: '文本',
};

/** 连线时阻止的两层校验：端口数据类型与图结构；模型能力在生成前另行检查。 */
export function checkConnection(
  registry: NodeRegistry,
  document: Pick<CanvasDocument, 'nodes' | 'edges'>,
  attempt: ConnectionAttempt,
  ignoreEdgeId?: string,
): ConnectionVerdict {
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  const source = byId.get(attempt.source);
  const target = byId.get(attempt.target);
  if (!source || !target) return { ok: false, reason: '节点不存在' };
  if (source.id === target.id) return { ok: false, reason: '节点不能连接自己' };
  const sourceDefinition = registry.get(source.type);
  const targetDefinition = registry.get(target.type);
  if (
    !sourceDefinition ||
    !targetDefinition ||
    sourceDefinition.connectable === false ||
    targetDefinition.connectable === false
  )
    return { ok: false, reason: '该节点不支持连线' };
  const output = registry.outputs(source).find((port) => port.id === attempt.sourceHandle);
  const input = registry.inputs(target).find((port) => port.id === attempt.targetHandle);
  if (!output || !input) return { ok: false, reason: '端口不存在' };
  if (!input.accepts.includes(output.dataType))
    return {
      ok: false,
      reason: `「${input.label}」不接受${kindLabels[output.dataType]}`,
    };
  const edges = document.edges.filter((edge) => edge.id !== ignoreEdgeId);
  if (
    edges.some(
      (edge) =>
        edge.source === source.id &&
        edge.target === target.id &&
        edge.sourceHandle === output.id &&
        edge.targetHandle === input.id,
    )
  )
    return { ok: false, reason: '这两个端口已经连接' };
  if (
    edges.filter((edge) => edge.target === target.id && edge.targetHandle === input.id).length >=
    input.max
  )
    return { ok: false, reason: `「${input.label}」最多 ${input.max} 条连线` };
  if (reaches(edges, target.id, source.id)) return { ok: false, reason: '连线会形成循环依赖' };
  return { ok: true };
}

function reaches(edges: CanvasEdge[], from: string, to: string): boolean {
  const next = new Map<string, string[]>();
  for (const edge of edges) next.set(edge.source, [...(next.get(edge.source) ?? []), edge.target]);
  const stack = [from];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(next.get(id) ?? []));
  }
  return false;
}

/** 节点端口变化后（如切换视频方式）不再成立的连线。 */
export function invalidEdges(
  registry: NodeRegistry,
  document: Pick<CanvasDocument, 'nodes' | 'edges'>,
  nodeId: string,
): CanvasEdge[] {
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  return document.edges.filter((edge) => {
    if (edge.source !== nodeId && edge.target !== nodeId) return false;
    const source = byId.get(edge.source) as CanvasNode;
    const target = byId.get(edge.target) as CanvasNode;
    const output = registry.outputs(source).find((port) => port.id === edge.sourceHandle);
    const input = registry.inputs(target).find((port) => port.id === edge.targetHandle);
    return !output || !input || !input.accepts.includes(output.dataType);
  });
}

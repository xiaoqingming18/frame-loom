import { CANVAS_LIMITS, CanvasDocument, type ProjectTag } from '@frame-loom/contracts';
import { CanvasCommandError } from '../commands/commands';
import { checkConnection } from '../registry/connections';
import type { NodeRegistry } from '../registry/registry';

import { SourceTags, resolveTags, usedTags } from './tags';

export function downloadCanvasDocument(
  document: CanvasDocument,
  tags: ProjectTag[] | null = null,
): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify({ ...document, tags: usedTags(document.nodes, tags) })], {
      type: 'application/json',
    }),
  );
  const link = window.document.createElement('a');
  link.href = url;
  link.download = 'frame-loom-canvas.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 文件来自信任边界：先限制体积，再校验结构和当前版本能识别的连线。 */
export function parseDocument(
  text: string,
  registry: NodeRegistry,
  projectTags: ProjectTag[] = [],
): CanvasDocument {
  if (new TextEncoder().encode(text).byteLength > CANVAS_LIMITS.bytes)
    throw new CanvasCommandError('画布 JSON 不能超过 8 MiB');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CanvasCommandError('画布 JSON 格式无效');
  }
  let sourceTags: ReturnType<typeof SourceTags.parse> | undefined;
  if (value && typeof value === 'object' && !Array.isArray(value) && 'tags' in value) {
    const { tags, ...rest } = value;
    const parsed = SourceTags.safeParse(tags);
    if (!parsed.success) throw new CanvasCommandError('画布标签结构无效');
    sourceTags = parsed.data;
    value = rest;
  }
  const result = CanvasDocument.safeParse(value);
  if (!result.success) throw new CanvasCommandError('画布文档结构或节点数据无效');
  const document = {
    ...result.data,
    nodes: resolveTags(
      result.data.nodes.map((node) => registry.migrate(node)),
      sourceTags,
      projectTags,
    ),
  };
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const accepted: CanvasDocument['edges'] = [];
  for (const edge of document.edges) {
    // 未识别的类型或版本原样保留，当前版本不猜测其端口契约。
    if (registry.supports(nodes.get(edge.source)!) && registry.supports(nodes.get(edge.target)!)) {
      const verdict = checkConnection(
        registry,
        { nodes: document.nodes, edges: accepted },
        edge,
        undefined,
        true,
      );
      if (!verdict.ok) throw new CanvasCommandError(`画布连线无效：${verdict.reason}`);
    }
    accepted.push(edge);
  }
  return document;
}

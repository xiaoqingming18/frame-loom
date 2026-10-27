import { z } from 'zod';
import { TagId, TagName, type CanvasNode, type ProjectTag } from '@frame-loom/contracts';

export const SourceTags = z.array(z.strictObject({ id: TagId, name: TagName })).max(50);
export type SourceTag = z.infer<typeof SourceTags>[number];

export function usedTags(nodes: CanvasNode[], tags: ProjectTag[] | null): SourceTag[] {
  const ids = new Set(nodes.map((node) => node.tagId));
  return (tags ?? []).filter((tag) => ids.has(tag.id)).map(({ id, name }) => ({ id, name }));
}

/** 优先保留本项目 id，跨项目只按名称匹配，避免带入悬空引用。 */
export function resolveTags(
  nodes: CanvasNode[],
  sourceTags: SourceTag[] | undefined,
  projectTags: ProjectTag[],
): CanvasNode[] {
  const ids = new Set(projectTags.map((tag) => tag.id));
  const names = new Map(projectTags.map((tag) => [tag.name.toLowerCase(), tag.id]));
  const sourceNames = new Map((sourceTags ?? []).map((tag) => [tag.id, tag.name.toLowerCase()]));
  return nodes.map((node) => {
    if (!node.tagId || ids.has(node.tagId)) return node;
    const name = sourceNames.get(node.tagId);
    const tagId = name === undefined ? undefined : names.get(name);
    const next = { ...node };
    if (tagId) next.tagId = tagId;
    else delete next.tagId;
    return next;
  });
}

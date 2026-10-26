import type { CanvasDocument, GenerationInput } from '@frame-loom/contracts';
import type { CanvasGenerationConfig } from '../host';

export function generationModel(
  config: CanvasGenerationConfig | null,
  kind: 'image' | 'video',
  modelId?: string,
) {
  const models = config?.models.filter((model) => model.kind === kind) ?? [];
  return modelId ? models.find((model) => model.id === modelId) : models[0];
}

export function generationInputs(document: CanvasDocument, nodeId: string): GenerationInput[] {
  return generationReferences(document, nodeId).map((reference) => reference.input);
}

/** 编号、缩略图和请求输入共用同一次排序及有效产物筛选。 */
export function generationReferences(document: CanvasDocument, nodeId: string) {
  const target = document.nodes.find((node) => node.id === nodeId);
  const inputOrder = (target?.data as { inputOrder?: string[] } | undefined)?.inputOrder ?? [];
  return document.edges
    .filter((edge) => edge.target === nodeId)
    .sort((a, b) => {
      const rank = (id: string) => {
        const index = inputOrder.indexOf(id);
        return index < 0 ? inputOrder.length : index;
      };
      return rank(a.id) - rank(b.id);
    })
    .flatMap((edge) => {
      const source = document.nodes.find((node) => node.id === edge.source);
      if (!source || (source.type !== 'image' && source.type !== 'video')) return [];
      const data = source.data as { versions?: { sha256: string }[]; activeVersion?: number };
      const media = data.versions?.[data.activeVersion ?? -1];
      return media
        ? [
            {
              edge,
              node: source,
              input: {
                kind: source.type === 'video' ? ('video' as const) : ('image' as const),
                role:
                  edge.targetHandle === 'first_frame'
                    ? ('first_frame' as const)
                    : edge.targetHandle === 'last_frame'
                      ? ('last_frame' as const)
                      : ('reference' as const),
                sha256: media.sha256,
              },
            },
          ]
        : [];
    });
}

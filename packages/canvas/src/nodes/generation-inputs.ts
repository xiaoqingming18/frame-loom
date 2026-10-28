import {
  InputRole,
  type CanvasDocument,
  type CanvasMediaData,
  type SemanticInput,
} from '@frame-loom/contracts';
import type { CanvasGenerationConfig } from '../host';

export function generationModel(
  config: CanvasGenerationConfig | null,
  kind: 'image' | 'video' | 'tts',
  modelId?: string,
) {
  const models = config?.models.filter((model) => model.kind === kind) ?? [];
  return modelId ? models.find((model) => model.id === modelId) : models[0];
}

export function generationInputs(document: CanvasDocument, nodeId: string): SemanticInput[] {
  return generationSources(document, nodeId).map((reference) => reference.input);
}

/** 连线和本地素材使用同一份顺序，编号与实际请求始终一致。 */
export function generationSources(document: CanvasDocument, nodeId: string) {
  const target = document.nodes.find((node) => node.id === nodeId);
  const data = target?.data as CanvasMediaData | undefined;
  const refs = generationReferences(document, nodeId).map(({ edge, node, input, media }) => ({
    id: edge.id,
    sourceId: node.id,
    name: node.title ?? node.id,
    input,
    media,
    local: false,
  }));
  const local = (data?.mediaReferences ?? []).map((ref) => ({
    id: ref.id,
    sourceId: ref.id,
    name: ref.name,
    input: {
      kind: ref.media.mime.startsWith('image/')
        ? ('image' as const)
        : ref.media.mime.startsWith('video/')
          ? ('video' as const)
          : ('audio' as const),
      role: ref.role,
      sha256: ref.media.sha256,
    },
    media: ref.media,
    local: true,
  }));
  const rank = (id: string) => {
    const index = data?.inputOrder.indexOf(id) ?? -1;
    return index < 0 ? (data?.inputOrder.length ?? 0) : index;
  };
  return [...refs, ...local]
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map((ref, order) => ({ ...ref, input: { ...ref.input, order } }));
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
      const data = source.data as CanvasMediaData;
      const media = data.versions?.[data.activeVersion ?? -1];
      return media
        ? [
            {
              edge,
              node: source,
              media,
              input: {
                kind: source.type === 'video' ? ('video' as const) : ('image' as const),
                role: InputRole.safeParse(edge.targetHandle).success
                  ? InputRole.parse(edge.targetHandle)
                  : ('reference' as const),
                sha256: media.sha256,
              },
            },
          ]
        : [];
    });
}

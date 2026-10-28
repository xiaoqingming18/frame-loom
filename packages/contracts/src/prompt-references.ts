import type { MediaKind, PromptRefSyntax } from './semantic-request.js';

export function parsePromptReferences(prompt: string) {
  return Array.from(prompt.matchAll(/@\{([A-Za-z0-9_-]+)\}/g), (match) => ({
    nodeId: match[1],
    start: match.index,
    end: match.index + match[0].length,
  }));
}
export function resolvePromptReferences(
  prompt: string,
  inputs: readonly { id: string; kind: MediaKind }[],
  syntax: PromptRefSyntax,
  base: 0 | 1,
) {
  const counts: Record<MediaKind, number> = { image: base, video: base, audio: base };
  const indices = inputs.map((input) => counts[input.kind]++);
  const chinese = /\p{Unified_Ideograph}/u.test(prompt);
  const labels = chinese
    ? { image: '图', video: '视频', audio: '音频' }
    : { image: 'Image ', video: 'Video ', audio: 'Audio ' };
  const missingNodeIds = new Set<string>();
  const result = prompt.replace(/@\{([A-Za-z0-9_-]+)\}/g, (token, id: string) => {
    const index = inputs.findIndex((input) => input.id === id);
    if (index < 0) {
      missingNodeIds.add(id);
      return token;
    }
    const kind = inputs[index].kind;
    if (syntax === '@image_n') return `@${kind}_${indices[index]}`;
    if (syntax === '<IMAGE_n>') return `<${kind.toUpperCase()}_${indices[index]}>`;
    return `${labels[kind]}${indices[index]}`;
  });
  return { prompt: result, missingNodeIds: [...missingNodeIds] };
}

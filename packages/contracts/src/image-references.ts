export type ImageReference = { nodeId: string; start: number; end: number };

export function parseImageReferences(prompt: string): ImageReference[] {
  return Array.from(prompt.matchAll(/@\{([A-Za-z0-9_-]+)\}/g), (match) => ({
    nodeId: match[1],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

/** inputNodeIds 必须与实际请求 inputs 一一对应，排序由画布调用方负责。 */
export function resolveImagePrompt(prompt: string, inputNodeIds: readonly string[]) {
  const prefix = /\p{Unified_Ideograph}/u.test(prompt) ? '图' : 'Image ';
  const missingNodeIds = new Set<string>();
  const references = parseImageReferences(prompt);
  let result = '';
  let offset = 0;
  for (const reference of references) {
    const index = inputNodeIds.indexOf(reference.nodeId);
    result += prompt.slice(offset, reference.start);
    if (index < 0) {
      missingNodeIds.add(reference.nodeId);
      result += prompt.slice(reference.start, reference.end);
    } else result += `${prefix}${index + 1}`;
    offset = reference.end;
  }
  return { prompt: result + prompt.slice(offset), missingNodeIds: [...missingNodeIds] };
}

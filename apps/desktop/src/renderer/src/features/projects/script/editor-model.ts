import { Node, type JSONContent } from '@tiptap/core';
import { ScriptDocument } from '@frame-loom/contracts';

export const ScriptBlockNode = Node.create({
  name: 'scriptBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: false,
  defining: true,
  addAttributes: () => ({
    id: { default: null },
    type: { default: 'action' },
    attrs: { default: null },
    src: { default: null },
    review: { default: null },
  }),
  parseHTML: () => [{ tag: 'p[data-block-type]' }],
  renderHTML({ node }) {
    return [
      'p',
      { 'data-block-type': node.attrs.type as string, 'data-id': node.attrs.id as string },
      0,
    ];
  },
});

export function toEditorJson(document: ScriptDocument): JSONContent {
  return {
    type: 'doc',
    content: document.blocks.map((block) => ({
      type: 'scriptBlock',
      attrs: {
        id: block.id,
        type: block.type,
        attrs: block.attrs ? JSON.stringify(block.attrs) : null,
        src: block.src?.line ?? null,
        review: block.review ? JSON.stringify(block.review) : null,
      },
      ...(block.text ? { content: [{ type: 'text', text: block.text }] } : {}),
    })),
  };
}
export function fromEditorJson(json: JSONContent): ScriptDocument {
  if (json.type !== 'doc') throw new Error('剧本根节点必须为 doc');
  return ScriptDocument.parse({
    schemaVersion: 1,
    blocks: (json.content ?? []).map((node) => {
      if (
        node.type !== 'scriptBlock' ||
        node.marks?.length ||
        node.content?.some((text) => text.type !== 'text' || text.marks?.length)
      )
        throw new Error('剧本只允许纯文本段落');
      const attrs: Record<string, unknown> = node.attrs ?? {};
      for (const key of ['attrs', 'review']) {
        if (attrs[key] != null && typeof attrs[key] !== 'string')
          throw new Error('段落属性必须为 JSON 字符串');
      }
      return {
        id: attrs.id,
        type: attrs.type,
        text: (node.content ?? []).map((text) => text.text ?? '').join(''),
        ...(attrs.attrs !== null && attrs.attrs !== undefined
          ? { attrs: JSON.parse(attrs.attrs as string) as unknown }
          : {}),
        ...(attrs.src !== null && attrs.src !== undefined ? { src: { line: attrs.src } } : {}),
        ...(attrs.review !== null && attrs.review !== undefined
          ? { review: JSON.parse(attrs.review as string) as unknown }
          : {}),
      };
    }),
  });
}

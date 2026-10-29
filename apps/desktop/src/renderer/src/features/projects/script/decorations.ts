import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findMentions, type BlockType, type ElementKind } from '@frame-loom/contracts';

export type MentionTerm = { elementId: string; name: string; kind: ElementKind };
type State = { decorations: DecorationSet; terms: MentionTerm[] };
export const scriptDecorationKey = new PluginKey<State>('scriptDecorations');
export function blockDecorations(node: Node, pos: number, terms: MentionTerm[]): Decoration[] {
  if (node.attrs.type === 'note') return [];
  const result = findMentions(node.textContent, terms, node.attrs.type as BlockType).map(
    (mention) =>
      Decoration.inline(
        pos + 1 + mention.from,
        pos + 1 + mention.to,
        {
          class: `script-mention-${terms.find((term) => term.elementId === mention.elementId)!.kind}`,
          'data-element-id': mention.elementId,
        },
        { mention: true },
      ),
  );
  if (node.attrs.review) {
    result.push(Decoration.node(pos, pos + node.nodeSize, { 'data-review': 'true' }));
    result.push(
      Decoration.widget(
        pos + node.nodeSize - 1,
        () => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = '存疑';
          button.className = 'script-review';
          button.dataset.reviewId = node.attrs.id as string;
          button.contentEditable = 'false';
          return button;
        },
        { key: `review-${node.attrs.id}-${node.attrs.review}` },
      ),
    );
  }
  return result;
}
export function createDecorations(compute = blockDecorations) {
  function all(doc: Node, terms: MentionTerm[]) {
    const result: Decoration[] = [];
    doc.forEach((node, pos) => result.push(...compute(node, pos, terms)));
    return DecorationSet.create(doc, result);
  }
  return new Plugin<State>({
    key: scriptDecorationKey,
    state: {
      init: (_, state) => ({ terms: [], decorations: all(state.doc, []) }),
      apply(tr, previous, oldState) {
        const terms = tr.getMeta('mentions') as MentionTerm[] | undefined;
        if (terms) return { terms, decorations: all(tr.doc, terms) };
        if (!tr.docChanged) return previous;
        let decorations = previous.decorations.map(tr.mapping, tr.doc);
        const old = new Map<string, { node: Node; pos: number }>();
        oldState.doc.forEach((node, pos) => old.set(node.attrs.id as string, { node, pos }));
        tr.doc.forEach((node, pos) => {
          const previousNode = old.get(node.attrs.id as string);
          if (
            previousNode?.node.eq(node) &&
            !tr.mapping.mapResult(previousNode.pos + 1).deleted &&
            tr.mapping.map(previousNode.pos + 1) === pos + 1
          )
            return;
          decorations = decorations.remove(
            decorations
              .find(pos, pos + node.nodeSize)
              .filter(
                (decoration) => decoration.from >= pos && decoration.to <= pos + node.nodeSize,
              ),
          );
          decorations = decorations.add(tr.doc, compute(node, pos, previous.terms));
        });
        return { terms: previous.terms, decorations };
      },
    },
    props: { decorations: (state) => scriptDecorationKey.getState(state)?.decorations },
  });
}
export const ScriptDecorations = Extension.create({
  name: 'scriptDecorations',
  addProseMirrorPlugins: () => [createDecorations()],
});

import { TextSelection, Plugin, type Command } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';
import { joinBackward } from '@tiptap/pm/commands';
import { isHistoryTransaction } from '@tiptap/pm/history';
import {
  parseCharacter,
  parseSceneHeading,
  type BlockType,
  type ReviewOption,
} from '@frame-loom/contracts';

export const TYPE_CYCLE: BlockType[] = [
  'action',
  'character',
  'dialogue',
  'parenthetical',
  'scene',
  'transition',
  'sound',
  'text',
  'note',
  'cast',
  'act',
];
export const NEXT_TYPE: Record<BlockType, BlockType> = {
  act: 'scene',
  scene: 'action',
  cast: 'action',
  action: 'action',
  character: 'dialogue',
  parenthetical: 'dialogue',
  dialogue: 'action',
  sound: 'action',
  text: 'action',
  transition: 'scene',
  note: 'action',
};
const composing = (view: Parameters<Command>[2]) => view?.composing ?? false;
export const setBlockType =
  (type: BlockType): Command =>
  (state, dispatch, view) => {
    if (composing(view)) return false;
    const { $from } = state.selection;
    if ($from.depth < 1) return false;
    const attrs = {
      ...$from.parent.attrs,
      type,
      attrs: type === $from.parent.attrs.type ? ($from.parent.attrs.attrs as string | null) : null,
      review: null,
    };
    dispatch?.(state.tr.setNodeMarkup($from.before(), undefined, attrs));
    return true;
  };
export const cycleBlockType =
  (direction: number): Command =>
  (state, dispatch, view) => {
    if (composing(view)) return false;
    const node = state.selection.$from.parent;
    if (node.textContent) return true;
    const index = TYPE_CYCLE.indexOf(node.attrs.type as BlockType);
    return setBlockType(TYPE_CYCLE[(index + direction + TYPE_CYCLE.length) % TYPE_CYCLE.length])(
      state,
      dispatch,
      view,
    );
  };
export const enterBlock: Command = (state, dispatch, view) => {
  if (composing(view)) return false;
  const { $from } = state.selection;
  if ($from.depth < 1) return false;
  const block = $from.parent;
  const type = block.attrs.type as BlockType;
  if (!block.textContent && type !== 'action') return setBlockType('action')(state, dispatch, view);
  const tr = state.tr.deleteSelection();
  const cursor = tr.selection.$from;
  const offset = cursor.parentOffset;
  const atEnd = offset === cursor.parent.content.size;
  const start = cursor.before();
  let attrs: Record<string, unknown> = { ...block.attrs, review: null };
  if (atEnd && type === 'action') {
    const heading = parseSceneHeading(block.textContent);
    if (heading?.confident) {
      attrs = {
        ...attrs,
        type: 'scene',
        attrs: JSON.stringify({ time: heading.time, space: heading.space }),
      };
      tr.replaceWith(
        start,
        start + block.nodeSize,
        block.type.create(
          attrs,
          heading.location ? state.schema.text(heading.location) : undefined,
        ),
      );
    }
  }
  if (atEnd && type === 'character') {
    const character = parseCharacter(block.textContent);
    attrs = { ...attrs, attrs: JSON.stringify({ delivery: character.delivery }) };
    tr.replaceWith(
      start,
      start + block.nodeSize,
      block.type.create(attrs, character.name ? state.schema.text(character.name) : undefined),
    );
  }
  if (atEnd) {
    const node = tr.doc.nodeAt(start)!;
    const insert = start + node.nodeSize;
    tr.insert(
      insert,
      block.type.create({
        id: crypto.randomUUID(),
        type: NEXT_TYPE[attrs.type as BlockType],
        attrs: null,
        src: null,
        review: null,
      }),
    );
    tr.setSelection(TextSelection.create(tr.doc, insert + 1));
  } else {
    tr.split(tr.selection.from, 1, [
      {
        type: block.type,
        attrs: { ...block.attrs, id: crypto.randomUUID(), src: null, review: null },
      },
    ]);
  }
  dispatch?.(tr.scrollIntoView());
  return true;
};
export const backspaceBlock: Command = (state, dispatch, view) =>
  composing(view) ? false : joinBackward(state, dispatch, view);
export const moveBlock =
  (direction: -1 | 1): Command =>
  (state, dispatch, view) => {
    if (composing(view) || state.selection.$from.depth < 1) return false;
    const start = state.selection.$from.before();
    const node = state.doc.nodeAt(start)!;
    const offset = state.selection.$from.parentOffset;
    if (
      (direction === -1 && start === 0) ||
      (direction === 1 && start + node.nodeSize >= state.doc.content.size)
    )
      return true;
    const target =
      direction === -1
        ? start - state.doc.resolve(start).nodeBefore!.nodeSize
        : start + state.doc.resolve(start + node.nodeSize).nodeAfter!.nodeSize;
    const tr = state.tr.delete(start, start + node.nodeSize).insert(target, node);
    tr.setSelection(TextSelection.create(tr.doc, target + 1 + offset));
    dispatch?.(tr.scrollIntoView());
    return true;
  };
export const pasteLines =
  (text: string): Command =>
  (state, dispatch, view) => {
    if (composing(view)) return false;
    const lines = text.split(/\r\n?|\n/u);
    if (lines.length < 2) return false;
    const type =
      state.selection.$from.parent.attrs.type === 'scene'
        ? 'action'
        : (state.selection.$from.parent.attrs.type as BlockType);
    const nodes = lines.map((line) =>
      state.schema.nodes.scriptBlock.create(
        { id: crypto.randomUUID(), type, attrs: null, src: null, review: null },
        line ? state.schema.text(line) : undefined,
      ),
    );
    const { $from, $to } = state.selection;
    if (!$from.parent.textContent && $from.sameParent($to))
      dispatch?.(state.tr.replaceWith($from.before(), $from.after(), nodes).scrollIntoView());
    else
      dispatch?.(
        state.tr.replaceSelection(new Slice(Fragment.fromArray(nodes), 1, 1)).scrollIntoView(),
      );
    return true;
  };

export const applyReview =
  (id: string, option?: ReviewOption): Command =>
  (state, dispatch) => {
    let position = -1;
    state.doc.forEach((node, pos) => {
      if (node.attrs.id === id) position = pos;
    });
    if (position < 0) return false;
    const node = state.doc.nodeAt(position)!;
    const type = option?.type ?? (node.attrs.type as BlockType);
    const attrs = {
      ...node.attrs,
      type,
      attrs: type === node.attrs.type ? (node.attrs.attrs as string | null) : null,
      review: null,
    };
    const text = option?.text ?? node.textContent;
    const nodes = [];
    if (type === 'dialogue' && option?.character)
      nodes.push(
        node.type.create(
          {
            id: crypto.randomUUID(),
            type: 'character',
            attrs: null,
            src: node.attrs.src as number | null,
            review: null,
          },
          state.schema.text(option.character),
        ),
      );
    nodes.push(node.type.create(attrs, text ? state.schema.text(text) : undefined));
    dispatch?.(state.tr.replaceWith(position, position + node.nodeSize, nodes));
    return true;
  };

export const clearReviewPlugin = () =>
  new Plugin({
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged) || transactions.some(isHistoryTransaction))
        return null;
      const old = new Map<string, string>();
      oldState.doc.forEach((node) => old.set(node.attrs.id as string, node.textContent));
      const tr = newState.tr;
      newState.doc.forEach((node, pos) => {
        if (
          node.attrs.review &&
          old.has(node.attrs.id as string) &&
          old.get(node.attrs.id as string) !== node.textContent
        )
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, review: null });
      });
      return tr.docChanged ? tr : null;
    },
  });

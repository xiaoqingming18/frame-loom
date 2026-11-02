import type { Command } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { beatJson, sceneJson } from './editor-model';
import type { Node as ProseNode } from '@tiptap/pm/model';
const switches = new WeakMap<Editor, Map<string, { before: ProseNode; after: ProseNode }>>();

export function findNode(editor: Editor, id: string) {
  let result: { node: ProseNode; pos: number } | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs.id === id) result = { node, pos };
  });
  return result;
}
export function scrollToScriptNode(editor: Editor, id: string): boolean {
  const target = editor.view.dom.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
  target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  return !!target;
}
export function addScene(editor: Editor) {
  if (!editor.isEditable) return;
  const scene = editor.schema.nodeFromJSON(
    sceneJson({
      id: crypto.randomUUID(),
      scene_id: '1-1',
      location: '',
      characters: [],
      atmosphere: '',
      interior: true,
      time_of_day: '日',
      beats: [],
    }),
  );
  const pos = editor.state.doc.content.size - editor.state.doc.lastChild!.nodeSize;
  const tr = closeHistory(editor.state.tr).insert(pos, scene);
  tr.setSelection(TextSelection.create(tr.doc, pos + 2));
  editor.view.dispatch(tr);
  editor.view.focus();
}
export function addBeat(editor: Editor, sceneId: string, type: 'action' | 'dialogue') {
  if (!editor.isEditable) return;
  const scene = findNode(editor, sceneId);
  if (!scene) return;
  const node = editor.schema.nodeFromJSON(
    beatJson(
      type === 'action'
        ? { id: crypto.randomUUID(), type, content: '' }
        : { id: crypto.randomUUID(), type, speaker: '', emotion: '', line: '' },
    ),
  );
  const pos = scene.pos + scene.node.nodeSize - 1;
  const tr = closeHistory(editor.state.tr).insert(pos, node);
  tr.setSelection(TextSelection.create(tr.doc, pos + 2));
  editor.view.dispatch(tr);
  editor.view.focus();
}
export function moveNode(editor: Editor, id: string, direction: -1 | 1) {
  if (!editor.isEditable) return;
  const found = findNode(editor, id);
  if (!found) return;
  const $pos = editor.state.doc.resolve(found.pos);
  const parent = $pos.parent,
    index = $pos.index(),
    next = index + direction;
  if (next < 0 || next >= parent.childCount || parent.child(next).type !== found.node.type) return;
  const neighbor = parent.child(next);
  const insert =
    direction < 0
      ? found.pos - neighbor.nodeSize
      : found.pos + found.node.nodeSize + neighbor.nodeSize;
  const tr = closeHistory(editor.state.tr).delete(found.pos, found.pos + found.node.nodeSize);
  const destination = tr.mapping.map(insert);
  tr.insert(destination, found.node);
  tr.setSelection(TextSelection.create(tr.doc, destination + 2));
  editor.view.dispatch(tr);
  editor.view.focus();
}
export function removeNode(editor: Editor, id: string) {
  if (!editor.isEditable) return;
  const found = findNode(editor, id);
  if (!found) return;
  if (found.node.type.name === 'scriptScene' && editor.state.doc.childCount <= 3) return;
  editor.view.dispatch(
    closeHistory(editor.state.tr).delete(found.pos, found.pos + found.node.nodeSize),
  );
  editor.view.focus();
}
export function switchBeat(editor: Editor, id: string) {
  if (!editor.isEditable) return;
  const found = findNode(editor, id);
  if (!found || found.node.type.name !== 'scriptBeat') return;
  let history = switches.get(editor);
  if (!history) {
    history = new Map();
    switches.set(editor, history);
  }
  const previous = history.get(id);
  const fields = Array.from(
    { length: found.node.childCount },
    (_, i) => found.node.child(i).textContent,
  );
  const next =
    found.node.attrs.type === 'dialogue'
      ? {
          id,
          type: 'action' as const,
          content: `${fields[0]}${fields[1] ? `（${fields[1]}）` : ''}：${fields[2]}`,
        }
      : { id, type: 'dialogue' as const, speaker: '', emotion: '', line: fields[0] };
  const replacement = previous?.after.eq(found.node)
    ? previous.before
    : editor.schema.nodeFromJSON(beatJson(next));
  if (previous?.after.eq(found.node)) history.delete(id);
  else history.set(id, { before: found.node, after: replacement });
  const transaction = closeHistory(editor.state.tr).replaceWith(
    found.pos,
    found.pos + found.node.nodeSize,
    replacement,
  );
  transaction.setSelection(TextSelection.create(transaction.doc, found.pos + 2));
  editor.view.dispatch(transaction);
  editor.view.focus();
}
export const enterBeat: Command = (state, dispatch, view) => {
  if (view?.composing || !state.selection.empty) return false;
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const current = $from.node(depth);
    if (current.type.name !== 'scriptBeat') continue;
    const type = current.attrs.type === 'dialogue' ? 'dialogue' : 'action';
    const node = state.schema.nodeFromJSON(
      beatJson(
        type === 'action'
          ? { id: crypto.randomUUID(), type, content: '' }
          : { id: crypto.randomUUID(), type, speaker: '', emotion: '', line: '' },
      ),
    );
    const pos = $from.after(depth),
      tr = closeHistory(state.tr).insert(pos, node);
    tr.setSelection(TextSelection.create(tr.doc, pos + 2));
    dispatch?.(tr);
    return true;
  }
  return true;
};
export const backspaceBeat: Command = (state, dispatch, view) => {
  if (view?.composing || !state.selection.empty || state.selection.$from.parentOffset !== 0)
    return false;
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name !== 'scriptBeat') continue;
    if (node.textContent.trim()) return true;
    const tr = closeHistory(state.tr).delete($from.before(depth), $from.after(depth));
    const previous = $from.node(depth - 1).child($from.index(depth - 1) - 1);
    const position = $from.before(depth) - (previous.type.name === 'scriptBeat' ? 2 : 1);
    tr.setSelection(TextSelection.create(tr.doc, position));
    dispatch?.(tr);
    return true;
  }
  return $from.parentOffset === 0;
};
export const focusField =
  (direction: -1 | 1): Command =>
  (state, dispatch, view) => {
    if (view?.composing || !state.selection.empty) return false;
    const fields: number[] = [];
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'scriptField') fields.push(pos + 1);
    });
    const current = fields.indexOf(state.selection.$from.start());
    const position = fields[current + direction];
    if (current < 0 || position === undefined) return false;
    dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, position)).scrollIntoView());
    return true;
  };
export const pasteText =
  (text: string): Command =>
  (state, dispatch) => {
    if (!state.selection.$from.sameParent(state.selection.$to)) return true;
    dispatch?.(state.tr.insertText(text.replace(/\r\n?/gu, '\n')));
    return true;
  };

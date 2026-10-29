import type { Editor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { deriveScenes, type ScriptDocument } from '@frame-loom/contracts';

export function scrollToBlock(editor: Editor, id: string) {
  const target = editor.view.dom.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target?.animate?.([{ backgroundColor: 'var(--accent)' }, { backgroundColor: 'transparent' }], {
    duration: 1400,
  });
}
export function moveScene(
  editor: Editor,
  document: ScriptDocument,
  number: number,
  sourceId: string,
  targetId: string,
) {
  const scenes = deriveScenes(document.blocks, number);
  const source = scenes.find((scene) => scene.id === sourceId);
  const target = scenes.find((scene) => scene.id === targetId);
  if (!source || !target || source === target) return;
  const positions = [0];
  editor.state.doc.forEach((node) => positions.push(positions.at(-1)! + node.nodeSize));
  const from = positions[source.start],
    to = positions[source.end];
  const insert = source.start < target.start ? positions[target.end] : positions[target.start];
  const content = Fragment.fromArray(
    Array.from({ length: source.end - source.start }, (_, index) =>
      editor.state.doc.child(source.start + index),
    ),
  );
  const tr = editor.state.tr.delete(from, to);
  tr.insert(tr.mapping.map(insert), content);
  editor.view.dispatch(tr);
}

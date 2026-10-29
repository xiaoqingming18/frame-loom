import { Extension, type Extensions } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import UniqueID from '@tiptap/extension-unique-id';
import { Placeholder, UndoRedo } from '@tiptap/extensions';
import { BLOCK_LABELS, type BlockType } from '@frame-loom/contracts';
import { ScriptBlockNode } from './editor-model';
import {
  backspaceBlock,
  clearReviewPlugin,
  cycleBlockType,
  enterBlock,
  moveBlock,
  pasteLines,
  setBlockType,
} from './script-commands';

const keyboard = Extension.create({
  name: 'scriptKeyboard',
  addKeyboardShortcuts() {
    const command = (fn: typeof enterBlock) => () => {
      const view = this.editor.view;
      return !view.composing && fn(view.state, view.dispatch, view);
    };
    return {
      Enter: command(enterBlock),
      Tab: command(cycleBlockType(1)),
      'Shift-Tab': command(cycleBlockType(-1)),
      Backspace: command(backspaceBlock),
      'Alt-ArrowUp': command(moveBlock(-1)),
      'Alt-ArrowDown': command(moveBlock(1)),
      ...Object.fromEntries(
        (
          [
            'scene',
            'action',
            'character',
            'parenthetical',
            'dialogue',
            'sound',
            'text',
            'transition',
            'note',
          ] as BlockType[]
        ).map((type, index) => [`Mod-${index + 1}`, command(setBlockType(type))]),
      ),
      'Mod-z': () => !this.editor.view.composing && this.editor.commands.undo(),
      'Mod-Shift-z': () => !this.editor.view.composing && this.editor.commands.redo(),
      'Mod-y': () => !this.editor.view.composing && this.editor.commands.redo(),
    };
  },
  addProseMirrorPlugins() {
    return [clearReviewPlugin()];
  },
});
export function scriptExtensions(): Extensions {
  return [
    Document.extend({ content: 'scriptBlock+' }),
    Text,
    ScriptBlockNode,
    UndoRedo,
    UniqueID.configure({ types: ['scriptBlock'], generateID: () => crypto.randomUUID() }),
    Placeholder.configure({
      placeholder: ({ node }) =>
        node.attrs.type === 'scene' ? '1-1 日 内 地点' : BLOCK_LABELS[node.attrs.type as BlockType],
    }),
    keyboard,
  ];
}
export const handleScriptPaste = (view: EditorView, event: ClipboardEvent) =>
  pasteLines(event.clipboardData?.getData('text/plain') ?? '')(view.state, view.dispatch, view);

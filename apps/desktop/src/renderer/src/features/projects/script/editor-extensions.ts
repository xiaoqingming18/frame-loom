import { Extension, type Extensions } from '@tiptap/core';
import Text from '@tiptap/extension-text';
import { UndoRedo } from '@tiptap/extensions';
import { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { ReactNodeViewRenderer } from '@tiptap/react';
import {
  ScriptRootNode,
  ScriptIntroNode,
  ScriptEndNode,
  ScriptFieldNode,
  ScriptSceneNode,
  ScriptBeatNode,
  fromEditorJson,
} from './editor-model';
import { SceneView, BeatView, EndView } from './node-views';
import { enterBeat, backspaceBeat, focusField, pasteText } from './script-commands';
export const isScriptCompositionKey = (view: EditorView, event: KeyboardEvent) =>
  view.composing || event.isComposing || event.keyCode === 229;
const keyboard = Extension.create({
  name: 'scriptKeyboard',
  addKeyboardShortcuts() {
    const command = (fn: typeof enterBeat) => () =>
      !this.editor.view.composing &&
      fn(this.editor.state, this.editor.view.dispatch, this.editor.view);
    return {
      Enter: command(enterBeat),
      Backspace: command(backspaceBeat),
      Tab: command(focusField(1)),
      'Shift-Tab': command(focusField(-1)),
      'Mod-z': () => !this.editor.view.composing && this.editor.commands.undo(),
      'Mod-Shift-z': () => !this.editor.view.composing && this.editor.commands.redo(),
      'Mod-y': () => !this.editor.view.composing && this.editor.commands.redo(),
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        filterTransaction(transaction) {
          if (!transaction.docChanged) return true;
          try {
            fromEditorJson(transaction.doc.toJSON() as import('@tiptap/core').JSONContent);
            return true;
          } catch {
            return false;
          }
        },
        props: {
          handleDOMEvents: { keydown: (view, event) => isScriptCompositionKey(view, event) },
        },
      }),
    ];
  },
});
export function scriptExtensions(): Extensions {
  return [
    ScriptRootNode,
    ScriptIntroNode,
    ScriptFieldNode,
    ScriptSceneNode.extend({ addNodeView: () => ReactNodeViewRenderer(SceneView) }),
    ScriptBeatNode.extend({ addNodeView: () => ReactNodeViewRenderer(BeatView) }),
    ScriptEndNode.extend({ addNodeView: () => ReactNodeViewRenderer(EndView) }),
    Text,
    UndoRedo,
    keyboard,
  ];
}
export const handleScriptPaste = (view: EditorView, event: ClipboardEvent) =>
  pasteText(event.clipboardData?.getData('text/plain') ?? '')(view.state, view.dispatch, view);

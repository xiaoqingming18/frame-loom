import { useEffect, useState, type ReactNode } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import {
  BLOCK_TYPES,
  BLOCK_LABELS,
  type BlockType,
  type ScriptDocument,
} from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { NativeSelect } from '@frame-loom/ui/components/native-select';
import { Undo2, Redo2 } from 'lucide-react';
import { fromEditorJson, toEditorJson } from './editor-model';
import { scriptExtensions, handleScriptPaste } from './editor-extensions';
import { setBlockType } from './script-commands';
import { SceneChips } from './scene-chips';
import { KeyboardHelp } from './keyboard-help';
import { ScriptDecorations } from './decorations';
import { Outline } from './outline';
import './script-editor.css';

export function ScriptEditor({
  document,
  onChange,
  onError,
  onEditor,
  locked = false,
  toolbar,
  number = 1,
  right,
  overlays,
  elementsOpen = false,
  onElementsOpen,
}: {
  document: ScriptDocument;
  onChange: (document: ScriptDocument) => void;
  onError: (error: unknown) => void;
  onEditor?: (editor: Editor | null) => void;
  locked?: boolean;
  toolbar?: ReactNode;
  number?: number;
  right?: (editor: Editor) => ReactNode;
  overlays?: (editor: Editor) => ReactNode;
  elementsOpen?: boolean;
  onElementsOpen?: () => void;
}) {
  const [help, setHelp] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [, render] = useState(0);
  const editor = useEditor({
    extensions: [
      ...scriptExtensions(),
      SceneChips.configure({ episodeNumber: number }),
      ScriptDecorations,
    ],
    content: toEditorJson(document),
    injectCSS: false,
    editorProps: {
      attributes: { 'aria-label': '剧本编辑区', role: 'textbox', 'aria-multiline': 'true' },
      handlePaste: handleScriptPaste,
    },
    onUpdate: ({ editor }) => {
      try {
        onChange(fromEditorJson(editor.getJSON()));
      } catch (error) {
        onError(error);
      }
    },
    onTransaction: () => render((value) => value + 1),
  });
  useEffect(() => {
    editor?.setEditable(!locked);
  }, [editor, locked]);
  useEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);
  if (!editor) return <p role="status">正在加载编辑器…</p>;
  return (
    <>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-card px-4 py-2">
        <NativeSelect
          aria-label="段落类型"
          className="w-28"
          disabled={locked}
          value={(editor.state.selection.$from.parent.attrs.type as string) ?? 'action'}
          onChange={(event) => {
            editor.commands.command(({ state, dispatch, view }) =>
              setBlockType(event.target.value as BlockType)(state, dispatch, view),
            );
            editor.commands.focus();
          }}
        >
          {BLOCK_TYPES.map((type) => (
            <option key={type} value={type}>
              {BLOCK_LABELS[type]}
            </option>
          ))}
        </NativeSelect>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="撤销"
          disabled={locked || !editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="重做"
          disabled={locked || !editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 aria-hidden />
        </Button>
        {toolbar}
        <Button variant="ghost" size="sm" onClick={() => setOutlineOpen((value) => !value)}>
          大纲
        </Button>
        {right && (
          <Button variant="ghost" size="sm" onClick={onElementsOpen}>
            元素栏
          </Button>
        )}
        <Button
          className="ml-auto"
          variant="ghost"
          size="icon-sm"
          aria-label="快捷键帮助"
          onClick={() => setHelp(true)}
        >
          ?
        </Button>
      </div>
      <div data-script-layout className="relative flex min-h-0 flex-1">
        <div data-script-outline data-open={outlineOpen}>
          <Outline editor={editor} document={document} number={number} />
        </div>
        <div data-script-scroll className="min-h-0 min-w-0 flex-1 overflow-auto bg-muted/50">
          <div data-script-paper>
            <EditorContent editor={editor} />
          </div>
        </div>
        {right && (
          <div data-script-elements data-open={elementsOpen}>
            {right(editor)}
          </div>
        )}
      </div>
      {overlays?.(editor)}
      {help && <KeyboardHelp onClose={() => setHelp(false)} />}
    </>
  );
}

import { useEffect, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { ScriptMeta, type EditableScriptDocument } from '@frame-loom/contracts';
import { fromEditorJson, toEditorJson } from './editor-model';
import { scriptExtensions, handleScriptPaste } from './editor-extensions';
import { Outline } from './outline';
export function ScriptEditor({
  document,
  onChange,
  onError,
  onEditor,
  onComposition,
  locked = false,
}: {
  document: EditableScriptDocument;
  onChange: (doc: EditableScriptDocument) => void;
  onError: (error: unknown) => void;
  onEditor?: (editor: Editor | null) => void;
  onComposition?: (composing: boolean) => void;
  locked?: boolean;
}) {
  const [initial] = useState(() => toEditorJson(document));
  const editor = useEditor({
    extensions: scriptExtensions(),
    content: initial,
    injectCSS: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { 'aria-label': '剧本编辑区' },
      handlePaste: handleScriptPaste,
      handleDOMEvents: {
        compositionstart: () => {
          onComposition?.(true);
          return false;
        },
        compositionend: () => {
          onComposition?.(false);
          return false;
        },
      },
    },
    onUpdate: ({ editor, transaction }) => {
      if (transaction.getMeta('projection')) return;
      try {
        onChange(fromEditorJson(editor.getJSON()));
      } catch (error) {
        onError(error);
      }
    },
  });
  useEffect(() => {
    editor?.setEditable(!locked, false);
  }, [editor, locked]);
  useEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);
  useEffect(() => {
    if (!editor) return;
    const current = ScriptMeta.parse(editor.state.doc.attrs.meta);
    const meta = {
      ...current,
      series: document.meta.series,
      episode: document.meta.episode,
      title: document.meta.title,
      genre: document.meta.genre,
      style: document.meta.style,
      duration_sec: document.meta.duration_sec,
    };
    if (JSON.stringify(meta) !== JSON.stringify(current))
      editor.view.dispatch(
        editor.state.tr
          .setDocAttribute('meta', meta)
          .setNodeAttribute(0, 'episode', meta.episode)
          .setMeta('projection', true)
          .setMeta('addToHistory', false),
      );
  }, [editor, document.meta]);
  if (!editor) return <p role="status">正在加载编辑器…</p>;
  const meta = document.meta;
  return (
    <div className="script-container">
      <div className="script-layout">
        <Outline editor={editor} document={document} />
        <div data-script-scroll className="script-doc-wrap">
          <main className="script-doc">
            <h1 className="script-doc-title">
              《{meta.series}》第{meta.episode}集剧本
            </h1>
            <p className="script-doc-sub">{meta.title || '本集标题未填写'}</p>
            <div className="script-authority">
              {[
                ['剧名', meta.series],
                ['类型', meta.genre],
                ['画风', meta.style],
                ['单集时长', meta.duration_sec ? `${meta.duration_sec} 秒` : '未填写'],
              ].map(([label, value]) => (
                <div className="script-meta-row" key={label}>
                  <span>{label}</span>
                  <span>{value || '未填写'}</span>
                </div>
              ))}
            </div>
            <EditorContent editor={editor} />
            <footer className="script-doc-foot">
              共 <b>{document.scenes.length}</b> 场 ·{' '}
              <b>{document.scenes.reduce((n, s) => n + s.beats.length, 0)}</b> 条内容
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}

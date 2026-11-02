import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { EditableScriptDocument } from '@frame-loom/contracts';
import { addScene, scrollToScriptNode } from './script-commands';
export function Outline({
  editor,
  document,
}: {
  editor: Editor;
  document: EditableScriptDocument;
}) {
  const [active, setActive] = useState(''),
    [expanded, setExpanded] = useState(false);
  const ids = document.scenes.map((s) => s.id).join(',');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((e) => e.isIntersecting);
        if (visible) setActive((visible.target as HTMLElement).dataset.id ?? '');
      },
      { root: editor.view.dom.closest('[data-script-scroll]'), rootMargin: '-10% 0px -65% 0px' },
    );
    editor.view.dom.querySelectorAll('[data-script-scene]').forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [editor, ids]);
  return (
    <aside className="script-outline" data-expanded={expanded} aria-label="场次大纲">
      <button
        className="script-outline-head"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span>场次大纲</span>
        <small>{document.scenes.length} 场</small>
        <span className="script-outline-caret">⌄</span>
      </button>
      <nav className="script-outline-list">
        {document.scenes.map((scene, index) => (
          <button
            key={scene.id}
            className="script-outline-item"
            data-active={active === scene.id}
            onClick={() => {
              setActive(scene.id);
              scrollToScriptNode(editor, scene.id);
              setExpanded(false);
            }}
          >
            <span className="script-outline-number">
              {document.meta.episode}-{index + 1}
            </span>
            <span className="script-outline-location">{scene.location || '未命名场景'}</span>
            <span className="script-outline-tag">
              {scene.interior ? '内' : '外'} · {scene.time_of_day} · {scene.beats.length} 条内容
            </span>
          </button>
        ))}
      </nav>
      <button
        className="script-outline-add"
        disabled={!editor.isEditable}
        onClick={() => addScene(editor)}
      >
        ＋ 添加场次
      </button>
    </aside>
  );
}

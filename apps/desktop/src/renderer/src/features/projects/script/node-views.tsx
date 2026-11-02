import { useEffect, useState } from 'react';
import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react';
import { ArrowUp, ArrowDown, Trash2, RefreshCw, Plus } from 'lucide-react';
import { ScriptMeta } from '@frame-loom/contracts';
import { addBeat, addScene, moveNode, removeNode, switchBeat } from './script-commands';

export function SceneView({ node, editor, updateAttributes }: NodeViewProps) {
  const [, render] = useState(0);
  useEffect(() => {
    const update = () => render((n) => n + 1);
    editor.on('transaction', update);
    return () => {
      editor.off('transaction', update);
    };
  }, [editor]);
  const ids: string[] = [];
  editor.state.doc.forEach((n) => {
    if (n.type.name === 'scriptScene') ids.push(String(n.attrs.id));
  });
  const number = String(ScriptMeta.parse(editor.state.doc.attrs.meta).episode);
  const id = String(node.attrs.id),
    position = ids.indexOf(id);
  return (
    <NodeViewWrapper className="script-scene" data-script-scene="" data-id={id}>
      <div contentEditable={false} className="script-slug-label">
        <span>
          {number}-{position + 1}
        </span>
        <span className="script-slug-dot">·</span>
      </div>
      <div contentEditable={false} className="script-toggles">
        <button
          disabled={!editor.isEditable}
          aria-label="切换内外"
          onClick={() => updateAttributes({ interior: !node.attrs.interior })}
        >
          {node.attrs.interior ? '内' : '外'}
        </button>
        <button
          disabled={!editor.isEditable}
          aria-label="切换日夜"
          onClick={() =>
            updateAttributes({ time_of_day: node.attrs.time_of_day === '日' ? '夜' : '日' })
          }
        >
          {String(node.attrs.time_of_day)}
        </button>
      </div>
      <NodeViewContent className="script-scene-content" />
      <div contentEditable={false} className="script-scene-tools">
        <button disabled={!editor.isEditable} onClick={() => addBeat(editor, id, 'action')}>
          ＋ 动作
        </button>
        <button disabled={!editor.isEditable} onClick={() => addBeat(editor, id, 'dialogue')}>
          ＋ 对白
        </button>
        <span className="grow" />
        <button
          aria-label="上移场次"
          disabled={!editor.isEditable || position === 0}
          onClick={() => moveNode(editor, id, -1)}
        >
          <ArrowUp aria-hidden size={12} />
        </button>
        <button
          aria-label="下移场次"
          disabled={!editor.isEditable || position === ids.length - 1}
          onClick={() => moveNode(editor, id, 1)}
        >
          <ArrowDown aria-hidden size={12} />
        </button>
        <button
          aria-label="删除场次"
          disabled={!editor.isEditable || ids.length <= 1}
          onClick={() => removeNode(editor, id)}
        >
          <Trash2 aria-hidden size={12} />
        </button>
      </div>
    </NodeViewWrapper>
  );
}
export function BeatView({ node, editor }: NodeViewProps) {
  const id = String(node.attrs.id),
    type = String(node.attrs.type);
  const name = node.firstChild?.textContent ?? '';
  const color = [...name].reduce((n, c) => n + c.codePointAt(0)!, 0) % 6;
  return (
    <NodeViewWrapper
      className={`script-line ${type} script-role-${color}`}
      data-script-beat={type}
      data-id={id}
    >
      <NodeViewContent className="script-beat-fields" />
      <div className="script-line-tools" contentEditable={false}>
        <button
          aria-label="切换动作对白"
          disabled={!editor.isEditable}
          onClick={() => switchBeat(editor, id)}
        >
          <RefreshCw aria-hidden size={11} />
        </button>
        <button
          aria-label="上移内容"
          disabled={!editor.isEditable}
          onClick={() => moveNode(editor, id, -1)}
        >
          <ArrowUp aria-hidden size={11} />
        </button>
        <button
          aria-label="下移内容"
          disabled={!editor.isEditable}
          onClick={() => moveNode(editor, id, 1)}
        >
          <ArrowDown aria-hidden size={11} />
        </button>
        <button
          aria-label="删除内容"
          disabled={!editor.isEditable}
          onClick={() => removeNode(editor, id)}
        >
          <Trash2 aria-hidden size={11} />
        </button>
      </div>
    </NodeViewWrapper>
  );
}
export function EndView({ editor }: NodeViewProps) {
  return (
    <NodeViewWrapper>
      <button
        contentEditable={false}
        className="script-add-scene"
        disabled={!editor.isEditable}
        onClick={() => addScene(editor)}
      >
        <Plus aria-hidden size={13} /> 添加场次
      </button>
      <NodeViewContent className="script-end-content" />
    </NodeViewWrapper>
  );
}

import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import {
  BLOCK_LABELS,
  BLOCK_SHORT_LABELS,
  BLOCK_TYPES,
  type BlockType,
} from '@frame-loom/contracts';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@frame-loom/ui/components/dropdown-menu';
import { setBlockType } from './script-commands';

export function BlockHandle({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<{
    pos: number;
    top: number;
    left: number;
    type: BlockType;
  } | null>(null);
  useEffect(() => {
    const move = (event: MouseEvent) => {
      const block = (event.target as HTMLElement).closest<HTMLElement>('p[data-id]');
      if (!block || !editor.view.dom.contains(block)) return;
      const found = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (!found) return;
      const pos = editor.state.doc.resolve(found.pos);
      if (!pos.depth) return;
      const rect = block.getBoundingClientRect();
      setHover({
        pos: pos.before(),
        top: rect.top,
        left: rect.left - 32,
        type: pos.parent.attrs.type as BlockType,
      });
    };
    editor.view.dom.addEventListener('mousemove', move);
    return () => editor.view.dom.removeEventListener('mousemove', move);
  }, [editor]);
  if (!hover) return null;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <span className="fixed" style={{ top: hover.top, left: hover.left }} />
      </DropdownMenuTrigger>
      <button
        draggable
        aria-label={`段落类型：${BLOCK_LABELS[hover.type]}`}
        className="fixed z-20 rounded-sm border bg-card px-1 text-xs text-muted-foreground"
        style={{ top: hover.top, left: hover.left }}
        onClick={() => setOpen(true)}
        onDragStart={(event) => {
          const selection = NodeSelection.create(editor.state.doc, hover.pos);
          editor.view.dispatch(editor.state.tr.setSelection(selection));
          // ProseMirror 原生拖放协议要求设置 view.dragging。
          Object.assign(editor.view, { dragging: { slice: selection.content(), move: true } });
          event.dataTransfer.setData('text/plain', selection.node.textContent);
        }}
      >
        {BLOCK_SHORT_LABELS[hover.type]}
      </button>
      <DropdownMenuContent>
        {BLOCK_TYPES.filter((type) => type !== 'act').map((type) => (
          <DropdownMenuItem
            key={type}
            onSelect={() => {
              editor.view.dispatch(
                editor.state.tr.setSelection(TextSelection.create(editor.state.doc, hover.pos + 1)),
              );
              editor.commands.command(({ state, dispatch, view }) =>
                setBlockType(type)(state, dispatch, view),
              );
            }}
          >
            {BLOCK_LABELS[type]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

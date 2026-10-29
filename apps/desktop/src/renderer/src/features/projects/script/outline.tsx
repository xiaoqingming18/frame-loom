import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { moveScene, scrollToBlock } from './scene-commands';
import { deriveScenes, type ScriptDocument } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@frame-loom/ui/components/dropdown-menu';
import { MoreHorizontal, Plus } from 'lucide-react';

export function Outline({
  editor,
  document,
  number,
}: {
  editor: Editor;
  document: ScriptDocument;
  number: number;
}) {
  const scenes = deriveScenes(document.blocks, number);
  const [active, setActive] = useState('');
  const [drag, setDrag] = useState('');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setActive((visible.target as HTMLElement).dataset.id ?? '');
      },
      { root: editor.view.dom.closest('[data-script-scroll]'), rootMargin: '-10% 0px -65% 0px' },
    );
    editor.view.dom
      .querySelectorAll('[data-block-type="scene"]')
      .forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [editor, document]);
  return (
    <nav aria-label="场次大纲" className="flex h-full flex-col overflow-auto p-3">
      <h2 className="mb-3 text-sm font-semibold">场次大纲 · {scenes.length} 场</h2>
      {scenes.map((scene, index) => (
        <div key={scene.id}>
          {scene.actId && scenes[index - 1]?.actId !== scene.actId && (
            <h3 className="mt-3 mb-2 text-xs text-muted-foreground">
              {document.blocks.find((block) => block.id === scene.actId)?.text}
            </h3>
          )}
          <div
            draggable
            onDragStart={() => setDrag(scene.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => moveScene(editor, document, number, drag, scene.id)}
            className="mb-1 flex items-center rounded-md hover:bg-accent"
            data-active={active === scene.id}
          >
            <button
              className="min-w-0 flex-1 p-2 text-left text-sm"
              onClick={() => {
                setActive(scene.id);
                scrollToBlock(editor, scene.id);
              }}
            >
              <span className="font-medium">
                {scene.number} {scene.location || '未命名场景'}
              </span>
              <span className="block text-xs text-muted-foreground">
                {scene.time ?? '时间'} · {scene.space ?? '内外'} ·{' '}
                {scene.characters.slice(0, 3).join('、')}
                {scene.characters.length > 3 ? ` +${scene.characters.length - 3}` : ''}
              </span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`${scene.number} 场菜单`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  disabled={!index}
                  onSelect={() =>
                    moveScene(editor, document, number, scene.id, scenes[index - 1].id)
                  }
                >
                  上移
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={index === scenes.length - 1}
                  onSelect={() =>
                    moveScene(editor, document, number, scene.id, scenes[index + 1].id)
                  }
                >
                  下移
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ))}
      <Button
        className="mt-3"
        variant="outline"
        onClick={() => {
          const pos = editor.state.doc.content.size;
          const tr = editor.state.tr.insert(
            pos,
            editor.schema.nodes.scriptBlock.create({ id: crypto.randomUUID(), type: 'scene' }),
          );
          tr.setSelection(TextSelection.create(tr.doc, pos + 1));
          editor.view.dispatch(tr);
          editor.view.focus();
        }}
      >
        <Plus />
        新增场
      </Button>
    </nav>
  );
}

import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { StoryResult } from '@frame-loom/contracts';
import { Popover, PopoverAnchor, PopoverContent } from '@frame-loom/ui/components/popover';
export function MentionCard({
  editor,
  elements,
  openElement,
}: {
  editor: Editor;
  elements: StoryResult['elements'];
  openElement: (id: string) => void;
}) {
  const [hover, setHover] = useState<{ id: string; top: number; left: number } | null>(null);
  useEffect(() => {
    const move = (event: MouseEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-element-id]');
      if (!target) {
        setHover(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      setHover({ id: target.dataset.elementId!, top: rect.bottom, left: rect.left });
    };
    const click = (event: MouseEvent) => {
      const id = (event.target as HTMLElement).closest<HTMLElement>('[data-element-id]')?.dataset
        .elementId;
      if (id && event.ctrlKey) {
        event.preventDefault();
        openElement(id);
      }
    };
    editor.view.dom.addEventListener('mousemove', move);
    editor.view.dom.addEventListener('click', click);
    return () => {
      editor.view.dom.removeEventListener('mousemove', move);
      editor.view.dom.removeEventListener('click', click);
    };
  }, [editor, openElement]);
  const element = elements.find((element) => element.id === hover?.id);
  if (!element || !hover) return null;
  return (
    <Popover open>
      <PopoverAnchor asChild>
        <span className="fixed" style={{ top: hover.top, left: hover.left }} />
      </PopoverAnchor>
      <PopoverContent
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <strong>{element.name}</strong>
        <p className="text-xs text-muted-foreground">
          {{ character: '人物', location: '场景', prop: '道具', costume: '服装' }[element.kind]} ·{' '}
          {element.status === 'pending' ? '待确认' : '已确认'} · 出现 {element.mentions} 次
        </p>
      </PopoverContent>
    </Popover>
  );
}

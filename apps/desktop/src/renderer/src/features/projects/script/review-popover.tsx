import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { ScriptBlock } from '@frame-loom/contracts';
import { Popover, PopoverAnchor, PopoverContent } from '@frame-loom/ui/components/popover';
import { Button } from '@frame-loom/ui/components/button';
import { applyReview } from './script-commands';

export function ReviewPopover({
  editor,
  blocks,
  source,
}: {
  editor: Editor;
  blocks: ScriptBlock[];
  source?: string;
}) {
  const [anchor, setAnchor] = useState<{ id: string; top: number; left: number } | null>(null);
  useEffect(() => {
    const click = (event: MouseEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-review-id]');
      if (!target) return;
      const rect = target.getBoundingClientRect();
      setAnchor({ id: target.dataset.reviewId!, top: rect.bottom, left: rect.left });
    };
    editor.view.dom.addEventListener('click', click);
    return () => editor.view.dom.removeEventListener('click', click);
  }, [editor]);
  const block = blocks.find((block) => block.id === anchor?.id);
  if (!block?.review || !anchor) return null;
  const apply = (index?: number) => {
    editor.commands.command(({ state, dispatch, view }) =>
      applyReview(block.id, index === undefined ? undefined : block.review!.options[index])(
        state,
        dispatch,
        view,
      ),
    );
    setAnchor(null);
    editor.view.focus();
  };
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) setAnchor(null);
      }}
    >
      <PopoverAnchor asChild>
        <span className="fixed" style={{ top: anchor.top, left: anchor.left }} />
      </PopoverAnchor>
      <PopoverContent onCloseAutoFocus={(event) => event.preventDefault()}>
        <p className="text-sm">{block.review.reason}</p>
        <p className="my-2 text-xs text-muted-foreground">
          {source?.split(/\r\n?|\n/u)[block.src?.line ?? -1]}
        </p>
        <div className="flex flex-col gap-1">
          {block.review.options.map((option, index) => (
            <Button key={index} variant="outline" size="sm" onClick={() => apply(index)}>
              {option.type === 'dialogue'
                ? `改为对白${option.character ? `（角色：${option.character}）` : ''}`
                : `改为${option.type}`}
            </Button>
          ))}
          <Button variant="ghost" onClick={() => apply()}>
            保持当前
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

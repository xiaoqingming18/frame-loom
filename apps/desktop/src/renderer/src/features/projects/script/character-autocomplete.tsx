import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { StoryResult } from '@frame-loom/contracts';
import { Popover, PopoverAnchor, PopoverContent } from '@frame-loom/ui/components/popover';
import { Button } from '@frame-loom/ui/components/button';

export function CharacterAutocomplete({
  editor,
  elements,
}: {
  editor: Editor;
  elements: StoryResult['elements'];
}) {
  const [candidate, setCandidate] = useState<{
    text: string;
    from: number;
    to: number;
    top: number;
    left: number;
  } | null>(null);
  const [index, setIndex] = useState(0);
  const names = candidate
    ? elements
        .filter(
          (element) =>
            element.kind === 'character' &&
            [element.name, ...element.aliases].some((name) =>
              name.toLocaleLowerCase().includes(candidate.text.toLocaleLowerCase()),
            ),
        )
        .map((element) => element.name)
        .slice(0, 8)
    : [];
  const choose = (name: string) => {
    if (!candidate) return;
    editor.view.dispatch(editor.state.tr.insertText(name, candidate.from, candidate.to));
    setCandidate(null);
    editor.view.focus();
  };
  useEffect(() => {
    const update = () => {
      const { $from, empty } = editor.state.selection;
      if (
        !empty ||
        $from.parent.attrs.type !== 'character' ||
        !$from.parent.textContent ||
        editor.view.composing
      ) {
        setCandidate(null);
        return;
      }
      const rect = editor.view.coordsAtPos($from.pos);
      setCandidate({
        text: $from.parent.textContent,
        from: $from.start(),
        to: $from.end(),
        top: rect.bottom,
        left: rect.left,
      });
      setIndex(0);
    };
    editor.on('update', update);
    return () => {
      editor.off('update', update);
    };
  }, [editor]);
  useEffect(() => {
    if (!candidate) return;
    const key = (event: KeyboardEvent) => {
      if (editor.view.composing) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setIndex(
          (value) =>
            (value + (event.key === 'ArrowDown' ? 1 : names.length) + names.length + 1) %
            (names.length + 1),
        );
      } else if (event.key === 'Enter') {
        event.preventDefault();
        event.stopImmediatePropagation();
        choose(names[index] ?? candidate.text);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setCandidate(null);
      }
    };
    editor.view.dom.addEventListener('keydown', key, true);
    return () => editor.view.dom.removeEventListener('keydown', key, true);
  });
  if (!candidate) return null;
  return (
    <Popover open>
      <PopoverAnchor asChild>
        <span className="fixed" style={{ top: candidate.top, left: candidate.left }} />
      </PopoverAnchor>
      <PopoverContent
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div role="listbox" aria-label="人物自动补全" className="flex flex-col">
          {[...names, candidate.text].map((name, item) => (
            <Button
              key={item}
              role="option"
              aria-selected={index === item}
              variant={index === item ? 'secondary' : 'ghost'}
              onClick={() => choose(name)}
            >
              {item === names.length ? `新建人物：${name}（待确认）` : name}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

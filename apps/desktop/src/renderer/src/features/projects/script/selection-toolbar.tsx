import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { ElementKind } from '@frame-loom/contracts';
import { Popover, PopoverAnchor, PopoverContent } from '@frame-loom/ui/components/popover';
import { Button } from '@frame-loom/ui/components/button';

export function SelectionToolbar({
  editor,
  create,
}: {
  editor: Editor;
  create: (kind: ElementKind, name: string) => Promise<void>;
}) {
  const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(
    null,
  );
  const [error, setError] = useState('');
  useEffect(() => {
    const update = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty || !(editor.state.selection instanceof TextSelection) || editor.view.composing) {
        setSelection(null);
        return;
      }
      const rect = editor.view.coordsAtPos(to);
      setSelection({
        text: editor.state.doc.textBetween(from, to, '\n').trim(),
        top: rect.bottom,
        left: rect.left,
      });
    };
    editor.on('selectionUpdate', update);
    return () => {
      editor.off('selectionUpdate', update);
    };
  }, [editor]);
  if (!selection) return null;
  const disabled =
    selection.text.length < 1 || selection.text.length > 40 || selection.text.includes('\n');
  return (
    <Popover open>
      <PopoverAnchor asChild>
        <span className="fixed" style={{ top: selection.top, left: selection.left }} />
      </PopoverAnchor>
      <PopoverContent
        className="w-auto"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex flex-wrap gap-1">
          {(['character', 'prop', 'costume'] as const).map((kind, index) => (
            <Button
              key={kind}
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => {
                void create(kind, selection.text)
                  .then(() => setSelection(null))
                  .catch((error: unknown) =>
                    setError(error instanceof Error ? error.message : '标记失败'),
                  );
              }}
            >
              标记为{['人物', '道具', '服装'][index]}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const pos = editor.state.selection.$to.after();
              const tr = editor.state.tr.insert(
                pos,
                editor.schema.nodes.scriptBlock.create({ id: crypto.randomUUID(), type: 'note' }),
              );
              tr.setSelection(TextSelection.create(tr.doc, pos + 1));
              editor.view.dispatch(tr);
              editor.view.focus();
              setSelection(null);
            }}
          >
            添加注释
          </Button>
        </div>
        {error && <p role="alert">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}

import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { parseImageReferences, type ModelProfile } from '@frame-loom/contracts';
import { useCanvas, useCanvasState } from '../context';
import { insertImageReference } from '../commands/commands';
import { checkConnection } from '../registry/connections';
import { generationReferences } from './generation-inputs';

/** 只读取文本与受控标签，不保存粘贴的 HTML。 */
function promptText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node instanceof HTMLElement && node.dataset.reference) return `@{${node.dataset.reference}}`;
  if (node.nodeName === 'BR') return '\n';
  return Array.from(
    node.childNodes,
    (child, index) =>
      `${index && /^(DIV|P)$/.test(child.nodeName) ? '\n' : ''}${promptText(child)}`,
  ).join('');
}

function caretOffset(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !root.contains(selection.anchorNode)) return null;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(root);
  range.setEnd(selection.anchorNode!, selection.anchorOffset);
  return promptText(range.cloneContents()).length;
}

function placeCaret(root: HTMLElement, offset: number) {
  const range = document.createRange();
  for (const child of root.childNodes) {
    const length = promptText(child).length;
    if (offset <= length) {
      if (child.nodeType === Node.TEXT_NODE) range.setStart(child, offset);
      else if (offset === 0) range.setStartBefore(child);
      else range.setStartAfter(child);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      return;
    }
    offset -= length;
  }
  range.selectNodeContents(root);
  range.collapse(false);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}

export function ImagePromptEditor({
  nodeId,
  value,
  disabled,
  expanded,
  profile,
  onChange,
  ref,
}: {
  nodeId: string;
  value: string;
  disabled: boolean;
  expanded: boolean;
  profile: ModelProfile | undefined;
  onChange: (value: string) => void;
  ref: Ref<{ open: () => void }>;
}) {
  const { store, host, registry } = useCanvas();
  const canvas = useCanvasState((state) => state.document);
  const editor = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const nextCaret = useRef<number | null>(null);
  const rendered = useRef('');
  const renderedValue = useRef(value);
  const [menu, setMenu] = useState<{ start: number; end: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const references = generationReferences(canvas, nodeId);
  const max = profile?.modes.some((mode) => mode.id === 'reference')
    ? (profile.inputs.find((input) => input.kind === 'image')?.maxCount ?? 0)
    : 0;
  const candidates = (
    !menu
      ? []
      : [
          ...references
            .filter((reference) => reference.node.type === 'image')
            .map((reference) => reference.node),
          ...canvas.nodes.filter(
            (node) =>
              node.id !== nodeId &&
              node.type === 'image' &&
              !references.some((reference) => reference.node.id === node.id) &&
              registry.supports(node) &&
              registry.get(node.type)?.output?.(node.data),
          ),
        ]
  )
    .map((node) => {
      const index = references.findIndex((reference) => reference.node.id === node.id);
      const verdict =
        index >= 0
          ? { ok: true as const }
          : checkConnection(registry, canvas, {
              source: node.id,
              target: nodeId,
              sourceHandle: 'out',
              targetHandle: 'reference',
            });
      const reason =
        index >= 0
          ? undefined
          : !profile
            ? '请先选择生成模型'
            : canvas.edges.filter((edge) => edge.target === nodeId).length >= max
              ? `当前模型最多 ${max} 张参考`
              : !verdict.ok
                ? verdict.reason
                : undefined;
      return { node, index, reason, sha256: registry.get(node.type)?.output?.(node.data)?.sha256 };
    })
    .filter(
      ({ node }) =>
        !menu?.query || (node.title ?? node.id).toLowerCase().includes(menu.query.toLowerCase()),
    );
  const enabled = candidates.filter((candidate) => !candidate.reason);

  useImperativeHandle(ref, () => ({
    open() {
      if (disabled || composing.current) return;
      const offset = caretOffset(editor.current!) ?? value.length;
      setMenu({ start: offset, end: offset, query: '' });
      setActive(0);
      editor.current?.focus();
    },
  }));

  useLayoutEffect(() => {
    if (menu && enabled[active])
      document
        .getElementById(`reference-${nodeId}-${enabled[active].node.id}`)
        ?.scrollIntoView?.({ block: 'nearest' });
  }, [menu, enabled, active, nodeId]);

  useLayoutEffect(() => {
    const root = editor.current;
    if (!root || composing.current) return;
    const signature = JSON.stringify([
      references.map((item) => [item.node.id, item.node.title, item.input.sha256]),
    ]);
    const valueChanged = renderedValue.current !== value;
    renderedValue.current = value;
    if (
      rendered.current === signature &&
      (!valueChanged || promptText(root) === value) &&
      nextCaret.current === null
    )
      return;
    rendered.current = signature;
    const offset =
      nextCaret.current ?? (document.activeElement === root ? caretOffset(root) : null);
    nextCaret.current = null;
    const children: Node[] = [];
    let start = 0;
    for (const reference of parseImageReferences(value)) {
      children.push(document.createTextNode(value.slice(start, reference.start)));
      const index = references.findIndex((item) => item.node.id === reference.nodeId);
      const tag = document.createElement('span');
      tag.setAttribute('contenteditable', 'false');
      tag.dataset.reference = reference.nodeId;
      tag.className =
        index < 0
          ? 'inline-flex items-center gap-1 rounded border border-destructive bg-muted px-1 text-destructive'
          : 'inline-flex items-center gap-1 rounded border bg-muted px-1 text-foreground';
      tag.title =
        index < 0 ? '引用的参考已断开' : (references[index].node.title ?? reference.nodeId);
      if (index >= 0) {
        const image = document.createElement('img');
        image.src = host.media.url(references[index].input.sha256);
        image.alt = '';
        image.draggable = false;
        image.className = 'inline-block size-5 rounded object-cover';
        tag.append(image);
      }
      tag.append(document.createTextNode(index < 0 ? '失效参考' : `图${index + 1}`));
      children.push(tag);
      start = reference.end;
    }
    children.push(document.createTextNode(value.slice(start)));
    root.replaceChildren(...children);
    if (offset !== null) placeCaret(root, offset);
  });

  function readInput(trigger = true) {
    const root = editor.current!;
    const text = promptText(root);
    if (text.length > 32000) {
      rendered.current = '';
      store.getState().notify('提示词最多 32000 字（含引用标记）');
      onChange(value);
      return;
    }
    const offset = caretOffset(root) ?? text.length;
    const match = trigger ? /@([^@\s{}]*)$/.exec(text.slice(0, offset)) : null;
    setMenu(match ? { start: offset - match[0].length, end: offset, query: match[1] } : null);
    setActive(0);
    onChange(text);
  }

  function choose(sourceId: string) {
    if (!menu || disabled) return;
    const token = `@{${sourceId}}`;
    const prompt = value.slice(0, menu.start) + token + value.slice(menu.end);
    nextCaret.current = menu.start + token.length;
    const ok = store
      .getState()
      .apply((document) => insertImageReference(registry, document, nodeId, sourceId, prompt, max));
    if (!ok) nextCaret.current = null;
    setMenu(null);
    editor.current?.focus();
  }

  return (
    <div>
      <div
        ref={editor}
        role="textbox"
        aria-label="生成提示词"
        aria-multiline="true"
        aria-disabled={disabled}
        contentEditable={!disabled}
        suppressContentEditableWarning
        aria-controls={menu ? `references-${nodeId}` : undefined}
        aria-expanded={!!menu}
        aria-activedescendant={
          menu && enabled[active] ? `reference-${nodeId}-${enabled[active].node.id}` : undefined
        }
        data-placeholder="描述你想要生成的内容，点击 @ 添加参考内容。"
        className={`canvas-prompt-editor overflow-y-auto px-3.5 py-6 text-sm break-words whitespace-pre-wrap transition-[height] duration-200 ease-in-out outline-none motion-reduce:transition-none ${expanded ? 'h-[292px]' : 'h-32'}`}
        onInput={() => {
          if (!composing.current) readInput();
        }}
        onCompositionStart={() => {
          composing.current = true;
          setMenu(null);
        }}
        onCompositionEnd={() => {
          composing.current = false;
          readInput(false);
        }}
        onBlur={() => setMenu(null)}
        onPointerDown={() => setMenu(null)}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPaste={(event) => {
          event.preventDefault();
          if (disabled || composing.current) return;
          const selection = window.getSelection();
          if (!selection?.rangeCount) return;
          const range = selection.getRangeAt(0);
          if (!editor.current?.contains(range.commonAncestorContainer)) return;
          range.deleteContents();
          const text = document.createTextNode(event.clipboardData.getData('text/plain'));
          range.insertNode(text);
          range.setStartAfter(text);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          readInput(false);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (disabled) return;
          if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
            event.preventDefault();
            setMenu(null);
            if (event.shiftKey || event.key.toLowerCase() === 'y') store.getState().redo();
            else store.getState().undo();
            return;
          }
          if (menu && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) {
            event.preventDefault();
            if (event.key === 'Escape') setMenu(null);
            else if (event.key === 'Enter') {
              if (enabled[active]) choose(enabled[active].node.id);
            } else
              setActive(
                (active + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) %
                  (enabled.length || 1),
              );
            return;
          }
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab'].includes(event.key)) setMenu(null);
          if (event.key === 'Enter') {
            event.preventDefault();
            const selection = window.getSelection();
            if (selection?.rangeCount) {
              const range = selection.getRangeAt(0);
              range.deleteContents();
              const text = document.createTextNode('\n');
              range.insertNode(text);
              range.setStartAfter(text);
              range.collapse(true);
              selection.removeAllRanges();
              selection.addRange(range);
              readInput(false);
            }
          }
          if (event.key === 'Backspace' || event.key === 'Delete') {
            const selection = window.getSelection();
            if (!selection?.isCollapsed) return;
            const offset = caretOffset(editor.current!);
            const reference = parseImageReferences(value).find((reference) =>
              event.key === 'Backspace' ? reference.end === offset : reference.start === offset,
            );
            if (reference) {
              event.preventDefault();
              setMenu(null);
              nextCaret.current = reference.start;
              onChange(value.slice(0, reference.start) + value.slice(reference.end));
            }
          }
        }}
      />
      {menu && (
        <div
          id={`references-${nodeId}`}
          role="listbox"
          aria-label="引用参考"
          className="mx-3 mb-2 max-h-48 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground"
        >
          {['已连入参考', '画布图片'].map((group, groupIndex) => (
            <div key={group} role="group" aria-label={group}>
              <p className="px-2 py-1 text-xs text-muted-foreground">{group}</p>
              {candidates
                .filter((candidate) => candidate.index >= 0 === (groupIndex === 0))
                .map((candidate) => (
                  <button
                    key={candidate.node.id}
                    id={`reference-${nodeId}-${candidate.node.id}`}
                    type="button"
                    role="option"
                    aria-selected={enabled[active]?.node.id === candidate.node.id}
                    disabled={!!candidate.reason}
                    title={candidate.reason}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(candidate.node.id)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-selected:bg-accent"
                  >
                    {candidate.sha256 && (
                      <img
                        src={host.media.url(candidate.sha256)}
                        alt=""
                        className="size-7 rounded-sm object-cover"
                        draggable={false}
                      />
                    )}
                    <span>
                      {candidate.node.title ?? candidate.node.id}
                      {candidate.index >= 0 ? ` · 图${candidate.index + 1}` : ''}
                    </span>
                    {candidate.reason && (
                      <span className="text-muted-foreground">{candidate.reason}</span>
                    )}
                  </button>
                ))}
            </div>
          ))}
          {!candidates.length && (
            <p className="p-2 text-xs text-muted-foreground">没有可用的图片参考</p>
          )}
        </div>
      )}
    </div>
  );
}

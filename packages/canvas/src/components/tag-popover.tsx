import { useState, type FormEvent } from 'react';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { TagColor, TagName, type ProjectTag } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Popover, PopoverAnchor, PopoverContent } from '@frame-loom/ui/components/popover';
import { cn } from '@frame-loom/ui/lib/utils';
import { useCanvas, useCanvasState } from '../context';
import { isNodeLocked, isTaggable, setTag, type Point } from '../commands/commands';

const colorNames: Record<TagColor, string> = {
  red: '红色',
  orange: '橙色',
  yellow: '黄色',
  green: '绿色',
  cyan: '青色',
  blue: '蓝色',
  indigo: '靛色',
  purple: '紫色',
  pink: '粉色',
  gray: '灰色',
};

function ColorPalette({
  color,
  onChange,
}: {
  color: TagColor;
  onChange: (color: TagColor) => void;
}) {
  return (
    <div role="group" aria-label="标签颜色" className="flex flex-wrap gap-1">
      {TagColor.options.map((value) => (
        <button
          key={value}
          type="button"
          aria-label={colorNames[value]}
          aria-pressed={color === value}
          className={cn(
            'rounded-full p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring',
            color === value && 'ring-1 ring-ring',
          )}
          onClick={() => onChange(value)}
        >
          <span className={cn('canvas-tag-dot block size-3 rounded-full', `canvas-tag-${value}`)} />
        </button>
      ))}
    </div>
  );
}

export function TagPopover({ at, onClose }: { at: Point; onClose: () => void }) {
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverAnchor asChild>
        <span className="pointer-events-none fixed size-0" style={{ left: at.x, top: at.y }} />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={0}
        aria-label="画布标签"
        className="w-72 p-3"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.querySelector<HTMLElement>('.frame-loom-canvas')?.focus();
        }}
      >
        <TagPopoverContent onClose={onClose} />
      </PopoverContent>
    </Popover>
  );
}

export function TagPopoverContent({ onClose }: { onClose: () => void }) {
  const { store, host } = useCanvas();
  const tags = useCanvasState((state) => state.tags);
  const document = useCanvasState((state) => state.document);
  const selected = useCanvasState((state) => state.selectedNodes);
  const nodes = document.nodes.filter(
    (node) => selected.has(node.id) && isTaggable(node) && !isNodeLocked(document, node),
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState<TagColor>('blue');
  const [showColors, setShowColors] = useState(false);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState<TagColor>('blue');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!host.tags) return null;
  const api = host.tags;
  const assign = (tagId: string | null) => {
    store.getState().apply((current) => setTag(current, selected, tagId));
    onClose();
  };
  const save = async (event: FormEvent, tag?: ProjectTag) => {
    event.preventDefault();
    if (busy) return;
    const parsed = TagName.safeParse(tag ? editName : name);
    if (!parsed.success) {
      setError('标签名需要 1–10 个字符');
      return;
    }
    if (
      tags?.some(
        (item) => item.id !== tag?.id && item.name.toLowerCase() === parsed.data.toLowerCase(),
      )
    ) {
      setError('标签名已存在');
      return;
    }
    if (!tag && (tags?.length ?? 0) >= 50) {
      setError('每个项目最多 50 个标签');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = tag
        ? await api.update(tag.id, { name: parsed.data, color: editColor })
        : await api.create({ name: parsed.data, color });
      store.getState().setTags(next);
      if (tag) setEditing(null);
      else setName('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存标签失败');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (tag: ProjectTag) => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.remove(tag);
      if (next) store.getState().setTags(next);
      if (editing === tag.id && next) setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除标签失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium">画布标签</h2>
      {tags === null ? (
        <p role="status" className="text-xs text-muted-foreground">
          正在加载标签…
        </p>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          {tags.map((tag) => (
            <div key={tag.id} className="group rounded-md focus-within:bg-accent hover:bg-accent">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-pressed={nodes.length > 0 && nodes.every((node) => node.tagId === tag.id)}
                  disabled={busy || !nodes.length}
                  onClick={() => assign(tag.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'canvas-tag-dot size-2 shrink-0 rounded-full',
                      `canvas-tag-${tag.color}`,
                    )}
                  />
                  <span className="truncate">{tag.name}</span>
                  {nodes.length > 0 && nodes.every((node) => node.tagId === tag.id) && (
                    <Check aria-hidden="true" className="ml-auto size-3.5 shrink-0" />
                  )}
                </button>
                <div className="flex shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                  {!tag.builtin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`编辑标签 ${tag.name}`}
                      disabled={busy}
                      onClick={() => {
                        setEditing(tag.id);
                        setEditName(tag.name);
                        setEditColor(tag.color);
                        setError(null);
                      }}
                    >
                      <Pencil aria-hidden="true" className="size-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`删除标签 ${tag.name}`}
                    disabled={busy}
                    onClick={() => void remove(tag)}
                  >
                    <Trash2 aria-hidden="true" className="size-3.5" />
                  </Button>
                </div>
              </div>
              {editing === tag.id && (
                <form className="space-y-2 p-2" onSubmit={(event) => void save(event, tag)}>
                  <input
                    autoFocus
                    aria-label="编辑标签名"
                    value={editName}
                    disabled={busy}
                    onChange={(event) => setEditName(event.target.value)}
                    className="w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <ColorPalette color={editColor} onChange={setEditColor} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy} type="submit">
                      保存
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setEditing(null)}
                    >
                      取消
                    </Button>
                  </div>
                </form>
              )}
            </div>
          ))}
          <button
            type="button"
            disabled={busy || !nodes.some((node) => node.tagId)}
            onClick={() => assign(null)}
            className="w-full rounded-md px-2 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            移除标签
          </button>
        </div>
      )}
      <form className="space-y-2 border-t pt-3" onSubmit={(event) => void save(event)}>
        <div className="flex gap-2">
          <input
            aria-label="标签名"
            placeholder="标签名"
            value={name}
            disabled={busy || tags === null}
            onChange={(event) => setName(event.target.value)}
            className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" size="sm" variant="ghost" disabled={busy || tags === null}>
            <Plus aria-hidden="true" className="size-3.5" />
            添加
          </Button>
        </div>
        <button
          type="button"
          aria-label="选择标签颜色"
          aria-expanded={showColors}
          disabled={busy}
          className="flex items-center gap-2 rounded-md px-1 py-1 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setShowColors(!showColors)}
        >
          <span
            aria-hidden="true"
            className={cn('canvas-tag-dot size-3 rounded-full', `canvas-tag-${color}`)}
          />
          {colorNames[color]}
        </button>
        {showColors && <ColorPalette color={color} onChange={setColor} />}
      </form>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

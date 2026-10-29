import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { Editor } from '@tiptap/core';
import {
  deriveScenes,
  findMentions,
  type ElementKind,
  type ScriptDocument,
  type StoryResult,
} from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { NativeSelect } from '@frame-loom/ui/components/native-select';
import { scrollToBlock } from './scene-commands';
const ELEMENT_LABELS: Record<ElementKind, string> = {
  character: '人物',
  location: '场景',
  prop: '道具',
  costume: '服装',
};
export function ElementPanel({
  editor,
  story,
  document,
  number,
  projectId,
  selected,
  onSelect,
  mutate,
}: {
  editor: Editor;
  story: StoryResult;
  document: ScriptDocument;
  number: number;
  projectId: string;
  selected: string | null;
  onSelect: (id: string) => void;
  mutate: (path: string, method: string, body?: unknown) => Promise<void>;
}) {
  const [kind, setKind] = useState<ElementKind>('character');
  const [occurrence, setOccurrence] = useState(0);
  const [merging, setMerging] = useState('');
  const [error, setError] = useState('');
  const scenes = deriveScenes(document.blocks, number);
  const elements = story.elements.filter(
    (element) => element.kind === kind || element.id === selected,
  );
  const positions = (element: StoryResult['elements'][number]) =>
    document.blocks.flatMap((block, index) =>
      block.type === 'note'
        ? []
        : findMentions(
            block.text,
            [element.name, ...element.aliases].map((name) => ({
              name,
              kind: element.kind,
              elementId: element.id,
            })),
            block.type,
          ).map(() => ({
            id: block.id,
            scene: scenes.find((scene) => index >= scene.start && index < scene.end)?.number,
          })),
    );
  const run = (path: string, method: string, body?: unknown) => {
    void mutate(path, method, body).catch((error: unknown) =>
      setError(error instanceof Error ? error.message : '操作失败'),
    );
  };
  return (
    <aside aria-label="本集元素" className="flex h-full flex-col overflow-auto p-3">
      <h2 className="mb-3 text-sm font-semibold">本集元素</h2>
      <div className="mb-3 flex flex-wrap gap-1">
        {(Object.keys(ELEMENT_LABELS) as ElementKind[]).map((value) => {
          const items = story.elements.filter(
            (element) => element.kind === value && positions(element).length,
          );
          return (
            <Button
              key={value}
              variant={value === kind ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setKind(value)}
            >
              {ELEMENT_LABELS[value]} {items.length}
              <span className="text-warning">
                {items.filter((element) => element.status === 'pending').length || ''}
              </span>
            </Button>
          );
        })}
      </div>
      {error && <p role="alert">{error}</p>}
      {elements.map((element) => {
        const hits = positions(element);
        if (!hits.length) return null;
        const target = story.elements.find((item) => item.id === element.suggestedMergeInto);
        return (
          <div key={element.id} className="mb-2 rounded-md border p-2">
            <button
              className="w-full text-left text-sm"
              onClick={() => {
                onSelect(element.id);
                setOccurrence(0);
                scrollToBlock(editor, hits[0].id);
              }}
            >
              <span className="font-medium">{element.name}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {element.status === 'pending' ? '待确认' : '已确认'}
              </span>
              <span className="block text-xs text-muted-foreground">
                {element.aliases.join('、')}{' '}
                {Array.from(new Set(hits.map((hit) => hit.scene)))
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
            {selected === element.id && (
              <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
                <span>
                  第 {occurrence + 1} 处 / 共 {hits.length} 处
                </span>
                {([-1, 1] as const).map((direction) => (
                  <Button
                    key={direction}
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const next = (occurrence + direction + hits.length) % hits.length;
                      setOccurrence(next);
                      scrollToBlock(editor, hits[next].id);
                    }}
                  >
                    {direction < 0 ? '上一处' : '下一处'}
                  </Button>
                ))}
              </div>
            )}
            {element.status === 'pending' && (
              <div className="mt-2 flex flex-wrap gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => run(`elements/${element.id}`, 'PATCH', { status: 'confirmed' })}
                >
                  确认
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setMerging(element.id)}>
                  合并到…
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => run(`elements/${element.id}`, 'DELETE')}
                >
                  忽略
                </Button>
                {target && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => run(`elements/${element.id}/merge`, 'POST', { into: target.id })}
                  >
                    合并到 {target.name}？
                  </Button>
                )}
              </div>
            )}
            {merging === element.id && (
              <NativeSelect
                aria-label="合并目标"
                defaultValue=""
                onChange={(event) => {
                  if (event.target.value) {
                    run(`elements/${element.id}/merge`, 'POST', { into: event.target.value });
                    setMerging('');
                  }
                }}
              >
                <option value="">选择同类元素</option>
                {story.elements
                  .filter((item) => item.kind === element.kind && item.id !== element.id)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </NativeSelect>
            )}
          </div>
        );
      })}
      <Link
        className="mt-auto pt-4 text-sm text-primary"
        to="/projects/$projectId"
        params={{ projectId }}
        search={{ tab: 'story', path: '' }}
      >
        在设定库中管理
      </Link>
    </aside>
  );
}

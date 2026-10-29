import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  episodeLabel,
  StoryElement,
  type ElementKind,
  type ProjectManifest,
} from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Input } from '@frame-loom/ui/components/input';
import { ToggleGroup, ToggleGroupItem } from '@frame-loom/ui/components/toggle-group';
import { UserRound, MapPin, Package, Shirt } from 'lucide-react';
import { storyQuery } from '@/lib/project-queries';
import type { EngineClient } from '@/lib/engine-client';
import { ElementDrawer } from './element-drawer';
const categories = [
  { kind: 'character', label: '人物', icon: UserRound },
  { kind: 'location', label: '场景', icon: MapPin },
  { kind: 'prop', label: '道具', icon: Package },
  { kind: 'costume', label: '服装', icon: Shirt },
] as const;
export function StoryTab({
  client,
  projectId,
  episodes,
}: {
  client: EngineClient;
  projectId: string;
  episodes: NonNullable<ProjectManifest['episodes']>;
}) {
  const queryClient = useQueryClient();
  const story = useQuery(storyQuery(client, projectId));
  const [kind, setKind] = useState<ElementKind>('character');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [batch, setBatch] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function mutate(path: string, method: string, body?: unknown) {
    await client.request(
      `/projects/${projectId}/story/${path}`,
      z.union([StoryElement, z.object({ saved: z.literal(true) })]),
      { method, body },
    );
    await queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'story'] });
    await queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'episodes'] });
  }
  async function run(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError('');
    try {
      await mutate(path, method, body);
      if (path === 'batch') {
        setBatch(false);
        setIds([]);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  if (story.error) return <p role="alert">{story.error.message}</p>;
  if (!story.data) return <p role="status">正在读取设定库…</p>;
  const query = search.trim().toLocaleLowerCase();
  const visible = story.data.elements.filter(
    (element) =>
      element.kind === kind &&
      (filter === 'all' || element.status === filter) &&
      [element.name, ...element.aliases].some((name) => name.toLocaleLowerCase().includes(query)),
  );
  const element = story.data.elements.find((element) => element.id === selected);
  const Icon = categories.find((category) => category.kind === kind)!.icon;
  return (
    <div className="flex flex-col gap-5 md:flex-row">
      <nav aria-label="设定分类" className="flex shrink-0 gap-1 md:w-36 md:flex-col">
        {categories.map((category) => (
          <Button
            key={category.kind}
            variant={category.kind === kind ? 'secondary' : 'ghost'}
            className="justify-start"
            onClick={() => {
              setKind(category.kind);
              setIds([]);
            }}
          >
            <category.icon />
            {category.label}{' '}
            {story.data.elements.filter((element) => element.kind === category.kind).length}
          </Button>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Input
            aria-label="搜索设定"
            placeholder="搜索名称或别名"
            className="w-52"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <ToggleGroup
            type="single"
            value={filter}
            onValueChange={(value) => {
              if (value) setFilter(value);
            }}
            aria-label="设定状态筛选"
          >
            {[
              ['all', '全部'],
              ['pending', '待确认'],
              ['confirmed', '已确认'],
              ['ignored', '已忽略'],
            ].map(([value, label]) => (
              <ToggleGroupItem key={value} value={value}>
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setBatch(!batch);
              setIds([]);
            }}
          >
            {batch ? '取消选择' : '批量选择'}
          </Button>
          {batch && ids.length > 0 && (
            <>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void run('batch', 'POST', { ids, action: 'confirm' })}
              >
                确认 {ids.length} 项
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void run('batch', 'POST', { ids, action: 'ignore' })}
              >
                忽略 {ids.length} 项
              </Button>
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="mb-3 text-destructive">
            {error}
          </p>
        )}
        {filter === 'ignored' ? (
          <div className="space-y-2">
            {story.data.ignored
              .filter((item) => item.kind === kind && item.name.toLocaleLowerCase().includes(query))
              .map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <span>{item.name}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void run('ignored/restore', 'POST', item)}
                  >
                    恢复
                  </Button>
                </div>
              ))}
          </div>
        ) : visible.length ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((element) => (
              <article key={element.id} className="relative rounded-xl border bg-card p-3">
                {batch && (
                  <input
                    type="checkbox"
                    aria-label={`选择 ${element.name}`}
                    className="absolute top-4 left-4"
                    checked={ids.includes(element.id)}
                    onChange={(event) =>
                      setIds(
                        event.target.checked
                          ? [...ids, element.id]
                          : ids.filter((id) => id !== element.id),
                      )
                    }
                  />
                )}
                <button className="w-full text-left" onClick={() => setSelected(element.id)}>
                  <div className="mb-3 flex h-28 flex-col items-center justify-center gap-2 rounded-md bg-muted text-xs text-muted-foreground">
                    <Icon className="size-7" />
                    参考图（后续支持）
                  </div>
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">{element.name}</h3>
                    <span
                      className={
                        element.status === 'pending'
                          ? 'text-xs text-warning'
                          : 'text-xs text-muted-foreground'
                      }
                    >
                      {element.status === 'pending' ? '待确认' : '已确认'}
                    </span>
                  </div>
                  <div className="my-2 flex flex-wrap gap-1">
                    {element.aliases.map((alias) => (
                      <span key={alias} className="rounded-md bg-muted px-2 py-0.5 text-xs">
                        {alias}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {element.episodes
                      .map((item) => {
                        const episode = episodes.find((episode) => episode.id === item.episodeId);
                        return `${episode ? episodeLabel(episode) : '未知剧集'} ×${item.scenes} 场`;
                      })
                      .join(' · ') || '尚无出现位置'}
                  </p>
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="grid min-h-60 place-content-center gap-3 text-center text-muted-foreground">
            <Icon className="mx-auto size-9" />
            <p>暂无符合条件的设定</p>
          </div>
        )}
      </div>
      {element && (
        <ElementDrawer
          key={element.id}
          client={client}
          projectId={projectId}
          element={element}
          elements={story.data.elements}
          episodes={episodes}
          mutate={mutate}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

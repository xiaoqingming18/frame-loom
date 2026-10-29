import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  episodeLabel,
  StoryOccurrencesResult,
  type ProjectManifest,
  type StoryElement,
  type StoryResult,
} from '@frame-loom/contracts';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@frame-loom/ui/components/dialog';
import { Button } from '@frame-loom/ui/components/button';
import { Input } from '@frame-loom/ui/components/input';
import { Textarea } from '@frame-loom/ui/components/textarea';
import { NativeSelect } from '@frame-loom/ui/components/native-select';
import type { EngineClient } from '@/lib/engine-client';

export function ElementDrawer({
  client,
  projectId,
  element,
  elements,
  episodes,
  mutate,
  onClose,
}: {
  client: EngineClient;
  projectId: string;
  element: StoryElement;
  elements: StoryResult['elements'];
  episodes: NonNullable<ProjectManifest['episodes']>;
  mutate: (path: string, method: string, body?: unknown) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(element);
  const [alias, setAlias] = useState('');
  const [merging, setMerging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const occurrences = useQuery({
    queryKey: ['projects', projectId, 'story', element.id, 'occurrences'],
    queryFn: ({ signal }) =>
      client.request(
        `/projects/${projectId}/story/elements/${element.id}/occurrences`,
        StoryOccurrencesResult,
        { signal },
      ),
  });
  async function save(field: 'name' | 'aliases' | 'description' | 'attrs', next = value[field]) {
    if (JSON.stringify(next) === JSON.stringify(element[field])) return;
    setBusy(true);
    try {
      await mutate(`elements/${element.id}`, 'PATCH', { [field]: next });
      setErrors((previous) => ({ ...previous, [field]: '' }));
    } catch (error) {
      setErrors((previous) => ({
        ...previous,
        [field]: error instanceof Error ? error.message : '保存失败',
      }));
    } finally {
      setBusy(false);
    }
  }
  async function action(path: string, method: string, body?: unknown) {
    setBusy(true);
    try {
      await mutate(path, method, body);
      if (method === 'DELETE' || path.endsWith('/merge')) onClose();
    } catch (error) {
      setErrors((previous) => ({
        ...previous,
        action: error instanceof Error ? error.message : '操作失败',
      }));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="top-0 right-0 left-auto flex h-full max-w-full translate-x-0 translate-y-0 flex-col overflow-auto rounded-none sm:max-w-lg">
        <DialogTitle>{element.name}</DialogTitle>
        <DialogDescription>编辑设定与查看出现位置，剧本文字不受影响。</DialogDescription>
        <label className="grid gap-1 text-sm">
          名称
          <Input
            value={value.name}
            maxLength={40}
            onChange={(event) => setValue({ ...value, name: event.target.value })}
            onBlur={() => void save('name')}
          />
          {errors.name && (
            <span role="alert" className="text-destructive">
              {errors.name}
            </span>
          )}
        </label>
        <div className="grid gap-2 text-sm">
          <span>别名</span>
          <div className="flex flex-wrap gap-1">
            {value.aliases.map((name) => (
              <Button
                key={name}
                variant="secondary"
                size="sm"
                aria-label={`删除别名 ${name}`}
                onClick={() => {
                  const aliases = value.aliases.filter((alias) => alias !== name);
                  setValue({ ...value, aliases });
                  void save('aliases', aliases);
                }}
              >
                {name} ×
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              aria-label="新增别名"
              maxLength={40}
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
            />
            <Button
              variant="outline"
              disabled={!alias.trim() || value.aliases.length >= 20 || busy}
              onClick={() => {
                const aliases = [...value.aliases, alias.trim()];
                setValue({ ...value, aliases });
                setAlias('');
                void save('aliases', aliases);
              }}
            >
              添加
            </Button>
          </div>
          {errors.aliases && (
            <p role="alert" className="text-destructive">
              {errors.aliases}
            </p>
          )}
        </div>
        <label className="grid gap-1 text-sm">
          描述
          <Textarea
            maxLength={2000}
            value={value.description}
            onChange={(event) => setValue({ ...value, description: event.target.value })}
            onBlur={() => void save('description')}
          />
          {errors.description && <span role="alert">{errors.description}</span>}
        </label>
        {element.kind === 'character' &&
          (['gender', 'ageRange', 'appearance', 'personality'] as const).map((field, index) => (
            <label key={field} className="grid gap-1 text-sm">
              {['性别', '年龄段', '外貌', '性格'][index]}
              <Input
                maxLength={200}
                value={value.attrs[field] ?? ''}
                onChange={(event) =>
                  setValue({ ...value, attrs: { ...value.attrs, [field]: event.target.value } })
                }
                onBlur={() => void save('attrs')}
              />
            </label>
          ))}
        {element.kind === 'location' && (
          <>
            <label className="grid gap-1 text-sm">
              内外
              <NativeSelect
                value={value.attrs.space ?? ''}
                onChange={(event) => {
                  const attrs = {
                    ...value.attrs,
                    space: (event.target.value || undefined) as StoryElement['attrs']['space'],
                  };
                  setValue({ ...value, attrs });
                  void save('attrs', attrs);
                }}
              >
                <option value="">未设置</option>
                <option value="int">内</option>
                <option value="ext">外</option>
                <option value="intext">内外</option>
              </NativeSelect>
            </label>
            <fieldset className="flex flex-wrap gap-3 text-sm">
              <legend>常见时段</legend>
              {(['day', 'night', 'dawn', 'dusk'] as const).map((time, index) => (
                <label key={time}>
                  <input
                    type="checkbox"
                    checked={value.attrs.times?.includes(time) ?? false}
                    onChange={(event) => {
                      const times = event.target.checked
                        ? [...(value.attrs.times ?? []), time]
                        : value.attrs.times?.filter((item) => item !== time);
                      const attrs = { ...value.attrs, times };
                      setValue({ ...value, attrs });
                      void save('attrs', attrs);
                    }}
                  />{' '}
                  {['日', '夜', '晨', '昏'][index]}
                </label>
              ))}
            </fieldset>
          </>
        )}
        {errors.attrs && (
          <p role="alert" className="text-destructive">
            {errors.attrs}
          </p>
        )}
        <h3 className="mt-3 text-sm font-semibold">出现位置</h3>
        {occurrences.error && <p role="alert">{occurrences.error.message}</p>}
        {episodes.map((episode) => {
          const hits = occurrences.data?.filter((hit) => hit.episodeId === episode.id) ?? [];
          return hits.length ? (
            <div key={episode.id}>
              <h4 className="text-xs text-muted-foreground">{episodeLabel(episode)}</h4>
              {hits.map((hit, index) => (
                <Link
                  key={`${hit.blockId}-${index}`}
                  to="/projects/$projectId/episodes/$episodeId"
                  params={{ projectId, episodeId: episode.id }}
                  search={{ block: hit.blockId }}
                  className="my-1 block rounded-md border p-2 text-sm hover:bg-accent"
                >
                  {hit.excerpt}
                </Link>
              ))}
            </div>
          ) : null;
        })}
        {!occurrences.isPending && !occurrences.data?.length && (
          <p className="text-sm text-muted-foreground">尚无出现位置</p>
        )}
        <div className="mt-auto flex flex-wrap gap-2 border-t pt-4">
          <Button
            disabled={busy}
            onClick={() => {
              void (async () => {
                for (const field of ['name', 'aliases', 'description', 'attrs'] as const)
                  await save(field);
              })();
            }}
          >
            保存
          </Button>
          {element.status === 'pending' && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void action(`elements/${element.id}`, 'PATCH', { status: 'confirmed' })
              }
            >
              确认
            </Button>
          )}
          <Button variant="outline" onClick={() => setMerging(!merging)}>
            合并到…
          </Button>
          <Button variant="ghost" onClick={() => setDeleting(true)}>
            删除
          </Button>
        </div>
        {merging && (
          <NativeSelect
            aria-label="合并目标"
            defaultValue=""
            disabled={busy}
            onChange={(event) => {
              if (event.target.value)
                void action(`elements/${element.id}/merge`, 'POST', { into: event.target.value });
            }}
          >
            <option value="">选择同类元素</option>
            {elements
              .filter((item) => item.id !== element.id && item.kind === element.kind)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </NativeSelect>
        )}
        {deleting && (
          <div role="alert" className="rounded-md border p-3 text-sm">
            <p>剧本文字不受影响，该名称将加入已忽略</p>
            <div className="mt-2 flex gap-2">
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => void action(`elements/${element.id}`, 'DELETE')}
              >
                确认删除
              </Button>
              <Button variant="ghost" onClick={() => setDeleting(false)}>
                取消
              </Button>
            </div>
          </div>
        )}
        {errors.action && (
          <p role="alert" className="text-destructive">
            {errors.action}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

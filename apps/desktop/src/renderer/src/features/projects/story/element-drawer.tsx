import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  episodeLabel,
  StoryOccurrencesResult,
  CharacterProfile,
  LocationProfile,
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
const attribute = (attrs: object, key: string): unknown => Reflect.get(attrs, key);
const listInput = (text: string) => (text ? text.split('\n') : []);
const fieldDisplay = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string').join('、')
    : typeof value === 'string'
      ? value
      : '未填写';

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
  const [mergeTarget, setMergeTarget] = useState('');
  const [mergeChoices, setMergeChoices] = useState<Record<string, 'target' | 'source'>>({});
  const target = elements.find((item) => item.id === mergeTarget);
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
        {element.kind === 'character' && (
          <>
            {(['age', 'gender'] as const).map((field, index) => (
              <label key={field} className="grid gap-1 text-sm">
                {['年龄', '性别'][index]}
                <Input
                  maxLength={200}
                  value={CharacterProfile.parse(value.attrs)[field] ?? ''}
                  onChange={(event) =>
                    setValue({ ...value, attrs: { ...value.attrs, [field]: event.target.value } })
                  }
                  onBlur={() => void save('attrs')}
                />
              </label>
            ))}
            {(['appearance', 'personality', 'signatureActions', 'signatureProps'] as const).map(
              (field, index) => (
                <label key={field} className="grid gap-1 text-sm">
                  {['外貌锚点', '性格标签', '标志动作', '标志道具'][index]}（每行一项）
                  <Textarea
                    maxLength={20000}
                    value={(CharacterProfile.parse(value.attrs)[field] ?? []).join('\n')}
                    onChange={(event) =>
                      setValue({
                        ...value,
                        attrs: { ...value.attrs, [field]: listInput(event.target.value) },
                      })
                    }
                    onBlur={() => void save('attrs')}
                  />
                </label>
              ),
            )}
          </>
        )}
        {element.kind === 'location' && (
          <>
            {(['spaceType', 'eraRegion', 'layout', 'colorsMaterials', 'notes'] as const).map(
              (field, index) => (
                <label key={field} className="grid gap-1 text-sm">
                  {['空间类型', '时代／地域', '空间布局', '色彩与材质', '补充说明'][index]}
                  <Textarea
                    maxLength={field === 'spaceType' || field === 'eraRegion' ? 200 : 2000}
                    value={LocationProfile.parse(value.attrs)[field] ?? ''}
                    onChange={(event) =>
                      setValue({ ...value, attrs: { ...value.attrs, [field]: event.target.value } })
                    }
                    onBlur={() => void save('attrs')}
                  />
                </label>
              ),
            )}
            {(['visualAnchors', 'signatureFurnishings'] as const).map((field, index) => (
              <label key={field} className="grid gap-1 text-sm">
                {['视觉锚点', '标志陈设'][index]}（每行一项）
                <Textarea
                  maxLength={20000}
                  value={(LocationProfile.parse(value.attrs)[field] ?? []).join('\n')}
                  onChange={(event) =>
                    setValue({
                      ...value,
                      attrs: { ...value.attrs, [field]: listInput(event.target.value) },
                    })
                  }
                  onBlur={() => void save('attrs')}
                />
              </label>
            ))}
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
                  key={`${hit.beatId ?? hit.sceneId}-${index}`}
                  to="/projects/$projectId/episodes/$episodeId"
                  params={{ projectId, episodeId: episode.id }}
                  search={{ block: hit.beatId ?? hit.sceneId }}
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
              setMergeTarget(event.target.value);
              setMergeChoices({});
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
        {merging && target && (
          <div className="grid gap-3 rounded-md border p-3 text-sm">
            <p>合并到 {target.name}。请选择需要保留的资料；原名称将成为别名，正文保留原词。</p>
            {[
              ...new Set([
                ...Object.keys(target.attrs),
                ...Object.keys(value.attrs),
                'description',
              ]),
            ].map((field) => {
              const sourceValue =
                field === 'description' ? value.description : attribute(value.attrs, field);
              const targetValue =
                field === 'description' ? target.description : attribute(target.attrs, field);
              const labels: Record<string, string> = {
                description: '描述',
                age: '年龄',
                gender: '性别',
                appearance: '外貌锚点',
                personality: '性格标签',
                signatureActions: '标志动作',
                signatureProps: '标志道具',
                spaceType: '空间类型',
                eraRegion: '时代／地域',
                layout: '空间布局',
                visualAnchors: '视觉锚点',
                colorsMaterials: '色彩与材质',
                signatureFurnishings: '标志陈设',
                notes: '补充说明',
              };
              return (
                <label key={field} className="grid gap-1">
                  {labels[field] ?? field}
                  <NativeSelect
                    aria-label={`合并保留${labels[field] ?? field}`}
                    value={mergeChoices[field] ?? 'target'}
                    onChange={(event) =>
                      setMergeChoices({
                        ...mergeChoices,
                        [field]: event.target.value === 'source' ? 'source' : 'target',
                      })
                    }
                  >
                    <option value="target">
                      保留 {target.name}：{fieldDisplay(targetValue)}
                    </option>
                    <option value="source">
                      采用 {value.name}：{fieldDisplay(sourceValue)}
                    </option>
                  </NativeSelect>
                </label>
              );
            })}
            <Button
              disabled={busy}
              onClick={() => {
                const attrs: Record<string, unknown> = Object.fromEntries(
                  [...new Set([...Object.keys(target.attrs), ...Object.keys(value.attrs)])]
                    .map((field): [string, unknown] => [
                      field,
                      attribute(
                        mergeChoices[field] === 'source' ? value.attrs : target.attrs,
                        field,
                      ),
                    ])
                    .filter(([, entry]) => entry !== undefined),
                );
                void action(`elements/${element.id}/merge`, 'POST', {
                  into: target.id,
                  attrs,
                  description:
                    mergeChoices.description === 'source' ? value.description : target.description,
                });
              }}
            >
              确认合并
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setMergeTarget('');
                setMerging(false);
              }}
            >
              取消合并
            </Button>
          </div>
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

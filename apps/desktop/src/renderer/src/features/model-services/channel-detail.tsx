import { useRef, useState } from 'react';
import { z } from 'zod';
import { ArrowLeft, Plus, Download, Upload } from 'lucide-react';
import { Channel, Model, ModelExport, ModelWrite, type ModelKind } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Switch } from '@frame-loom/ui/components/switch';
import { Input } from '@frame-loom/ui/components/input';
import { NativeSelect } from '@frame-loom/ui/components/native-select';
import type { EngineClient } from '@/lib/engine-client';
import { kindLabels } from './labels';
import { ModelRow } from './model-row';
import { ConfirmDialog, ErrorMessage } from './form-fields';

export function ChannelDetail({
  client,
  channel,
  models,
  highlighted,
  onBack,
  onEdit,
  onCatalog,
  onModel,
  onTest,
  onRefresh,
  onDeleted,
}: {
  client: EngineClient;
  channel: Channel;
  models: Model[];
  highlighted: string[];
  onBack: () => void;
  onEdit: () => void;
  onCatalog: () => void;
  onModel: (model?: Model, copy?: boolean) => void;
  onTest: (model: Model) => void;
  onRefresh: () => Promise<void>;
  onDeleted: () => void;
}) {
  const [filter, setFilter] = useState<ModelKind | 'all'>('all');
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [incoming, setIncoming] = useState<ModelExport>();
  const [issues, setIssues] = useState<string[]>([]);
  const file = useRef<HTMLInputElement>(null);
  async function act(work: () => Promise<unknown>) {
    setError('');
    try {
      await work();
      await onRefresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '操作失败');
    }
  }
  async function exportModel(model: Model) {
    await act(async () => {
      const data = await client.request(`/models/${model.id}/export`, ModelExport);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'model.json';
      link.click();
      URL.revokeObjectURL(url);
    });
  }
  async function preview(selected?: File) {
    if (!selected) return;
    await act(async () => {
      if (selected.size > 256 * 1024) throw new Error('模型配置文件超过 256KB');
      const data = ModelExport.parse(JSON.parse(await selected.text()));
      const result = await client.request(
        `/channels/${channel.id}/models/import`,
        z.object({
          model: ModelWrite,
          issues: z.array(z.object({ field: z.string(), message: z.string() })),
        }),
        { method: 'POST', body: data },
      );
      setIncoming(data);
      setIssues(result.issues.map((issue) => `${issue.field}：${issue.message}`));
    });
  }
  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          模型服务 / {channel.name}
        </Button>
        <div className="flex items-center gap-2">
          <Switch
            aria-label={`启用渠道 ${channel.name}`}
            checked={channel.enabled}
            onCheckedChange={(enabled) =>
              void act(() =>
                client.request(`/channels/${channel.id}`, Channel, {
                  method: 'PATCH',
                  body: { enabled },
                }),
              )
            }
          />
          <Button variant="outline" size="sm" onClick={onEdit}>
            编辑渠道
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
            删除
          </Button>
        </div>
      </header>
      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <h2 className="font-semibold">{channel.name}</h2>
        <p className="mt-2 font-mono text-xs break-all text-muted-foreground">{channel.baseUrl}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Key {channel.keyHint ?? '未设置'} · {channel.catalogFormat} · 并发 {channel.concurrency}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <NativeSelect
          aria-label="筛选类别"
          value={filter}
          onChange={(event) => setFilter(event.target.value as ModelKind | 'all')}
        >
          <option value="all">全部</option>
          {Object.entries(kindLabels).map(([kind, label]) => (
            <option key={kind} value={kind}>
              {label}
            </option>
          ))}
        </NativeSelect>
        <Input
          aria-label="搜索模型"
          placeholder="搜索显示名或上游 ID"
          className="min-w-32 flex-1"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button size="sm" variant="outline" onClick={onCatalog}>
          <Download aria-hidden="true" />
          读取模型
        </Button>
        <Button size="sm" onClick={() => onModel()}>
          <Plus aria-hidden="true" />
          手动添加
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="导入模型 JSON"
          onClick={() => file.current?.click()}
        >
          <Upload aria-hidden="true" />
        </Button>
        <input
          ref={file}
          type="file"
          aria-label="选择模型 JSON 文件"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            void preview(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>
      <ErrorMessage error={error} />
      <div className="space-y-3">
        {models
          .filter(
            (model) =>
              (filter === 'all' || model.kind === filter) &&
              `${model.displayName} ${model.upstreamModelId}`
                .toLowerCase()
                .includes(search.toLowerCase()),
          )
          .map((model) => (
            <ModelRow
              key={model.id}
              model={model}
              highlight={highlighted.includes(model.id)}
              onEdit={() => onModel(model)}
              onCopy={() => onModel(model, true)}
              onDelete={() =>
                void act(() =>
                  client.request(`/models/${model.id}`, z.object({ deleted: z.boolean() }), {
                    method: 'DELETE',
                  }),
                )
              }
              onToggle={() =>
                void act(() =>
                  client.request(`/models/${model.id}`, Model, {
                    method: 'PUT',
                    body: {
                      ...Object.fromEntries(
                        Object.entries(model).filter(([key]) => key in ModelWrite.shape),
                      ),
                      enabled: !model.enabled,
                    },
                  }),
                )
              }
              onTest={() => onTest(model)}
              onExport={() => void exportModel(model)}
              onImport={() => file.current?.click()}
            />
          ))}
        {!models.length && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            还没有模型，读取列表或手动添加。
          </p>
        )}
      </div>
      {deleting && (
        <ConfirmDialog
          title="删除渠道？"
          description={`将同时删除 ${models.length} 个模型，已生成的资产不受影响`}
          confirmLabel="删除"
          onClose={() => setDeleting(false)}
          onConfirm={() => {
            setDeleting(false);
            void act(async () => {
              await client.request(
                `/channels/${channel.id}`,
                z.object({ deleted: z.boolean(), models: z.number() }),
                { method: 'DELETE' },
              );
              onDeleted();
            });
          }}
        />
      )}
      {incoming && (
        <ConfirmDialog
          title="导入到此渠道"
          description={
            <div>
              <p>{incoming.model.displayName}</p>
              {issues.length ? (
                issues.map((issue) => <p key={issue}>{issue}</p>)
              ) : (
                <p>配置校验通过。导入后的模型默认禁用，请核对地址后启用。</p>
              )}
            </div>
          }
          onClose={() => setIncoming(undefined)}
          onConfirm={() =>
            void act(async () => {
              const preview = await client.request(
                `/channels/${channel.id}/models/import`,
                z.object({ model: ModelWrite, issues: z.array(z.unknown()) }),
                { method: 'POST', body: incoming },
              );
              if (preview.issues.length) throw new Error('请先修正导入配置问题');
              await client.request(`/channels/${channel.id}/models`, Model.array(), {
                method: 'POST',
                body: [preview.model],
              });
              setIncoming(undefined);
            })
          }
        />
      )}
    </section>
  );
}

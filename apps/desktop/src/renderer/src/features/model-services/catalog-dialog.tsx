import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CatalogCandidate,
  Model,
  ModelWrite,
  type Channel,
  type ModelKind,
} from '@frame-loom/contracts';
import { emptyCapability, getProtocol, resolveCatalogUrl } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Input } from '@frame-loom/ui/components/input';
import { Checkbox } from '@frame-loom/ui/components/checkbox';
import { NativeSelect } from '@frame-loom/ui/components/native-select';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@frame-loom/ui/components/dialog';
import type { EngineClient } from '@/lib/engine-client';
import { kindLabels } from './labels';
import { ErrorMessage } from './form-fields';

export function CatalogDialog({
  client,
  channel,
  models,
  onClose,
  onAdded,
}: {
  client: EngineClient;
  channel: Channel;
  models: Model[];
  onClose: () => void;
  onAdded: (ids: string[]) => Promise<void>;
}) {
  const catalog = useQuery({
    queryKey: ['models', 'catalog', channel.id, channel.baseUrl, channel.catalogFormat],
    queryFn: ({ signal }) =>
      client.request('/channels/catalog', CatalogCandidate.array(), {
        method: 'POST',
        body: {
          channelId: channel.id,
          baseUrl: channel.baseUrl,
          catalogFormat: channel.catalogFormat,
        },
        signal,
      }),
    staleTime: 0,
  });
  const [search, setSearch] = useState('');
  const [kinds, setKinds] = useState<Record<string, ModelKind>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rows = (catalog.data ?? []).filter((row) =>
    row.id.toLowerCase().includes(search.toLowerCase()),
  );
  const added = (id: string) => models.some((model) => model.upstreamModelId === id);
  async function add() {
    setBusy(true);
    setError('');
    try {
      const body = selected.map((id) => {
        const row = catalog.data!.find((row) => row.id === id)!;
        const kind = kinds[id] ?? row.kind!;
        const descriptor = row.protocolId ? getProtocol(row.protocolId) : undefined;
        const protocolId = descriptor?.kinds.includes(kind) ? descriptor.id : null;
        return ModelWrite.parse({
          upstreamModelId: id,
          displayName: id,
          kind,
          protocolId,
          capability: protocolId ? descriptor!.templates[kind] : emptyCapability(kind),
          extras: protocolId ? descriptor!.defaultExtras : [],
          enabled: !!protocolId,
        });
      });
      const saved = await client.request(`/channels/${channel.id}/models`, Model.array(), {
        method: 'POST',
        body,
      });
      await onAdded(saved.map((model) => model.id));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '模型添加失败');
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
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle>读取模型</DialogTitle>
        <DialogDescription className="break-all">
          模型列表地址：{resolveCatalogUrl(channel.baseUrl, channel.catalogFormat)}
        </DialogDescription>
        {catalog.isPending && (
          <p role="status">正在请求 {resolveCatalogUrl(channel.baseUrl, channel.catalogFormat)}</p>
        )}
        <ErrorMessage error={catalog.error ?? error} />
        <div className="flex gap-2">
          <Input
            aria-label="搜索候选模型"
            placeholder="搜索模型 ID"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button
            variant="outline"
            onClick={() =>
              setSelected(
                rows
                  .filter((row) => !added(row.id) && (kinds[row.id] ?? row.kind))
                  .map((row) => row.id),
              )
            }
          >
            全选未添加
          </Button>
        </div>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {rows.map((row) => {
            const kind = kinds[row.id] ?? row.kind;
            const existing = added(row.id);
            return (
              <div
                key={row.id}
                className="flex items-center gap-3 rounded-lg border border-border p-3"
              >
                <Checkbox
                  aria-label={`选择 ${row.id}`}
                  disabled={existing || !kind}
                  checked={selected.includes(row.id)}
                  onCheckedChange={(value) =>
                    setSelected(
                      value === true
                        ? [...selected, row.id]
                        : selected.filter((id) => id !== row.id),
                    )
                  }
                />
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={row.id}>
                  {row.id}
                </span>
                <NativeSelect
                  className="w-24 shrink-0"
                  aria-label={`${row.id} 类别`}
                  disabled={existing}
                  value={kind ?? ''}
                  onChange={(event) => {
                    setKinds({ ...kinds, [row.id]: event.target.value as ModelKind });
                    setSelected(selected.filter((id) => id !== row.id));
                  }}
                >
                  <option value="" disabled>
                    请选择
                  </option>
                  {Object.entries(kindLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
                <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                  {existing
                    ? '已添加'
                    : row.protocolId && kind && getProtocol(row.protocolId)?.kinds.includes(kind)
                      ? getProtocol(row.protocolId)?.label
                      : '待选协议'}
                </span>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={busy || !selected.length} onClick={() => void add()}>
            添加所选 ({selected.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

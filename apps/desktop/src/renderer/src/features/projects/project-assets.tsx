import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { FolderPlus, Upload } from 'lucide-react';
import { AssetEntry, EntryName } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Input } from '@frame-loom/ui/components/input';
import { ToggleGroup, ToggleGroupItem } from '@frame-loom/ui/components/toggle-group';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@frame-loom/ui/components/dialog';
import type { EngineClient } from '@/lib/engine-client';
import { revealProject, setPreferences, trashProject } from '@/lib/desktop-bridge';
import { preferencesQuery } from '@/lib/project-queries';
import { AssetBrowser } from './asset-browser';
import { assetQueryKey } from './asset-utils';
import { createUploadQueue } from './upload-queue';

export function ProjectAssets({
  client,
  projectId,
  path,
  onPathChange,
}: {
  client: EngineClient;
  projectId: string;
  path: string;
  onPathChange: (path: string) => void;
}) {
  const queryClient = useQueryClient();
  const preferences = useQuery(preferencesQuery());
  const [action, setAction] = useState<{
    kind: 'folder' | 'rename' | 'move' | 'delete';
    entry?: AssetEntry;
  } | null>(null);
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const queue = useMemo(
    () =>
      createUploadQueue(
        (task, signal, onUploadProgress) =>
          client.request(
            `/projects/${projectId}/assets/files?${new URLSearchParams({ path: task.path, name: task.file.name })}`,
            AssetEntry,
            { method: 'POST', body: task.file, signal, onUploadProgress, timeoutMs: 120_000 },
          ),
        () => {
          void queryClient.invalidateQueries({ queryKey: assetQueryKey(projectId) });
        },
      ),
    [client, projectId, queryClient],
  );
  const tasks = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  useBlocker({
    shouldBlockFn: ({ current, next }) =>
      current.pathname !== next.pathname &&
      queue.pending() &&
      !window.confirm('还有文件正在上传，离开将取消未完成的上传，是否离开？'),
    enableBeforeUnload: () => queue.pending(),
  });
  useEffect(() => {
    queue.start();
    return () => queue.dispose();
  }, [queue]);
  const layout = useMutation({
    mutationFn: (value: { assetView: 'list' | 'grid' }) => setPreferences(value),
    onSuccess: (value) => queryClient.setQueryData(preferencesQuery().queryKey, value),
  });
  function add(files: File[]) {
    const accepted = files.filter((file) => !file.webkitRelativePath);
    if (accepted.length !== files.length) setNotice('暂不支持上传文件夹');
    queue.add(accepted, path);
  }
  return (
    <div aria-label="项目资产内容" className="space-y-5">
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          className="h-16 flex-1 justify-start rounded-xl bg-card px-5"
          onClick={() => setAction({ kind: 'folder' })}
        >
          <FolderPlus aria-hidden />
          新建文件夹
        </Button>
        <Button
          variant="outline"
          className="h-16 flex-1 justify-start rounded-xl bg-card px-5"
          onClick={() => input.current?.click()}
        >
          <Upload aria-hidden />
          上传文件
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          aria-label="上传项目文件"
          className="hidden"
          onChange={(event) => {
            add([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
      </div>
      <div className="flex justify-end">
        <ToggleGroup
          type="single"
          aria-label="资产布局"
          value={preferences.data?.assetView ?? 'list'}
          disabled={layout.isPending}
          onValueChange={(value) => {
            if (value) layout.mutate({ assetView: value as 'list' | 'grid' });
          }}
        >
          <ToggleGroupItem value="list" aria-label="列表视图">
            列表
          </ToggleGroupItem>
          <ToggleGroupItem value="grid" aria-label="宫格视图">
            宫格
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {layout.error && <p role="alert">{layout.error.message}</p>}
      {notice && <p role="status">{notice}</p>}
      <div
        className={dragging ? 'rounded-xl outline-2 outline-ring' : ''}
        onDragOver={(event) => {
          if (![...event.dataTransfer.types].includes('Files')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const files: File[] = [];
          for (const item of Array.from(event.dataTransfer.items)) {
            if (item.webkitGetAsEntry?.()?.isDirectory) {
              setNotice('暂不支持上传文件夹');
              continue;
            }
            const file = item.getAsFile();
            if (file) files.push(file);
          }
          if (!event.dataTransfer.items.length) files.push(...event.dataTransfer.files);
          add(files);
        }}
      >
        <AssetBrowser
          client={client}
          projectId={projectId}
          path={path}
          onPathChange={onPathChange}
          view={preferences.data?.assetView}
          onAction={(kind, entry) => {
            if (kind === 'reveal')
              void revealProject({ projectId, path: entry.path }).catch((error: unknown) =>
                setNotice(error instanceof Error ? error.message : '无法显示文件'),
              );
            else setAction({ kind, entry });
          }}
        />
      </div>
      {!!tasks.length && (
        <section aria-label="上传队列" className="space-y-2 rounded-xl border bg-card p-4">
          {tasks.map((task) => (
            <div key={task.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{task.name ?? task.file.name}</span>
              <span role="status">
                {task.status === 'done'
                  ? '已完成'
                  : task.status === 'cancelled'
                    ? '已取消'
                    : (task.error ?? (task.status === 'queued' ? '等待上传' : `${task.progress}%`))}
              </span>
              {(task.status === 'queued' || task.status === 'uploading') && (
                <Button size="sm" variant="ghost" onClick={() => queue.cancel(task.id)}>
                  取消
                </Button>
              )}
              {(task.status === 'error' || task.status === 'cancelled') && (
                <Button size="sm" variant="ghost" onClick={() => queue.retry(task.id)}>
                  重试
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
      {action && (
        <AssetActionDialog
          client={client}
          projectId={projectId}
          path={path}
          action={action}
          onClose={() => setAction(null)}
        />
      )}
    </div>
  );
}

function AssetActionDialog({
  client,
  projectId,
  path,
  action,
  onClose,
}: {
  client: EngineClient;
  projectId: string;
  path: string;
  action: { kind: 'folder' | 'rename' | 'move' | 'delete'; entry?: AssetEntry };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(action.entry?.name ?? '');
  const [destination, setDestination] = useState('');
  const title = { folder: '新建文件夹', rename: '重命名资产', move: '移动到…', delete: '删除资产' }[
    action.kind
  ];
  const parsed = EntryName.safeParse(name.trim());
  const mutation = useMutation({
    mutationFn: async () => {
      if (action.kind === 'delete') await trashProject({ projectId, path: action.entry!.path });
      else
        await client.request(
          `/projects/${projectId}/assets${action.kind === 'folder' ? '/folders' : action.kind === 'move' ? '/move' : ''}`,
          AssetEntry,
          {
            method: action.kind === 'rename' ? 'PATCH' : 'POST',
            body:
              action.kind === 'folder'
                ? { path, name: name.trim() }
                : action.kind === 'move'
                  ? { path: action.entry!.path, destination }
                  : { path: action.entry!.path, name: name.trim() },
          },
        );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: assetQueryKey(projectId) });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {action.kind === 'delete'
              ? `「${action.entry?.name}」将移到回收站。`
              : '在项目文件夹中组织资产。'}
          </DialogDescription>
        </DialogHeader>
        {action.kind === 'move' ? (
          <AssetBrowser
            client={client}
            projectId={projectId}
            path={destination}
            onPathChange={setDestination}
            mode="directory"
            excluded={action.entry?.type === 'directory' ? action.entry.path : undefined}
            onChoose={(entry) => setDestination(entry.path)}
          />
        ) : (
          action.kind !== 'delete' && (
            <label className="space-y-2 text-sm">
              名称
              <Input
                aria-label="资产名称"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              {name && !parsed.success && (
                <span role="alert" className="text-destructive">
                  {parsed.error.issues[0].message}
                </span>
              )}
            </label>
          )
        )}
        {mutation.error && (
          <p role="alert" className="text-destructive">
            {mutation.error.message}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={mutation.isPending} onClick={onClose}>
            取消
          </Button>
          <Button
            variant={action.kind === 'delete' ? 'destructive' : 'default'}
            disabled={
              mutation.isPending ||
              ((action.kind === 'folder' || action.kind === 'rename') && !parsed.success)
            }
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? '处理中…' : action.kind === 'delete' ? '移到回收站' : '确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

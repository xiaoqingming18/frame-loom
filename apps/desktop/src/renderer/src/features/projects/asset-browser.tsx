import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { File, Folder, MoreHorizontal, RefreshCw } from 'lucide-react';
import { AssetListResult, AssetSearchResult, type AssetEntry } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Input } from '@frame-loom/ui/components/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@frame-loom/ui/components/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@frame-loom/ui/components/dialog';
import type { EngineClient } from '@/lib/engine-client';

import { assetUrl, assetQueryKey, canChooseDirectory } from './asset-utils';

/** 资产页和画布选择器共用目录、搜索及媒体筛选，目录始终可进入。 */
export function AssetBrowser({
  client,
  projectId,
  path,
  onPathChange,
  view = 'list',
  mode = 'browse',
  excluded,
  onChoose,
  onAction,
}: {
  client: EngineClient;
  projectId: string;
  path: string;
  onPathChange: (path: string) => void;
  view?: 'list' | 'grid';
  mode?: 'browse' | 'media' | 'image' | 'directory';
  excluded?: string;
  onChoose?: (entry: AssetEntry) => void;
  onAction?: (kind: 'rename' | 'move' | 'reveal' | 'delete', entry: AssetEntry) => void;
}) {
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<AssetEntry | null>(null);
  const query = search.trim();
  const entries = useQuery({
    queryKey: [...assetQueryKey(projectId), path, query],
    queryFn: async ({ signal }) =>
      query
        ? client.request(
            `/projects/${projectId}/assets/search?q=${encodeURIComponent(query)}`,
            AssetSearchResult,
            { signal },
          )
        : {
            entries: await client.request(
              `/projects/${projectId}/assets?path=${encodeURIComponent(path)}`,
              AssetListResult,
              { signal },
            ),
            truncated: false,
          },
    refetchOnWindowFocus: 'always',
  });
  const visible = entries.data?.entries.filter(
    (entry) =>
      entry.type === 'directory' ||
      mode === 'browse' ||
      (mode === 'image'
        ? entry.mediaKind === 'image'
        : mode === 'media' && (entry.mediaKind === 'image' || entry.mediaKind === 'video')),
  );
  function open(entry: AssetEntry) {
    if (entry.type === 'directory') {
      setSearch('');
      onPathChange(entry.path);
    } else if (mode !== 'browse') onChoose?.(entry);
    else if (entry.mediaKind) setPreview(entry);
  }
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="资产目录" className="flex min-w-0 flex-1 flex-wrap items-center text-sm">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('');
              onPathChange('');
            }}
          >
            全部文件
          </Button>
          {path
            .split('/')
            .filter(Boolean)
            .map((part, index, parts) => (
              <span key={index} className="flex min-w-0 items-center">
                <span aria-hidden>/</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="max-w-36 truncate"
                  onClick={() => {
                    setSearch('');
                    onPathChange(parts.slice(0, index + 1).join('/'));
                  }}
                >
                  {part}
                </Button>
              </span>
            ))}
        </nav>
        <Input
          aria-label="搜索项目资产"
          placeholder="搜索整个项目"
          maxLength={200}
          className="w-44"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="刷新资产"
          onClick={() => void entries.refetch()}
        >
          <RefreshCw aria-hidden />
        </Button>
      </div>
      {mode === 'directory' && (
        <Button
          variant="outline"
          disabled={!canChooseDirectory(path, excluded)}
          onClick={() =>
            onChoose?.({
              name: path.split('/').at(-1) || '全部文件',
              path,
              type: 'directory',
              bytes: 0,
              updatedAt: new Date().toISOString(),
              mediaKind: null,
            })
          }
        >
          选择当前文件夹
        </Button>
      )}
      {entries.isPending && <p role="status">正在读取资产…</p>}
      {entries.error && (
        <p role="alert" className="text-destructive">
          {entries.error.message}
        </p>
      )}
      {entries.data?.truncated && (
        <p role="status" className="text-muted-foreground">
          结果超过上限，请缩小搜索范围。
        </p>
      )}
      {visible?.length === 0 && (
        <div className="grid min-h-48 place-content-center rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {query ? '没有匹配的资产' : '此文件夹为空，可将文件拖到这里上传'}
        </div>
      )}
      <div
        role="list"
        aria-label="项目资产列表"
        className={
          view === 'grid'
            ? 'grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3'
            : 'space-y-1'
        }
      >
        {view === 'list' && !!visible?.length && (
          <div aria-hidden className="flex gap-3 border-b px-3 pb-2 text-xs text-muted-foreground">
            <span className="flex-1">名称</span>
            <span className="hidden w-32 lg:block">修改时间</span>
            <span className="w-16">大小</span>
            <span className="w-16">类型</span>
            <span className="w-8" />
          </div>
        )}
        {visible?.map((entry) => (
          <div
            role="listitem"
            key={entry.path}
            className={
              view === 'grid'
                ? 'relative min-w-0 rounded-xl border bg-card p-3'
                : 'flex min-w-0 items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent'
            }
          >
            <button
              type="button"
              aria-label={entry.name}
              disabled={entry.type === 'directory' && !canChooseDirectory(entry.path, excluded)}
              onClick={() => open(entry)}
              className={
                view === 'grid'
                  ? 'block w-full min-w-0 text-left focus-visible:outline-2 focus-visible:outline-ring'
                  : 'flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-2 focus-visible:outline-ring'
              }
            >
              {view === 'grid' ? (
                <div className="mb-3 flex h-24 items-center justify-center overflow-hidden rounded-lg bg-muted">
                  {entry.mediaKind === 'image' ? (
                    <img
                      alt=""
                      src={assetUrl(projectId, entry.path)}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : entry.mediaKind === 'video' ? (
                    <video
                      aria-label="视频缩略图"
                      src={assetUrl(projectId, entry.path)}
                      muted
                      preload="metadata"
                      className="size-full object-cover"
                    />
                  ) : entry.type === 'directory' ? (
                    <Folder aria-hidden className="size-8 text-project-paper-icon" />
                  ) : (
                    <File aria-hidden className="size-8 text-muted-foreground" />
                  )}
                </div>
              ) : entry.type === 'directory' ? (
                <Folder aria-hidden className="size-5 shrink-0 text-project-paper-icon" />
              ) : (
                <File aria-hidden className="size-5 shrink-0 text-muted-foreground" />
              )}
              <span className="block min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{entry.name}</span>
                {query && (
                  <span className="block truncate text-xs text-muted-foreground">{entry.path}</span>
                )}
              </span>
            </button>
            {view === 'list' && (
              <>
                <span className="hidden w-32 text-xs text-muted-foreground lg:block">
                  {new Date(entry.updatedAt).toLocaleString('zh-CN')}
                </span>
                <span className="w-16 text-xs text-muted-foreground">
                  {entry.type === 'directory' ? '—' : `${(entry.bytes / 1024).toFixed(1)} KB`}
                </span>
                <span className="w-16 truncate text-xs text-muted-foreground">
                  {entry.type === 'directory' ? '文件夹' : (entry.mediaKind ?? '文件')}
                </span>
              </>
            )}
            {onAction && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${entry.name} 的菜单`}
                    className={view === 'grid' ? 'absolute top-3 right-3 bg-card' : ''}
                  >
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(['rename', 'move', 'reveal', 'delete'] as const).map((kind, index) => (
                    <DropdownMenuItem
                      key={kind}
                      variant={kind === 'delete' ? 'destructive' : 'default'}
                      onSelect={() => onAction(kind, entry)}
                    >
                      {['重命名', '移动到…', '在资源管理器中显示', '删除'][index]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ))}
      </div>
      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{preview?.name}</DialogTitle>
            <DialogDescription>项目资产预览</DialogDescription>
          </DialogHeader>
          {preview?.mediaKind === 'image' ? (
            <img
              alt={preview.name}
              src={assetUrl(projectId, preview.path)}
              className="max-h-[60vh] w-full object-contain"
            />
          ) : preview?.mediaKind === 'video' ? (
            <video
              aria-label={preview.name}
              src={assetUrl(projectId, preview.path)}
              controls
              className="max-h-[60vh] w-full"
            />
          ) : preview?.mediaKind === 'audio' ? (
            <audio
              aria-label={preview.name}
              src={assetUrl(projectId, preview.path)}
              controls
              className="w-full"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

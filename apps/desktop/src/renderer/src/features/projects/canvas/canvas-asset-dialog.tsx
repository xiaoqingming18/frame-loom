import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AssetEntry, EntryName, MediaFile } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Input } from '@frame-loom/ui/components/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@frame-loom/ui/components/dialog';
import type { EngineClient } from '@/lib/engine-client';
import { AssetBrowser } from '../asset-browser';
import { assetQueryKey } from '../asset-utils';
import type { CanvasAssetRequest } from './use-canvas-assets';

export function CanvasAssetDialog({
  client,
  projectId,
  request,
  onClose,
}: {
  client: EngineClient;
  projectId: string;
  request: CanvasAssetRequest;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [path, setPath] = useState('');
  const [name, setName] = useState(
    request.kind === 'save'
      ? (request.name ??
          `素材.${request.version.mime.split('/')[1].replace('jpeg', 'jpg').replace('quicktime', 'mov')}`)
      : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function choose(entry?: AssetEntry) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (request.kind === 'pick' && entry) {
        const media = await client.request(`/projects/${projectId}/media/from-asset`, MediaFile, {
          method: 'POST',
          body: { path: entry.path },
          timeoutMs: 120_000,
        });
        const kind = media.mime.startsWith('image/')
          ? 'image'
          : media.mime.startsWith('video/')
            ? 'video'
            : null;
        if (!kind || (request.mediaKind && kind !== request.mediaKind))
          throw new Error('此素材类型不适用于当前节点');
        request.resolve({
          kind,
          name: entry.name,
          version: {
            sha256: media.sha256,
            mime: media.mime,
            width: media.width,
            height: media.height,
            durationMs: media.durationMs,
            createdAt: new Date().toISOString(),
          },
        });
      } else if (request.kind === 'save') {
        await client.request(`/projects/${projectId}/assets/from-media`, AssetEntry, {
          method: 'POST',
          body: { sha256: request.version.sha256, path, name: name.trim() },
          timeoutMs: 120_000,
        });
        await queryClient.invalidateQueries({ queryKey: assetQueryKey(projectId) });
      }
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '资产操作失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{request.kind === 'pick' ? '从项目资产添加' : '保存到项目资产'}</DialogTitle>
          <DialogDescription>
            {request.kind === 'pick'
              ? '选择图片或视频，素材会复制到项目媒体库。'
              : '选择目标文件夹并填写文件名。'}
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={busy} className="min-w-0">
          <AssetBrowser
            client={client}
            projectId={projectId}
            path={path}
            onPathChange={setPath}
            mode={
              request.kind === 'save'
                ? 'directory'
                : request.mediaKind === 'image'
                  ? 'image'
                  : 'media'
            }
            onChoose={(entry) => {
              if (
                request.kind === 'pick' &&
                (!request.mediaKind || entry.mediaKind === request.mediaKind)
              )
                void choose(entry);
            }}
          />
        </fieldset>
        {request.kind === 'save' && (
          <label>
            文件名
            <Input
              aria-label="保存资产文件名"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            取消
          </Button>
          {request.kind === 'save' && (
            <Button
              disabled={busy || !EntryName.safeParse(name.trim()).success}
              onClick={() => void choose()}
            >
              {busy ? '保存中…' : '保存'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

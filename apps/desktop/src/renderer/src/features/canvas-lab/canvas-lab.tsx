import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { z } from 'zod';
import {
  CanvasRecord,
  CanvasSaveResult,
  ChannelList,
  ChannelModelList,
  EngineEvent,
  GenerationJob,
  MediaFile,
  ModelDefaults,
  ModelProfileList,
  ObjectStorageState,
} from '@frame-loom/contracts';
import { CanvasEditor, downloadCanvasDocument, type CanvasHost } from '@frame-loom/canvas';
import { Button } from '@frame-loom/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@frame-loom/ui/components/dialog';
import { EngineRequestError, type EngineClient } from '@/lib/engine-client';
import { commandWindow, onEngineExited } from '@/lib/desktop-bridge';
import { createCanvasPersistence } from './canvas-persistence';

const ViewSaved = z.strictObject({ saved: z.literal(true) });

/** 画布测试页：用 engine client 实现画布宿主接口，供人工验收。 */
export function CanvasLab({ engineClient }: { engineClient: EngineClient }) {
  const host = useMemo(
    () =>
      ({
        media: {
          upload: (file: Blob, signal?: AbortSignal) =>
            engineClient.request('/media', MediaFile, {
              method: 'POST',
              body: file,
              signal,
              timeoutMs: 120_000,
            }),
          url: (sha256: string) => `frame-media://${sha256}`,
        },
        generation: {
          load: async (signal) => {
            const [channels, models, defaults, profiles, storage] = await Promise.all([
              engineClient.request('/channels', ChannelList, { signal }),
              engineClient.request('/channel-models', ChannelModelList, { signal }),
              engineClient.request('/model-defaults', ModelDefaults, { signal }),
              engineClient.request('/model-profiles', ModelProfileList, { signal }),
              engineClient.request('/object-storage', ObjectStorageState, { signal }),
            ]);
            return {
              storageReady: !!storage?.hasSecret && !storage.secretNeedsUpdate,
              models: models
                .flatMap((model) => {
                  if (
                    !model.enabled ||
                    !channels.some(
                      (channel) => channel.id === model.channelId && channel.enabled,
                    ) ||
                    (model.kind !== 'image' && model.kind !== 'video')
                  )
                    return [];
                  const profile =
                    profiles
                      .filter(
                        (item) =>
                          item.kind === model.kind &&
                          item.protocol === model.protocol &&
                          (model.profileId
                            ? item.id === model.profileId
                            : item.matchIds.some((id) =>
                                model.kind === 'image'
                                  ? model.upstreamModelId.startsWith(id)
                                  : model.upstreamModelId === id,
                              )),
                      )
                      .sort((a, b) => {
                        const length = (item: typeof a) =>
                          Math.max(
                            0,
                            ...item.matchIds
                              .filter((id) => model.upstreamModelId.startsWith(id))
                              .map((id) => id.length),
                          );
                        return length(b) - length(a);
                      })[0] ??
                    profiles.find(
                      (item) =>
                        !model.profileId &&
                        item.protocol === model.protocol &&
                        item.kind === model.kind &&
                        item.generic,
                    ) ??
                    null;
                  return [
                    {
                      id: model.id,
                      label: model.displayName,
                      kind: model.kind,
                      profile,
                      preferred: defaults[model.kind] === model.id,
                    },
                  ];
                })
                .sort((a, b) => Number(b.preferred) - Number(a.preferred)),
            };
          },
          create: (request) =>
            engineClient.request('/generation-jobs', GenerationJob, {
              method: 'POST',
              body: request,
            }),
          get: (id, signal) =>
            engineClient.request('/generation-jobs/' + id, GenerationJob, { signal }),
          resubmit: (id) =>
            engineClient.request('/generation-jobs/' + id + '/resubmit', GenerationJob, {
              method: 'POST',
            }),
          cancel: (id) =>
            engineClient.request('/generation-jobs/' + id + '/cancel', GenerationJob, {
              method: 'POST',
            }),
          subscribe: (changed, signal) => {
            void (async () => {
              try {
                for await (const event of engineClient.stream('/events', EngineEvent, { signal }))
                  if (event.type === 'generation.job.updated') changed(event.jobId);
              } catch {
                /* 任务轮询继续兜底。 */
              }
            })();
          },
        },
        documents: {
          load: (id) => engineClient.request(`/canvases/${id}`, CanvasRecord.nullable()),
          save: (id, revision, document) =>
            engineClient.request(`/canvases/${id}`, CanvasSaveResult, {
              method: 'PUT',
              body: { revision, document },
            }),
          saveView: async (id, view) => {
            await engineClient.request(`/canvases/${id}/view`, ViewSaved, {
              method: 'PUT',
              body: view,
            });
          },
        },
      }) satisfies CanvasHost,
    [engineClient],
  );
  const persistence = useMemo(() => createCanvasPersistence(host.documents, 'lab'), [host]);
  const state = useSyncExternalStore(persistence.subscribe, persistence.getSnapshot);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const allowClose = useRef(false);
  const blocker = useBlocker({
    shouldBlockFn: useCallback(
      async ({ current, next }) =>
        current.pathname !== next.pathname && !(await persistence.flush()),
      [persistence],
    ),
    enableBeforeUnload: false,
    withResolver: true,
  });
  const exportDocument = () => downloadCanvasDocument(persistence.store.getState().document);

  useEffect(() => {
    persistence.start();
    let closing = false;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (window.document.activeElement instanceof HTMLElement)
        window.document.activeElement.blur();
      if (allowClose.current || !persistence.hasPendingChanges()) return;
      event.preventDefault();
      event.returnValue = '画布正在保存';
      if (closing) return;
      closing = true;
      void persistence
        .flush()
        .then(async (saved) => {
          closing = false;
          if (saved) await commandWindow('close');
          else setCloseBlocked(true);
        })
        .catch(persistence.fail);
    };
    window.addEventListener('beforeunload', beforeUnload);
    const unsubscribe = onEngineExited(() =>
      persistence.fail(
        new EngineRequestError(
          0,
          'CONNECTION_FAILED',
          '本地引擎已退出，画布内容仍保留，请导出 JSON 后重启应用',
        ),
      ),
    );
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      unsubscribe();
      persistence.stop();
    };
  }, [persistence]);

  function stay() {
    setCloseBlocked(false);
    if (blocker.status === 'blocked') blocker.reset();
  }
  async function leave(discard = false) {
    if (!discard && !(await persistence.flush())) return;
    if (closeBlocked) {
      allowClose.current = discard;
      try {
        await commandWindow('close');
      } catch (error) {
        allowClose.current = false;
        persistence.fail(error);
      }
    } else if (blocker.status === 'blocked') blocker.proceed();
  }

  const failed = state.status === 'error' || state.status === 'conflict';
  return (
    <section aria-label="画布测试" className="flex size-full flex-col">
      <header className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5 text-xs">
        <h1 className="font-medium">画布测试</h1>
        <span role="status" aria-label="画布保存状态" className="text-muted-foreground">
          {state.status === 'loading'
            ? '正在加载画布…'
            : state.status === 'saved'
              ? '已保存'
              : state.status === 'saving'
                ? '保存中…'
                : '保存失败'}
        </span>
        {failed && (
          <>
            <span role="alert" className="text-destructive">
              {state.message}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void (state.ready && state.status !== 'conflict'
                  ? persistence.flush()
                  : persistence.reload())
              }
            >
              {state.status === 'conflict' ? '重新加载' : '重试'}
            </Button>
            {state.ready && (
              <Button size="sm" variant="outline" onClick={exportDocument}>
                导出当前画布 JSON
              </Button>
            )}
          </>
        )}
      </header>
      <div className="min-h-0 flex-1">
        {state.ready && <CanvasEditor host={host} store={persistence.store} />}
      </div>
      <Dialog
        open={closeBlocked || blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open) stay();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>画布尚未保存</DialogTitle>
            <DialogDescription>
              保存失败，未保存的更改仍保留在当前画布。可以重试或先导出
              JSON；放弃更改后离开将丢失未保存内容。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-wrap">
            <Button variant="outline" onClick={exportDocument}>
              导出当前画布 JSON
            </Button>
            <Button variant="outline" onClick={stay}>
              留在画布
            </Button>
            <Button onClick={() => void leave()}>保存后离开</Button>
            <Button variant="destructive" onClick={() => void leave(true)}>
              放弃更改并离开
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

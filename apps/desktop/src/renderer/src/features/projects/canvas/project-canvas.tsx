import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useBlocker } from '@tanstack/react-router';
import { z } from 'zod';
import {
  ProjectPageRecord,
  ProjectPageSaveResult,
  ProjectMutationResult,
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
import { useQuery } from '@tanstack/react-query';
import { projectQuery } from '@/lib/project-queries';
import { useCanvasAssets } from './use-canvas-assets';

const ViewSaved = z.strictObject({ saved: z.literal(true) });

/** 项目宿主注入媒体、页面保存与资产选择能力。 */
export function ProjectCanvas({
  engineClient,
  projectId,
  pageId,
}: {
  engineClient: EngineClient;
  projectId: string;
  pageId: string;
}) {
  const project = useQuery(projectQuery(engineClient, projectId));
  const assets = useCanvasAssets(engineClient, projectId);
  const session = useMemo(() => {
    let opening: Promise<unknown> | undefined;
    let closing: Promise<unknown> | undefined;
    return {
      open: () =>
        (opening ??= engineClient
          .request(`/projects/${projectId}/sessions/open`, ProjectMutationResult, {
            method: 'POST',
          })
          .catch((error: unknown) => {
            opening = undefined;
            throw error;
          })),
      close: () =>
        (closing ??= (async () => {
          if (opening) await opening;
          await engineClient.request(
            `/projects/${projectId}/sessions/close`,
            ProjectMutationResult,
            { method: 'POST' },
          );
        })().catch((error: unknown) => {
          closing = undefined;
          throw error;
        })),
    };
  }, [engineClient, projectId]);
  const host = useMemo(
    () =>
      ({
        media: {
          upload: (file: Blob, signal?: AbortSignal) =>
            engineClient.request(`/projects/${projectId}/media`, MediaFile, {
              method: 'POST',
              body: file,
              signal,
              timeoutMs: 120_000,
            }),
          url: (sha256: string) => `frame-project://${projectId}/media/${sha256}`,
          adopt: (sha256) =>
            engineClient.request(
              `/projects/${projectId}/media/adopt`,
              z.object({ missing: z.array(z.string()) }),
              { method: 'POST', body: { sha256 } },
            ),
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
              body: { ...request, projectId, pageId },
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
          load: async (id) => {
            await session.open();
            return engineClient.request(`/projects/${projectId}/pages/${id}`, ProjectPageRecord);
          },
          save: (id, revision, document) =>
            engineClient.request(`/projects/${projectId}/pages/${id}`, ProjectPageSaveResult, {
              method: 'PUT',
              body: { revision, document },
            }),
          saveView: async (id, view) => {
            await engineClient.request(`/projects/${projectId}/pages/${id}/view`, ViewSaved, {
              method: 'PUT',
              body: view,
            });
          },
        },
        assets: assets.host,
      }) satisfies CanvasHost,
    [engineClient, projectId, pageId, assets.host, session],
  );
  const persistence = useMemo(
    () => createCanvasPersistence(host.documents, pageId),
    [host, pageId],
  );
  const state = useSyncExternalStore(persistence.subscribe, persistence.getSnapshot);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const allowClose = useRef(false);
  const blocker = useBlocker({
    shouldBlockFn: useCallback(
      async ({ current, next }) => {
        if (current.pathname === next.pathname) return false;
        if (!(await persistence.flush())) return true;
        try {
          await session.close();
          return false;
        } catch (error) {
          persistence.fail(error);
          return true;
        }
      },
      [persistence, session],
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
      if (allowClose.current) return;
      if (!persistence.hasPendingChanges()) {
        void session.close().catch(persistence.fail);
        return;
      }
      event.preventDefault();
      event.returnValue = '画布正在保存';
      if (closing) return;
      closing = true;
      void persistence
        .flush()
        .then(async (saved) => {
          closing = false;
          if (saved) {
            await session.close();
            allowClose.current = true;
            await commandWindow('close');
          } else setCloseBlocked(true);
        })
        .catch((error: unknown) => {
          closing = false;
          persistence.fail(error);
          setCloseBlocked(true);
        });
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
      void persistence
        .flush()
        .then((saved) => {
          if (saved) return session.close();
        })
        .catch(persistence.fail);
    };
  }, [persistence, session]);

  function stay() {
    setCloseBlocked(false);
    if (blocker.status === 'blocked') blocker.reset();
  }
  async function leave(discard = false) {
    if (!discard && !(await persistence.flush())) return;
    if (closeBlocked) {
      allowClose.current = true;
      try {
        try {
          await session.close();
        } catch (error) {
          if (!discard) throw error;
        }
        await commandWindow('close');
      } catch (error) {
        allowClose.current = false;
        persistence.fail(error);
      }
    } else if (blocker.status === 'blocked') {
      try {
        await session.close();
        blocker.proceed();
      } catch (error) {
        if (discard) blocker.proceed();
        else persistence.fail(error);
      }
    }
  }

  const failed = state.status === 'error' || state.status === 'conflict';
  return (
    <section aria-label="项目画布" className="flex size-full flex-col">
      <header className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5 text-xs">
        <nav aria-label="画布面包屑" className="flex min-w-0 items-center gap-2">
          <Link to="/projects" search={{}}>
            项目库
          </Link>
          <span aria-hidden>/</span>
          <Link
            to="/projects/$projectId"
            params={{ projectId }}
            search={{ tab: 'pages', path: '' }}
            className="max-w-32 truncate"
          >
            {project.data?.name ?? '项目'}
          </Link>
          <span aria-hidden>/</span>
          <h1 className="max-w-32 truncate font-medium">
            {project.data?.pages.find((page) => page.id === pageId)?.name ?? '创作页'}
          </h1>
        </nav>
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
      {assets.dialog}
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

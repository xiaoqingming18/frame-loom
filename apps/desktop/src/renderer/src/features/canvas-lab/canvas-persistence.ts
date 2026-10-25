import { createCanvasStore, DEFAULT_VIEW, type CanvasHost } from '@frame-loom/canvas';
import { emptyCanvasDocument, type CanvasDocument, type CanvasView } from '@frame-loom/contracts';
import { EngineRequestError } from '@/lib/engine-client';

type SaveState = {
  ready: boolean;
  status: 'loading' | 'saved' | 'saving' | 'error' | 'conflict';
  message?: string;
};

/** 宿主持有 revision 与保存队列，画布 store 只持有可编辑内容。 */
export function createCanvasPersistence(
  documents: NonNullable<CanvasHost['documents']>,
  id: string,
) {
  const store = createCanvasStore();
  let snapshot: SaveState = { ready: false, status: 'loading' };
  const listeners = new Set<() => void>();
  let revision = 0;
  let savedDocument: CanvasDocument = store.getState().document;
  let savedView: CanvasView = store.getState().view;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<boolean> | undefined;
  let unsubscribe: (() => void) | undefined;
  let loadId = 0;
  let conflicted = false;

  function update(next: SaveState) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }
  function dirty() {
    const state = store.getState();
    return state.document !== savedDocument || state.view !== savedView;
  }
  function fail(error: unknown) {
    if (error instanceof EngineRequestError && error.code === 'CANVAS_REVISION_CONFLICT')
      conflicted = true;
    update({
      ...snapshot,
      status: conflicted ? 'conflict' : 'error',
      message: error instanceof Error ? error.message : '画布保存失败，请重试或导出 JSON',
    });
  }
  async function reload() {
    const current = ++loadId;
    const wasReady = snapshot.ready;
    clearTimeout(timer);
    try {
      if (pending) await pending;
      if (current !== loadId) return;
      update({ ready: false, status: 'loading' });
      const record = await documents.load(id);
      if (current !== loadId) return;
      if (record) store.getState().reset(record.document, record.view ?? DEFAULT_VIEW);
      // 不存在的记录也替换为干净文档，避免把旧内容误当作远端基线。
      else store.getState().reset(emptyCanvasDocument(), DEFAULT_VIEW);
      revision = record?.revision ?? 0;
      savedDocument = store.getState().document;
      savedView = store.getState().view;
      conflicted = false;
      update({ ready: true, status: 'saved' });
    } catch (error) {
      if (current !== loadId) return;
      snapshot = { ...snapshot, ready: wasReady };
      fail(error);
    }
  }
  async function save() {
    try {
      while (dirty()) {
        const { document, view } = store.getState();
        update({ ready: true, status: 'saving' });
        if (document !== savedDocument || revision === 0) {
          const result = await documents.save(id, revision, document);
          revision = result.revision;
          savedDocument = document;
        }
        if (view !== savedView) {
          await documents.saveView(id, view);
          savedView = view;
        }
      }
      update({ ready: true, status: 'saved' });
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  }
  function flush(): Promise<boolean> {
    clearTimeout(timer);
    if (pending) return pending;
    if (!snapshot.ready) return Promise.resolve(true);
    if (conflicted) return Promise.resolve(false);
    if (!dirty()) {
      if (snapshot.status === 'saving') update({ ready: true, status: 'saved' });
      return Promise.resolve(true);
    }
    pending = save().finally(() => {
      pending = undefined;
    });
    return pending;
  }

  return {
    store,
    reload,
    flush,
    fail,
    hasPendingChanges: () => dirty() || Boolean(pending),
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      unsubscribe = store.subscribe((state, previous) => {
        if (
          !snapshot.ready ||
          conflicted ||
          (state.document === previous.document && state.view === previous.view)
        )
          return;
        clearTimeout(timer);
        update({ ready: true, status: 'saving' });
        timer = setTimeout(() => {
          void flush();
        }, 1000);
      });
      void reload();
    },
    stop() {
      ++loadId;
      clearTimeout(timer);
      unsubscribe?.();
    },
  };
}

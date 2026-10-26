import type { AssetEntry } from '@frame-loom/contracts';

export type AssetUpload = {
  id: number;
  file: File;
  path: string;
  status: 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';
  progress: number;
  name?: string;
  error?: string;
};

/** 取消请求真正结束后才释放并发槽，重试不会与旧请求重叠。 */
export function createUploadQueue(
  upload: (
    task: AssetUpload,
    signal: AbortSignal,
    progress: (value: number) => void,
  ) => Promise<AssetEntry>,
  changed: () => void,
) {
  let tasks: AssetUpload[] = [];
  let nextId = 0;
  let disposed = false;
  const running = new Map<number, AbortController>();
  const listeners = new Set<() => void>();
  const update = (id: number, value: Partial<AssetUpload>) => {
    tasks = tasks.map((task) => (task.id === id ? { ...task, ...value } : task));
    listeners.forEach((listener) => listener());
  };
  function pump() {
    if (disposed) return;
    for (const task of tasks) {
      if (running.size >= 2) break;
      if (task.status !== 'queued' || running.has(task.id)) continue;
      const controller = new AbortController();
      running.set(task.id, controller);
      update(task.id, { status: 'uploading', progress: 0, error: undefined });
      void upload(task, controller.signal, (progress) => {
        if (!controller.signal.aborted) update(task.id, { progress });
      })
        .then((entry) => {
          if (!controller.signal.aborted)
            update(task.id, { status: 'done', progress: 100, name: entry.name });
          changed();
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            update(task.id, {
              status: 'error',
              error: error instanceof Error ? error.message : '上传失败',
            });
        })
        .finally(() => {
          running.delete(task.id);
          pump();
        });
    }
  }
  return {
    getSnapshot: () => tasks,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    pending: () => tasks.some((task) => task.status === 'queued' || task.status === 'uploading'),
    add(files: File[], path: string) {
      if (disposed) return;
      tasks = [
        ...tasks,
        ...files.map((file): AssetUpload => ({
          id: ++nextId,
          file,
          path,
          status: 'queued',
          progress: 0,
        })),
      ];
      listeners.forEach((listener) => listener());
      pump();
    },
    cancel(id: number) {
      update(id, { status: 'cancelled' });
      running.get(id)?.abort();
      pump();
    },
    retry(id: number) {
      update(id, { status: 'queued' });
      pump();
    },
    dispose() {
      disposed = true;
      for (const controller of running.values()) controller.abort();
    },
  };
}

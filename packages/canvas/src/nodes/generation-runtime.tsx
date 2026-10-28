import { useEffect } from 'react';
import type { CanvasMediaData } from '@frame-loom/contracts';
import { useCanvas } from '../context';
import { isActiveGenerationJob, writeGenerationJob } from './generation-writeback';

export function GenerationRuntime() {
  const { host, store, registry } = useCanvas();
  const generation = host.generation;
  useEffect(() => {
    if (!generation) return;
    const controller = new AbortController();
    let refreshing = false;
    const refresh = async (changedId?: string) => {
      if (refreshing) return;
      refreshing = true;
      try {
        const state = store.getState();
        const documents = [
          state.document,
          ...state.past,
          ...state.future,
          ...(state.transaction ? [state.transaction] : []),
        ];
        const ids = new Set(
          documents.flatMap((document) =>
            document.nodes.flatMap((node) => {
              if (node.type !== 'image' && node.type !== 'video') return [];
              const ids = (node.data as CanvasMediaData | null)?.pendingJobIds ?? [];
              return ids.filter((id) => !changedId || id === changedId);
            }),
          ),
        );
        for (const id of ids) {
          let job;
          try {
            job = await generation.get(id, controller.signal);
          } catch (error) {
            if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
              store.getState().applySystem((document) => ({
                ...document,
                nodes: document.nodes.map((node) => {
                  if (node.type !== 'image' && node.type !== 'video') return node;
                  const data = node.data as CanvasMediaData;
                  return data.pendingJobIds?.includes(id)
                    ? {
                        ...node,
                        data: {
                          ...data,
                          pendingJobIds: data.pendingJobIds.filter((pending) => pending !== id),
                        },
                      }
                    : node;
                }),
              }));
            }
            // 网络错误保留任务；清库或导入带来的 404 同步清理当前文档及历史。
            continue;
          }
          if (controller.signal.aborted) return;
          const previous = store.getState().generationJobs.get(id);
          store.getState().setGenerationJob(job);
          if (isActiveGenerationJob(job) && !job.outputs.length) continue;
          if (
            previous?.status !== job.status &&
            (job.status === 'failed' || job.status === 'cancelled')
          )
            store.getState().notify(job.errorMessage ?? '生成任务已结束');
          store.getState().applySystem((document) => writeGenerationJob(document, job));
        }
      } catch {
        // 引擎断线时保留任务引用，供下次轮询或重新打开时恢复。
      } finally {
        refreshing = false;
      }
    };
    void generation
      .load(controller.signal)
      .then((config) => {
        registry.setGenerationModels(config.models);
        store.getState().setGenerationConfig(config);
      })
      .catch((error: unknown) =>
        store
          .getState()
          .setGenerationError(error instanceof Error ? error.message : '模型配置读取失败'),
      );
    void refresh();
    generation.subscribe((id) => void refresh(id), controller.signal);
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [generation, store, registry]);
  return null;
}

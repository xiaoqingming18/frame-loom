import type { CanvasMediaData } from '@frame-loom/contracts';
import { Loader2 } from 'lucide-react';
import { Button } from '@frame-loom/ui/components/button';
import { useCanvas, useCanvasState } from '../context';
import { isNodeLocked, updateData } from '../commands/commands';
import { writeGenerationJob } from './generation-writeback';

export function GenerationStatus({ nodeId, data }: { nodeId: string; data: CanvasMediaData }) {
  const { host, store } = useCanvas();
  const jobs = useCanvasState((state) => state.generationJobs);
  const submitting = useCanvasState((state) => state.generationSubmitting.has(nodeId));
  const locked = useCanvasState((state) => {
    const node = state.document.nodes.find((item) => item.id === nodeId);
    return !node || isNodeLocked(state.document, node);
  });
  const ids = data.pendingJobIds ?? [];
  const running = ids.filter((id) => jobs.get(id)?.status !== 'failed');
  const api = host.generation;
  if (!api || (!ids.length && !submitting)) return null;
  async function act(id: string, retry: boolean) {
    if (!api || locked || store.getState().generationSubmitting.has(nodeId)) return;
    store.getState().setGenerationSubmitting(nodeId, true);
    try {
      const job = await (retry ? api.resubmit(id) : api.cancel(id));
      store.getState().setGenerationJob(job);
      store.getState().applySystem((document) =>
        updateData<CanvasMediaData>(document, nodeId, (current) => ({
          ...current,
          pendingJobIds: retry
            ? current.pendingJobIds?.map((item) => (item === id ? job.id : item))
            : job.status === 'failed'
              ? current.pendingJobIds?.filter((item) => item !== id)
              : current.pendingJobIds,
        })),
      );
      store.getState().applySystem((document) => writeGenerationJob(document, job));
      if (!retry) store.getState().notify(job.errorMessage ?? '生成任务已结束');
    } catch (error) {
      store
        .getState()
        .notify(error instanceof Error ? error.message : retry ? '重试任务失败' : '放弃任务失败');
    } finally {
      store.getState().setGenerationSubmitting(nodeId, false);
    }
  }
  return (
    <div className="nodrag nopan nowheel absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-y-auto bg-card/90 p-3 text-center text-xs">
      {(running.length > 0 || submitting) && (
        <p role="status" className="flex items-center gap-2">
          <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
          生成中{' '}
          {submitting
            ? 1
            : Math.min(data.count ?? 1, Math.max(1, (data.count ?? 1) - ids.length + 1))}
          /{data.count ?? 1}
        </p>
      )}
      {ids.map((id, index) => {
        const job = jobs.get(id);
        return (
          <div key={id} className="space-y-1">
            {job?.errorMessage && (
              <p role="alert" className="text-destructive">
                {job.errorMessage}
              </p>
            )}
            {job?.status === 'submit_unknown' && (
              <p role="status">提交结果不明：远端可能已受理并计费</p>
            )}
            <div className="flex justify-center gap-1">
              {job?.status === 'failed' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={locked || submitting}
                  onClick={() => void act(id, true)}
                >
                  重试任务 {index + 1}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={locked || submitting}
                onClick={() => void act(id, false)}
              >
                放弃任务
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

import type { CanvasMediaData } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { GenerationAnimation } from './generation-animation';
import { useCanvas, useCanvasState } from '../context';
import { isNodeLocked, updateData } from '../commands/commands';
import { writeGenerationJob } from './generation-writeback';

export function GenerationStatus({ nodeId, data }: { nodeId: string; data: CanvasMediaData }) {
  const { host, store } = useCanvas();
  const jobs = useCanvasState((state) => state.generationJobs);
  const config = useCanvasState((state) => state.generationConfig);
  const submitting = useCanvasState((state) => state.generationSubmitting.has(nodeId));
  const locked = useCanvasState((state) => {
    const node = state.document.nodes.find((item) => item.id === nodeId);
    return !node || isNodeLocked(state.document, node);
  });
  const ids = data.pendingJobIds ?? [];
  const running = ids.filter((id) =>
    ['pending', 'submitting', 'running', 'downloading'].includes(jobs.get(id)?.status ?? 'pending'),
  );
  const kind = useCanvasState((state) => {
    const type = state.document.nodes.find((node) => node.id === nodeId)?.type;
    return type === 'video' || type === 'audio' ? type : 'image';
  });
  const active = running.length > 0 || submitting;
  const inlineCancel = active && ids.length === 1;
  const api = host.generation;
  if (!api || (!ids.length && !submitting)) return null;
  async function act(id: string, retry: boolean, remote = false) {
    if (!api || locked || store.getState().generationSubmitting.has(nodeId)) return;
    store.getState().setGenerationSubmitting(nodeId, true);
    try {
      const job = await (remote && api.cancelRemote
        ? api.cancelRemote(id)
        : retry
          ? api.resubmit(id)
          : api.cancel(id));
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
    <div
      className={`nodrag nopan nowheel ${active ? 'canvas-generation-active' : 'absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-y-auto bg-card/90 p-3 text-center text-xs'}`}
    >
      {active && (
        <>
          <GenerationAnimation kind={kind} />
          <div className="canvas-generation-tag">
            <p role="status">
              <span className="canvas-generation-dot" />
              <span>
                生成中
                {(data.count ?? 1) > 1 && (
                  <>
                    {' '}
                    {submitting
                      ? 1
                      : Math.min(data.count ?? 1, Math.max(1, (data.count ?? 1) - ids.length + 1))}
                    /{data.count ?? 1}
                  </>
                )}
              </span>
            </p>
            {inlineCancel && (
              <button
                type="button"
                className="canvas-generation-cancel"
                aria-label="放弃任务"
                disabled={locked || submitting}
                onClick={() => void act(ids[0], false)}
              >
                取消
              </button>
            )}
          </div>
        </>
      )}
      <div className={active ? 'canvas-generation-details' : 'space-y-2'}>
        {ids.map((id, index) => {
          const job = jobs.get(id);
          const retryAvailable =
            job?.recoveryAction !== 'new_job' ||
            job.kind !== 'video' ||
            config?.models.some((model) => model.id === job.modelId);
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
              {job?.status === 'paused' && (
                <p role="status">已暂停等待；恢复将继续原任务，不重新生成</p>
              )}
              {job?.status === 'download_failed' && (
                <p role="status">
                  {job.errorCode === 'EDIT_POSTPROCESS_FAILED'
                    ? '表情后处理失败；重试仅合成已保存的中间图'
                    : '下载失败；重试只下载已生成的产物'}
                </p>
              )}
              {!!job?.outputs.length && (
                <p>已归档 {job.outputs.length} 个产物；可用结果已写入版本</p>
              )}
              {job?.cancellation && job.cancellation !== 'confirmed' && (
                <p role="status">
                  {job.cancellation === 'unknown' ? '远端取消结果不明' : '已请求远端取消，尚未确认'}
                  ；可恢复查询确认。
                </p>
              )}
              {job?.remoteTaskId && (
                <p className="break-all text-muted-foreground">远端任务：{job.remoteTaskId}</p>
              )}
              {job?.diagnostic && (
                <details className="break-all text-muted-foreground">
                  <summary>错误详情</summary>
                  <p>
                    {job.diagnostic.stage} · {job.diagnostic.method} {job.diagnostic.route}
                  </p>
                  <p>
                    {job.errorCode} {job.diagnostic.httpStatus} {job.diagnostic.requestId}
                  </p>
                  {job.diagnostic.message && <p>{job.diagnostic.message}</p>}
                </details>
              )}
              {job?.recoveryAction === 'none' &&
                ['submit_unknown', 'paused'].includes(job.status) && (
                  <p>请先向供应商确认；当前无法安全恢复</p>
                )}
              <div className="flex justify-center gap-1">
                {job &&
                  retryAvailable &&
                  (job.recoveryAction
                    ? job.recoveryAction !== 'none'
                    : job.status === 'failed') && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={locked || submitting}
                      onClick={() => void act(id, true)}
                    >
                      {job.errorCode === 'EDIT_POSTPROCESS_FAILED'
                        ? '重试合成'
                        : job.recoveryAction === 'download'
                          ? '重试下载'
                          : job.recoveryAction === 'idempotent_submit'
                            ? '同键恢复提交'
                            : job.recoveryAction === 'prepare'
                              ? '恢复准备'
                              : job.recoveryAction === 'query'
                                ? '恢复查询'
                                : '重试任务'}{' '}
                      {index + 1}
                    </Button>
                  )}
                {job?.canCancelRemote && api.cancelRemote && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={locked || submitting}
                    onClick={() => void act(id, false, true)}
                  >
                    请求远端取消
                  </Button>
                )}
                {!inlineCancel && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={locked || submitting}
                    onClick={() => void act(id, false)}
                  >
                    放弃任务
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

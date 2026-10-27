import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ModelUpgradeReport, GenerationJob, DeleteResult } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import type { EngineClient } from '@/lib/engine-client';

export function ModelUpgradeNotice({ client }: { client: EngineClient }) {
  const queryClient = useQueryClient();
  const report = useQuery({
    queryKey: ['models', 'upgrade-report'],
    queryFn: ({ signal }) =>
      client.request('/model-upgrade-report', ModelUpgradeReport, { signal }),
    refetchInterval: (query) =>
      query.state.data?.some((entry) => entry.tasks.length) ? 5000 : false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState('');
  async function act(path: string, remove = false) {
    setBusy(true);
    setError('');
    try {
      if (remove) await client.request(path, DeleteResult, { method: 'DELETE' });
      else await client.request(path, GenerationJob, { method: 'POST' });
      await queryClient.invalidateQueries({ queryKey: ['models'] });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '处理失败');
    } finally {
      setBusy(false);
      setConfirm('');
    }
  }
  if (!report.data?.length) return null;
  return (
    <details className="space-y-3 rounded-lg border border-border p-3 text-xs">
      <summary>旧视频配置升级记录（{report.data.length} 项）</summary>
      <p className="mt-3 text-muted-foreground">
        以下绑定已停止新建，历史任务和文件保留。版本未确认项需核对供应商文档后，以有效定义重新绑定。本地放弃不代表远端取消。
      </p>
      {report.data.map((entry) => (
        <div key={entry.id} className="mt-3 space-y-2 border-t border-border pt-3">
          <p className="break-all">
            {entry.name} · {entry.upstreamModelId} ·{' '}
            {entry.reason === 'unconfirmed' ? '版本未确认，待处理' : '已退出'}
          </p>
          {!entry.bindingPresent && <p className="text-muted-foreground">已移除绑定</p>}
          {entry.reason === 'unconfirmed' && entry.bindingPresent && !entry.tasks.length && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                confirm === entry.id
                  ? void act(`/channel-models/${entry.id}`, true)
                  : setConfirm(entry.id)
              }
            >
              {confirm === entry.id ? '确认移除旧绑定' : '移除待处理绑定'}
            </Button>
          )}
          {entry.tasks.map((task) => (
            <div key={task.id} className="flex flex-wrap items-center gap-2">
              <span className="break-all">
                {task.id} · {task.status}
              </span>
              {task.canRecover && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    busy ||
                    ['pending', 'submitting', 'running', 'downloading'].includes(task.status)
                  }
                  onClick={() => void act(`/generation-jobs/${task.id}/requery`)}
                >
                  恢复查询／下载
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  confirm === task.id
                    ? void act(`/generation-jobs/${task.id}/cancel`)
                    : setConfirm(task.id)
                }
              >
                {confirm === task.id ? '确认本地放弃' : '本地放弃任务'}
              </Button>
            </div>
          ))}
        </div>
      ))}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </details>
  );
}

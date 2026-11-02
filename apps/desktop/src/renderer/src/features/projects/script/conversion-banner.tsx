import { useState } from 'react';
import { z } from 'zod';
import { ScriptImportResult, type ScriptResult } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import type { EngineClient } from '@/lib/engine-client';
const stages = {
  locating: '定位场次',
  parsing: '解析全文',
  validating: '校验原文',
  applying: '保存结果',
};
export function ConversionBanner({
  record,
  client,
  projectId,
  episodeId,
  revision,
  flush,
  changed,
  edit,
}: {
  record: ScriptResult;
  client: EngineClient;
  projectId: string;
  episodeId: string;
  revision: () => number;
  flush: () => Promise<boolean>;
  changed: () => Promise<void>;
  edit: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const state = record.conversion,
    running = state?.status === 'queued' || state?.status === 'running';
  async function action(cancel: boolean) {
    setBusy(true);
    setError('');
    try {
      const url = `/projects/${projectId}/episodes/${episodeId}/script/import`;
      if (cancel)
        await client.request(`${url}/cancel`, z.object({ saved: z.literal(true) }), {
          method: 'POST',
        });
      else {
        if (!(await flush())) throw new Error('请先处理草稿保存问题');
        await client.request(url, ScriptImportResult, {
          method: 'POST',
          body: { revision: revision() },
        });
      }
      await changed();
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  if (!state) return null;
  return (
    <div className="border-b px-4 py-2 text-sm" role="status">
      {running ? (
        <div className="flex items-center gap-3">
          <span>
            {state.status === 'queued' ? '排队中' : stages[state.stage ?? 'locating']} · 已完成{' '}
            {state.done} / {state.total} 批
          </span>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void action(true)}>
            取消解析
          </Button>
        </div>
      ) : state.status === 'succeeded' ? (
        <span>
          已解析 {state.result?.scenes} 场、{state.result?.beats} 条内容，新增{' '}
          {state.result?.addedElements} 个设定。{state.warnings.join('；')}
        </span>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span>{state.status === 'cancelled' ? '解析已取消' : `解析失败：${state.error}`}</span>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void action(false)}>
            重试失败批次
          </Button>
          <Button variant="ghost" size="sm" onClick={edit}>
            编辑原文
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

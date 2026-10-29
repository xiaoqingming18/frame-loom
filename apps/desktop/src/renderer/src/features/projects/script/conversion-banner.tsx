import { useState } from 'react';
import { z } from 'zod';
import { ScriptImportResult, type ScriptResult } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import type { EngineClient } from '@/lib/engine-client';
const stages = {
  split: '切分场次',
  classify: '识别段落类型',
  extract: '提取人物与场景',
  match: '匹配设定库',
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
  view,
  openedAt,
}: {
  record: ScriptResult;
  client: EngineClient;
  projectId: string;
  episodeId: string;
  revision: () => number;
  flush: () => Promise<boolean>;
  changed: () => Promise<void>;
  edit: () => void;
  view: () => void;
  openedAt: number;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const conversion = record.conversion;
  const running = conversion?.status === 'queued' || conversion?.status === 'running';
  async function action(mode: 'cancel' | 'resume' | 'discard') {
    setBusy(true);
    setError('');
    try {
      if (!(await flush())) throw new Error('请先处理剧本保存问题');
      const path = `/projects/${projectId}/episodes/${episodeId}/script/import`;
      if (mode === 'resume')
        await client.request(path, ScriptImportResult, {
          method: 'POST',
          body: { revision: revision() },
        });
      else if (mode === 'cancel')
        await client.request(`${path}/cancel`, z.object({ saved: z.literal(true) }), {
          method: 'POST',
        });
      else await client.request(path, z.object({ revision: z.number() }), { method: 'DELETE' });
      await changed();
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {running && (
        <div role="status" className="border-b p-3 text-sm">
          <div className="flex items-center justify-between">
            <span>
              {conversion.status === 'queued' ? '排队中' : stages[conversion.stage ?? 'split']} ·
              已处理 {conversion.done} / {conversion.total} 批
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void action('cancel')}
            >
              取消转换
            </Button>
          </div>
          <progress
            className="mt-2 h-1 w-full"
            max={Math.max(1, conversion.total)}
            value={conversion.done}
          />
        </div>
      )}
      {!running && record.pendingImport && (
        <div
          data-script-warning
          role="status"
          className="flex flex-wrap items-center gap-2 border-b p-3 text-sm"
        >
          <span>
            {conversion?.status === 'failed' ? `转换失败：${conversion.error}` : '存在未完成的导入'}
          </span>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void action('resume')}>
            继续转换
          </Button>
          <Button variant="ghost" size="sm" onClick={edit}>
            编辑原文
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void action('discard')}>
            丢弃
          </Button>
        </div>
      )}
      {!dismissed &&
        conversion?.status === 'succeeded' &&
        conversion.result &&
        record.convertedAt &&
        Date.parse(record.convertedAt) >= openedAt && (
          <div role="status" className="border-b bg-accent p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span>
                已识别 {conversion.result.scenes} 场、{conversion.result.blocks} 段，新增{' '}
                {conversion.result.addedElements} 个待确认元素
              </span>
              <Button size="sm" variant="ghost" onClick={view}>
                查看
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
                关闭提示
              </Button>
            </div>
            {conversion.warnings.length > 0 && (
              <details>
                <summary>部分内容按规则识别</summary>
                {conversion.warnings.map((warning, index) => (
                  <p key={index} className="mt-1 text-xs text-muted-foreground">
                    {warning}
                  </p>
                ))}
              </details>
            )}
          </div>
        )}
      {error && (
        <p role="alert" className="p-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

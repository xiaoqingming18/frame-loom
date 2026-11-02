import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScriptImportResult, type ScriptMeta } from '@frame-loom/contracts';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@frame-loom/ui/components/dialog';
import { Button } from '@frame-loom/ui/components/button';
import { Textarea } from '@frame-loom/ui/components/textarea';
import type { EngineClient } from '@/lib/engine-client';
import { defaultsQuery, modelsQuery } from '@/lib/model-queries';
export function ImportDialog({
  client,
  projectId,
  episodeId,
  meta,
  hasScenes,
  text: initialText = '',
  flush,
  revision,
  onImported,
  onClose,
}: {
  client: EngineClient;
  projectId: string;
  episodeId: string;
  meta: ScriptMeta;
  hasScenes: boolean;
  text?: string;
  flush: () => Promise<boolean>;
  revision: () => number;
  onImported: () => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialText),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const defaults = useQuery(defaultsQuery(client)),
    models = useQuery(modelsQuery(client));
  const model = models.data?.find((m) => m.id === defaults.data?.chat);
  async function submit() {
    if (hasScenes && !confirm) {
      setConfirm(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (!(await flush())) throw new Error('请先完成组字并处理草稿保存问题');
      await client.request(
        `/projects/${projectId}/episodes/${episodeId}/script/import`,
        ScriptImportResult,
        { method: 'POST', body: { revision: revision(), text } },
      );
      await onImported();
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : '导入失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-180">
        <DialogHeader>
          <DialogTitle>重新导入整集剧本</DialogTitle>
          <DialogDescription>由文本模型完整解析，全部校验成功后替换当前剧本。</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          《{meta.series}》第{meta.episode}集 {meta.title} · {meta.genre || '未填题材'} ·{' '}
          {meta.style || '未填画风'} · {meta.duration_sec ? `${meta.duration_sec}秒` : '未填时长'}
        </p>
        <label className="grid gap-2 text-sm">
          剧本原文
          <Textarea
            aria-label="剧本原文"
            className="min-h-60"
            maxLength={200000}
            disabled={busy}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setConfirm(false);
            }}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          {model?.enabled ? `使用 ${model.displayName}` : '请在设置中配置可用的默认文本模型'} ·{' '}
          {text.length} / 200000
        </p>
        {confirm && <p role="alert">将替换本集全部场次和内容，手工完善的设定资料保留。</p>}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button disabled={busy || !text.trim() || !model?.enabled} onClick={() => void submit()}>
            {busy ? '正在提交…' : confirm ? '确认替换并解析' : '开始解析'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

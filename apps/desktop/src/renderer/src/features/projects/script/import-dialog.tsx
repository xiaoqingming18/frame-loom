import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  formatProfile,
  isProfileComplete,
  ScriptImportResult,
  type ProjectProfile,
} from '@frame-loom/contracts';
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
import { EngineRequestError } from '@/lib/engine-client';
import { defaultsQuery, modelsQuery } from '@/lib/model-queries';
import { ProfileFields } from '../profile-fields';
import { emptyProfile } from '../profile';

export function ImportDialog({
  client,
  projectId,
  episodeId,
  profile,
  hasBlocks,
  text: initialText = '',
  flush,
  revision,
  onImported,
  onClose,
}: {
  client: EngineClient;
  projectId: string;
  episodeId: string;
  profile?: ProjectProfile;
  hasBlocks: boolean;
  text?: string;
  flush: () => Promise<boolean>;
  revision: () => number;
  onImported: () => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [value, setValue] = useState(profile ?? emptyProfile());
  const [editing, setEditing] = useState(!isProfileComplete(profile));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const defaults = useQuery(defaultsQuery(client));
  const models = useQuery(modelsQuery(client));
  const model = models.data?.find((model) => model.id === defaults.data?.chat);
  async function submit() {
    if (hasBlocks && !confirm) {
      setConfirm(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (!(await flush())) {
        setError('请先处理剧本保存问题，再开始转换');
        return;
      }
      await client.request(
        `/projects/${projectId}/episodes/${episodeId}/script/import`,
        ScriptImportResult,
        {
          method: 'POST',
          body: { revision: revision(), text, ...(editing ? { profile: value } : {}) },
        },
      );
      await onImported();
      onClose();
    } catch (error) {
      if (error instanceof EngineRequestError && error.code === 'PROJECT_PROFILE_REQUIRED')
        setEditing(true);
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
          <DialogTitle>粘贴整集剧本</DialogTitle>
          <DialogDescription>保留原文，识别段落类型并同步人物与场景。</DialogDescription>
        </DialogHeader>
        {editing ? (
          <div data-script-warning>
            <p className="mb-3 text-sm">首次导入前，请补齐内容形式、制作媒介和题材。</p>
            <ProfileFields compact value={value} onChange={setValue} disabled={busy} />
          </div>
        ) : (
          <div className="flex items-center justify-between text-sm">
            <span>按『{formatProfile(value)}』识别</span>
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              修改
            </Button>
          </div>
        )}
        <label className="text-sm">
          剧本原文
          <Textarea
            aria-label="剧本原文"
            className="mt-2 min-h-60 font-mono"
            maxLength={200000}
            value={text}
            disabled={busy}
            onChange={(event) => {
              setText(event.target.value);
              setConfirm(false);
            }}
          />
        </label>
        <p className="text-right text-xs text-muted-foreground">{text.length} / 200000</p>
        <p className="text-xs text-muted-foreground">
          {model
            ? `使用 ${model.displayName} 识别`
            : '未设置默认文本模型，将仅按规则识别，可在 设置 → 默认模型 中配置'}
        </p>
        {confirm && (
          <p role="alert" data-script-warning>
            将替换本集全部段落，设定库元素保留
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={busy || !text.trim() || !isProfileComplete(value)}
            onClick={() => void submit()}
          >
            {busy ? '正在提交…' : confirm ? '确认替换并转换' : '开始转换'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

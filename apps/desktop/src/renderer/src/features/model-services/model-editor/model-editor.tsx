import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ObjectStorageState,
  getProtocol,
  validateModel,
  type CapabilityIssue,
} from '@frame-loom/contracts';
import { Model, ModelWrite, type Channel } from '@frame-loom/contracts/model-service';
import { Button } from '@frame-loom/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@frame-loom/ui/components/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@frame-loom/ui/components/tabs';
import type { EngineClient } from '@/lib/engine-client';
import { ConfirmDialog, ErrorMessage } from '../form-fields';
import { useModelDraft, modelWrite } from './use-model-draft';
import { BasicTab } from './basic-tab';
import { CapabilityTab } from './capability-tab';
import { ExtrasTab } from './extras-tab';

export function ModelEditor({
  client,
  channel,
  model,
  copy = false,
  onClose,
  onSaved,
  onTest,
  onOpenStorage,
}: {
  client: EngineClient;
  channel: Channel;
  model?: Model;
  copy?: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onTest: (model: Model) => void;
  onOpenStorage: () => void;
}) {
  const { draft, setDraft, dirty, markSaved, protocol, restore } = useModelDraft(model, copy);
  const [saved, setSaved] = useState(copy ? undefined : model);
  const [closing, setClosing] = useState(false);
  const [leavingForStorage, setLeavingForStorage] = useState(false);
  const [pending, setPending] = useState<ReturnType<typeof protocol>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invalidExtras, setInvalidExtras] = useState(false);
  const storage = useQuery({
    queryKey: ['object-storage'],
    queryFn: ({ signal }) => client.request('/object-storage', ObjectStorageState, { signal }),
  });
  let issues: CapabilityIssue[] = [];
  const parsed = ModelWrite.safeParse(draft);
  if (parsed.success) {
    try {
      issues = validateModel(
        parsed.data,
        draft.protocolId ? getProtocol(draft.protocolId) : undefined,
        channel,
      );
    } catch {
      issues = [{ field: 'endpointOverride', message: '地址草稿无效' }];
    }
  } else
    issues = parsed.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
  function close() {
    if (dirty) setClosing(true);
    else onClose();
  }
  async function save() {
    if (!parsed.success || issues.length || invalidExtras) return;
    setBusy(true);
    setError('');
    try {
      const result = saved
        ? await client.request(`/models/${saved.id}`, Model, { method: 'PUT', body: parsed.data })
        : (
            await client.request(`/channels/${channel.id}/models`, Model.array(), {
              method: 'POST',
              body: [parsed.data],
            })
          )[0];
      setSaved(result);
      markSaved(modelWrite(result));
      await onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '模型保存失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="h-[min(820px,calc(100dvh-3rem))] w-[calc(100%-2rem)] grid-rows-[auto_1fr_auto] gap-3 overflow-hidden bg-card p-5 sm:max-w-[1080px]">
        <div>
          <DialogTitle>{draft.displayName || '添加模型'}</DialogTitle>
          <DialogDescription className="mt-1 truncate font-mono text-xs">
            {draft.upstreamModelId || '填写上游模型 ID，选择请求协议与能力'}
          </DialogDescription>
        </div>
        <Tabs defaultValue="basic" className="min-h-0">
          <TabsList aria-label="模型编辑标签">
            <TabsTrigger value="basic">基本信息</TabsTrigger>
            <TabsTrigger value="capability">能力与参数</TabsTrigger>
            <TabsTrigger value="extras">附加参数</TabsTrigger>
          </TabsList>
          <TabsContent
            forceMount
            value="basic"
            className="min-h-0 overflow-y-auto pt-3 pr-2 data-[state=inactive]:hidden"
          >
            <BasicTab
              channel={channel}
              draft={draft}
              onChange={setDraft}
              onProtocol={(id) => {
                const next = protocol(id);
                if (next.incompatible.length) setPending(next);
                else setDraft(next.model);
              }}
              onOpenStorage={() => {
                if (dirty) {
                  setLeavingForStorage(true);
                  setClosing(true);
                } else onOpenStorage();
              }}
              storageReady={!!storage.data}
            />
          </TabsContent>
          <TabsContent
            forceMount
            value="capability"
            className="min-h-0 overflow-y-auto pt-3 pr-2 data-[state=inactive]:hidden"
          >
            <CapabilityTab
              draft={draft}
              onChange={(capability) => setDraft({ ...draft, capability })}
              onRestore={restore}
            />
          </TabsContent>
          <TabsContent
            forceMount
            value="extras"
            className="min-h-0 overflow-y-auto pt-3 pr-2 data-[state=inactive]:hidden"
          >
            <ExtrasTab
              client={client}
              modelId={!dirty ? saved?.id : undefined}
              draft={draft}
              onChange={setDraft}
              onInvalid={setInvalidExtras}
            />
          </TabsContent>
        </Tabs>
        <footer className="space-y-2 border-t border-border pt-3">
          <ErrorMessage error={error} />
          {issues.length > 0 && (
            <p role="alert" className="max-h-16 overflow-y-auto text-xs text-destructive">
              {issues.map((issue) => `${issue.field}：${issue.message}`).join('；')}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{dirty ? '有未保存的修改' : ''}</p>
            <div className="flex gap-2">
              <span title={dirty || !saved ? '请先保存' : undefined}>
                <Button
                  variant="outline"
                  disabled={dirty || !saved || !saved.enabled || !!saved.blockedReason}
                  onClick={() => saved && onTest(saved)}
                >
                  生成测试
                </Button>
              </span>
              <Button variant="ghost" onClick={close}>
                取消
              </Button>
              <Button
                disabled={busy || !parsed.success || issues.length > 0 || invalidExtras}
                onClick={() => void save()}
              >
                保存
              </Button>
            </div>
          </div>
        </footer>
      </DialogContent>
      {closing && (
        <ConfirmDialog
          title="放弃修改？"
          description="未保存的修改将丢失。"
          onClose={() => {
            setClosing(false);
            setLeavingForStorage(false);
          }}
          onConfirm={leavingForStorage ? onOpenStorage : onClose}
          confirmLabel="放弃修改"
        />
      )}
      {pending && (
        <ConfirmDialog
          title="确认切换协议？"
          description={
            <ul className="list-disc space-y-1 pl-4">
              {pending.incompatible.map((issue, index) => (
                <li key={index}>
                  {issue.field}：{issue.message}
                </li>
              ))}
            </ul>
          }
          onClose={() => setPending(undefined)}
          onConfirm={() => {
            setDraft(pending.model);
            setPending(undefined);
          }}
        />
      )}
    </Dialog>
  );
}

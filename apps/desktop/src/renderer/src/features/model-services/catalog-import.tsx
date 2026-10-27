import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ModelImportPackage, ModelImportPreview } from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Textarea } from '@frame-loom/ui/components/textarea';
import type { EngineClient } from '@/lib/engine-client';

export function CatalogImport({ client }: { client: EngineClient }) {
  const queryClient = useQueryClient();
  const [source, setSource] = useState('');
  const [preview, setPreview] = useState<ModelImportPreview>();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function run(apply: boolean) {
    setBusy(true);
    setMessage('');
    try {
      if (apply && preview) {
        await client.request('/model-catalog/apply', ModelImportPackage, {
          method: 'POST',
          body: { package: preview.incoming, revision: preview.revision, confirmUpdates: confirm },
        });
        await queryClient.invalidateQueries({ queryKey: ['models'] });
        setPreview(undefined);
        setSource('');
        setMessage('已原子应用；未发起任何远端请求或生成。');
      } else {
        const value = ModelImportPackage.parse(JSON.parse(source));
        setPreview(
          await client.request('/model-catalog/preview', ModelImportPreview, {
            method: 'POST',
            body: value,
          }),
        );
        setConfirm(false);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导入失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="space-y-3 rounded-xl border p-4 text-xs">
      <summary className="cursor-pointer">高级：共享接入与模型定义导入</summary>
      <p className="text-muted-foreground">
        接入在此设备共享。留空地址和凭据即继承绑定渠道；credentialRef 可填本机已有渠道
        ID，使用该账号的加密密钥和请求头，地址仍继承绑定渠道。更新会影响下列模型的新任务，历史任务保留快照。仅接受内置协议
        v1，不接收密钥或可执行代码。
      </p>
      <Textarea
        aria-label="模型定义导入 JSON"
        className="min-h-40 font-mono text-xs"
        value={source}
        onChange={(event) => {
          setSource(event.target.value);
          setPreview(undefined);
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void client
            .request('/model-catalog', ModelImportPackage)
            .then((value) => {
              setSource(JSON.stringify(value, null, 2));
              setPreview(undefined);
            })
            .catch((error: Error) => setMessage(error.message))
            .finally(() => setBusy(false));
        }}
      >
        载入当前目录以编辑接入
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy || !source.trim()}
        onClick={() => void run(false)}
      >
        校验并预览
      </Button>
      {preview && (
        <div role="status" className="space-y-2">
          <p>
            {preview.incoming.definitions.length} 个模型定义 · {preview.incoming.connections.length}{' '}
            个接入 · {preview.incoming.bindings.length} 个绑定
          </p>
          <p>
            更新标识：{preview.conflicts.join('、') || '无'}；影响模型：
            {preview.affectedModels.join('、') || '无'}
          </p>
          <details>
            <summary>地址、版本与能力差异</summary>
            <p>变更前（仅列出本次涉及的定义和接入）</p>
            <pre className="max-h-60 overflow-auto break-all whitespace-pre-wrap">
              {JSON.stringify(
                {
                  definitions: preview.before.definitions.filter((item) =>
                    preview.incoming.definitions.some((next) => next.id === item.id),
                  ),
                  connections: preview.before.connections.filter((item) =>
                    preview.incoming.connections.some((next) => next.id === item.id),
                  ),
                },
                null,
                2,
              )}
            </pre>
            <p>变更后</p>
            <pre className="max-h-60 overflow-auto break-all whitespace-pre-wrap">
              {JSON.stringify(preview.incoming, null, 2)}
            </pre>
          </details>
          {preview.conflicts.length > 0 && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={confirm}
                onChange={(event) => setConfirm(event.target.checked)}
              />
              确认更新已有定义和受影响绑定
            </label>
          )}
          <Button
            type="button"
            size="sm"
            disabled={busy || (!!preview.conflicts.length && !confirm)}
            onClick={() => void run(true)}
          >
            确认应用导入
          </Button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  );
}

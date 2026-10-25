import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cloud, ShieldCheck } from 'lucide-react';
import {
  ObjectStorageState,
  ObjectStorageWrite,
  ObjectStorageCheck,
  type ObjectStorageConfig,
} from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Input } from '@frame-loom/ui/components/input';
import type { EngineClient } from '@/lib/engine-client';

const storageKey = ['object-storage'];
export function ObjectStorageSettings({ client }: { client: EngineClient }) {
  const queryClient = useQueryClient();
  const config = useQuery({
    queryKey: storageKey,
    queryFn: ({ signal }) => client.request('/object-storage', ObjectStorageState, { signal }),
  });
  const save = useMutation({
    mutationFn: (body: ObjectStorageWrite) =>
      client.request('/object-storage', ObjectStorageState, { method: 'PUT', body }),
    onSuccess: async () => {
      test.reset();
      setConfirm(false);
      await queryClient.invalidateQueries({ queryKey: storageKey });
    },
  });
  const test = useMutation({
    mutationFn: () =>
      client.request('/object-storage/test', ObjectStorageCheck, {
        method: 'POST',
        timeoutMs: 300_000,
      }),
  });
  const remove = useMutation({
    mutationFn: () => client.request('/object-storage', ObjectStorageState, { method: 'DELETE' }),
    onSuccess: async () => {
      test.reset();
      await queryClient.invalidateQueries({ queryKey: storageKey });
    },
  });
  const [confirm, setConfirm] = useState(false);
  const busy = save.isPending || test.isPending || remove.isPending;
  return (
    <section aria-labelledby="storage-heading" className="space-y-6">
      <header>
        <Cloud className="mb-3 size-6 text-primary" aria-hidden="true" />
        <h2 id="storage-heading" className="text-xl font-semibold">
          对象存储
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          为参考视频与音频提供临时下载链接。使用你自己的 S3 兼容私有存储桶。
        </p>
      </header>
      {config.isPending ? (
        <p role="status">正在读取配置…</p>
      ) : config.isError ? (
        <p role="alert">{config.error.message}</p>
      ) : (
        <StorageForm
          key={JSON.stringify(config.data)}
          config={config.data ?? null}
          busy={busy}
          onSave={(body) => save.mutate(body)}
        />
      )}
      {config.data && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !config.data.hasSecret}
            onClick={() => test.mutate()}
          >
            {test.isPending ? '正在测试四步连接…' : '测试连接'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => (confirm ? remove.mutate() : setConfirm(true))}
          >
            {confirm ? '确认移除配置（保留远端素材）' : '移除配置'}
          </Button>
        </div>
      )}
      {(save.error || test.error || remove.error) && (
        <p role="alert" className="text-xs text-destructive">
          {(save.error ?? test.error ?? remove.error)?.message}
        </p>
      )}
      {save.isSuccess && (
        <p role="status" className="text-xs text-muted-foreground">
          配置已保存
        </p>
      )}
      {test.data && (
        <div
          role="status"
          className={`space-y-2 rounded-xl border p-4 text-xs ${test.data.ok ? 'text-muted-foreground' : 'text-destructive'}`}
        >
          <p>{test.data.message}</p>
          <p>
            上传 {test.data.steps.upload ? '✓' : '×'} · 预签名 {test.data.steps.sign ? '✓' : '×'} ·
            无凭据下载比对 {test.data.steps.download ? '✓' : '×'} · 删除{' '}
            {test.data.steps.delete ? '✓' : '×'}
          </p>
        </div>
      )}
      <aside className="space-y-2 rounded-xl border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <ShieldCheck className="size-4" aria-hidden="true" />
          素材与隐私
        </p>
        <p>
          素材会上传到你的存储桶，再由所选模型厂商通过预签名链接下载。链接有效期内，持有链接的人可读取素材；请勿公开分享。
        </p>
        <p>
          建议对素材前缀设置 7
          天生命周期。应用不自动删除远端素材；本地上传记录超过一天后会重新上传。测试连接仅删除自己的测试对象。
        </p>
      </aside>
    </section>
  );
}
function StorageForm({
  config,
  busy,
  onSave,
}: {
  config: ObjectStorageConfig | null;
  busy: boolean;
  onSave: (body: ObjectStorageWrite) => void;
}) {
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = ObjectStorageWrite.safeParse({
      endpoint: form.get('endpoint'),
      region: form.get('region'),
      bucket: form.get('bucket'),
      accessKeyId: form.get('accessKeyId'),
      secretAccessKey: form.get('secretAccessKey') || undefined,
      forcePathStyle: form.get('forcePathStyle') === 'on',
      keyPrefix: form.get('keyPrefix'),
      presignTtlSeconds: Number(form.get('hours')) * 3600,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '请检查配置');
      return;
    }
    setError('');
    onSave(parsed.data);
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
        {(
          [
            { key: 'endpoint', label: 'S3 端点', placeholder: 'https://s3.example.com' },
            { key: 'region', label: '地域', placeholder: 'auto / us-east-1' },
            { key: 'bucket', label: '存储桶', placeholder: 'my-bucket' },
            { key: 'accessKeyId', label: 'Access Key ID', placeholder: '' },
            { key: 'keyPrefix', label: '素材前缀', placeholder: 'frame-loom' },
          ] as const
        ).map(({ key, label, placeholder }) => (
          <label key={key} className="grid min-w-0 gap-2 text-xs text-muted-foreground">
            {label}
            <Input
              name={key}
              defaultValue={config?.[key] ?? (key === 'keyPrefix' ? 'frame-loom' : '')}
              required={key !== 'keyPrefix'}
              placeholder={placeholder}
            />
          </label>
        ))}
        <label className="grid gap-2 text-xs text-muted-foreground">
          Secret（{config?.hasSecret ? '已保存，留空保留' : '需要填写'}）
          <Input
            name="secretAccessKey"
            aria-label="Secret"
            type="password"
            autoComplete="new-password"
            required={!config?.hasSecret}
          />
        </label>
        <label className="grid gap-2 text-xs text-muted-foreground">
          链接有效期（小时）
          <Input
            name="hours"
            type="number"
            min={1}
            max={168}
            step={1}
            required
            defaultValue={(config?.presignTtlSeconds ?? 86400) / 3600}
          />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            name="forcePathStyle"
            type="checkbox"
            defaultChecked={config?.forcePathStyle ?? true}
          />
          路径式寻址
        </label>
      </fieldset>
      {config?.secretNeedsUpdate && (
        <p role="alert" className="text-xs text-destructive">
          Secret 无法解密，请重新填写。
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={busy}>
        {busy ? '处理中…' : '保存存储配置'}
      </Button>
    </form>
  );
}

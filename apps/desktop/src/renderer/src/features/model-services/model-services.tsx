import { useState, type ReactNode, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Settings2 } from 'lucide-react';
import {
  Channel,
  ChannelWrite,
  ChannelModel,
  ChannelModelWrite,
  ChannelModelList,
  ConnectionCheck,
  DeleteResult,
  ModelDefaults,
  ModelKind,
  LlmProtocol,
  ImageProtocol,
  VideoProtocol,
  channelPresets,
  type ChannelPreset,
} from '@frame-loom/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import type { EngineClient } from '@/lib/engine-client';
import { channelsQuery, modelsQuery, defaultsQuery } from '@/lib/model-queries';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}
function formText(data: FormData, key: string, fallback = '') {
  const value = data.get(key);
  return typeof value === 'string' ? value : fallback;
}
function CheckResult({ result }: { result: ConnectionCheck | null }) {
  return (
    result && (
      <p className={result.ok ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>
        {result.code && `${result.code} · `}
        {result.message}
      </p>
    )
  );
}
function DeleteButton({ onDelete, disabled }: { onDelete: () => void; disabled: boolean }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled}
      onBlur={() => setConfirm(false)}
      onClick={() => (confirm ? onDelete() : setConfirm(true))}
    >
      {confirm ? '确认删除' : '删除'}
    </Button>
  );
}

export function ModelServices({ engineClient: client }: { engineClient: EngineClient }) {
  const channels = useQuery(channelsQuery(client));
  const models = useQuery(modelsQuery(client));
  const defaults = useQuery(defaultsQuery(client));
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string>();
  const [channelEdit, setChannelEdit] = useState<Channel | 'new' | null>(null);
  const [modelEdit, setModelEdit] = useState<ChannelModel | 'new' | null>(null);
  const [message, setMessage] = useState('');
  const action = useMutation({
    mutationFn: (work: () => Promise<unknown>) => work(),
    onSuccess: async () => {
      setMessage('操作完成');
      await queryClient.invalidateQueries({ queryKey: ['models'] });
    },
    onError: (error) => setMessage(error.message),
  });
  const perform = (work: () => Promise<unknown>) => {
    setMessage('');
    action.mutate(work);
  };
  const channel = channels.data?.find((item) => item.id === selected) ?? channels.data?.[0];
  const error = channels.error ?? models.error ?? defaults.error;
  return (
    <section aria-labelledby="models-heading" className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 id="models-heading" className="text-xl font-semibold">
            模型服务
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">
            连接模型供应商，为工作台选择合适的能力。
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={action.isPending}
          onClick={() => setChannelEdit('new')}
        >
          <Plus aria-hidden="true" />
          添加渠道
        </Button>
      </header>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
          <Button
            variant="link"
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['models'] })}
          >
            重试
          </Button>
        </p>
      )}
      {channels.isPending && <p role="status">正在加载渠道…</p>}
      {message && (
        <p
          role={action.isError ? 'alert' : 'status'}
          className={action.isError ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}
        >
          {message}
        </p>
      )}
      {channelEdit && (
        <ChannelForm
          key={typeof channelEdit === 'string' ? channelEdit : channelEdit.id}
          channel={channelEdit === 'new' ? undefined : channelEdit}
          busy={action.isPending}
          onCancel={() => setChannelEdit(null)}
          onSave={(body) =>
            perform(async () => {
              const existing = channelEdit !== 'new' ? channelEdit : undefined;
              const saved = await client.request(
                existing ? `/channels/${existing.id}` : '/channels',
                Channel,
                { method: existing ? 'PATCH' : 'POST', body },
              );
              setSelected(saved.id);
              setChannelEdit(null);
              setModelEdit(null);
            })
          }
        />
      )}
      {!channels.isPending && !channels.data?.length && !error && (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <Settings2 aria-hidden="true" className="mx-auto mb-3 size-6 text-muted-foreground" />
          <p className="text-sm">添加第一个模型渠道</p>
          <p className="mt-2 text-xs text-muted-foreground">
            密钥加密保存在此设备，保存后仅显示尾号。
          </p>
        </div>
      )}
      {channel && (
        <>
          <Field label="当前渠道">
            <NativeSelect
              value={channel.id}
              onChange={(event) => {
                setSelected(event.target.value);
                setModelEdit(null);
                setChannelEdit(null);
              }}
            >
              {channels.data?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {!item.enabled && '（已禁用）'}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-medium">{channel.name}</h3>
                <p className="mt-1 text-xs break-all text-muted-foreground">{channel.baseUrl}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  密钥：{channel.keyHint ?? '未配置'}
                  {channel.headerNames.length > 0 && ` · 附加头：${channel.headerNames.join('、')}`}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={action.isPending}
                onClick={() => setChannelEdit(channel)}
              >
                编辑渠道
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={action.isPending || !channel.enabled}
                onClick={() =>
                  perform(() =>
                    client.request(`/channels/${channel.id}/test`, ConnectionCheck, {
                      method: 'POST',
                      timeoutMs: 75_000,
                    }),
                  )
                }
              >
                测试渠道
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={action.isPending || !channel.enabled}
                onClick={() =>
                  perform(() =>
                    client.request(`/channels/${channel.id}/fetch-models`, ChannelModelList, {
                      method: 'POST',
                      timeoutMs: 20_000,
                    }),
                  )
                }
              >
                <RefreshCw aria-hidden="true" />
                拉取模型
              </Button>
              <DeleteButton
                disabled={action.isPending}
                onDelete={() =>
                  perform(async () => {
                    await client.request(`/channels/${channel.id}`, DeleteResult, {
                      method: 'DELETE',
                    });
                    setSelected(undefined);
                    setModelEdit(null);
                    setChannelEdit(null);
                  })
                }
              />
            </div>
            <CheckResult result={channel.lastCheck} />
          </div>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">渠道模型</h3>
            <Button
              size="sm"
              variant="ghost"
              disabled={action.isPending}
              onClick={() => setModelEdit('new')}
            >
              <Plus aria-hidden="true" />
              添加模型
            </Button>
          </div>
          {modelEdit && (
            <ModelForm
              key={typeof modelEdit === 'string' ? `${channel.id}-new` : modelEdit.id}
              model={modelEdit === 'new' ? undefined : modelEdit}
              preset={channel.preset}
              busy={action.isPending}
              onCancel={() => setModelEdit(null)}
              onSave={(body) =>
                perform(async () => {
                  const existing = modelEdit !== 'new' ? modelEdit : undefined;
                  await client.request(
                    existing ? `/channel-models/${existing.id}` : `/channels/${channel.id}/models`,
                    ChannelModel,
                    { method: existing ? 'PATCH' : 'POST', body },
                  );
                  setModelEdit(null);
                })
              }
            />
          )}
          <ul className="divide-y rounded-xl border px-4">
            {models.data
              ?.filter((item) => item.channelId === channel.id)
              .map((model) => (
                <li key={model.id} className="space-y-3 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {model.displayName}{' '}
                        <span className="font-normal text-muted-foreground">
                          {model.enabled ? '已启用' : '已禁用'}
                        </span>
                      </p>
                      <p className="mt-1 text-xs break-all text-muted-foreground">
                        {model.upstreamModelId} · {model.kind ?? '未分类'} ·{' '}
                        {model.protocol ?? '未选协议'}
                      </p>
                      {model.metadata && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {model.metadata.needsConfirmation && '元数据需确认 · '}上下文{' '}
                          {model.metadata.contextWindow} / 输出 {model.metadata.maxTokens}
                          {model.metadata.reasoning && ' · 推理'}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={action.isPending}
                      onClick={() => setModelEdit(model)}
                    >
                      配置 {model.displayName}
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        action.isPending ||
                        !channel.enabled ||
                        !model.enabled ||
                        model.kind !== 'chat'
                      }
                      onClick={() =>
                        perform(() =>
                          client.request(`/channel-models/${model.id}/test`, ConnectionCheck, {
                            method: 'POST',
                            timeoutMs: 75_000,
                          }),
                        )
                      }
                    >
                      测试模型
                    </Button>
                    <DeleteButton
                      disabled={action.isPending}
                      onDelete={() =>
                        perform(() =>
                          client.request(`/channel-models/${model.id}`, DeleteResult, {
                            method: 'DELETE',
                          }),
                        )
                      }
                    />
                  </div>
                  <CheckResult result={model.lastCheck} />
                </li>
              ))}
          </ul>
          {!models.data?.some((item) => item.channelId === channel.id) && (
            <p className="text-xs text-muted-foreground">
              尚无模型。可以拉取模型列表，也可以手动填写上游 ID。
            </p>
          )}
        </>
      )}
      {defaults.data && (
        <div className="space-y-4 border-t pt-5">
          <h3 className="text-sm font-medium">默认模型</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {ModelKind.options.map((kind) => (
              <Field
                key={kind}
                label={{ chat: '文本', image: '图片', video: '视频', tts: '语音' }[kind]}
              >
                <NativeSelect
                  disabled={action.isPending}
                  value={defaults.data[kind] ?? ''}
                  onChange={(event) => {
                    const id = event.target.value;
                    perform(() =>
                      client.request('/model-defaults', ModelDefaults, {
                        method: 'PUT',
                        body: { [kind]: id || null },
                      }),
                    );
                  }}
                >
                  <option value="">未设置</option>
                  {models.data
                    ?.filter(
                      (model) =>
                        model.kind === kind &&
                        model.enabled &&
                        channels.data?.some((item) => item.id === model.channelId && item.enabled),
                    )
                    .map((model) => (
                      <option key={model.id} value={model.id}>
                        {channels.data?.find((item) => item.id === model.channelId)?.name} /{' '}
                        {model.displayName}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ChannelForm({
  channel,
  busy,
  onCancel,
  onSave,
}: {
  channel?: Channel;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: ChannelWrite) => void;
}) {
  const [preset, setPreset] = useState<ChannelPreset>(channel?.preset ?? 'openai');
  const [baseUrl, setBaseUrl] = useState(channel?.baseUrl ?? channelPresets.openai.baseUrl);
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const key = formText(form, 'apiKey');
      const headers = formText(form, 'headers');
      onSave(
        ChannelWrite.parse({
          name: form.get('name'),
          preset,
          baseUrl,
          enabled: form.get('enabled') === 'on',
          ...(key ? { apiKey: key } : form.get('clearKey') ? { apiKey: '' } : {}),
          ...(headers ? { headers: JSON.parse(headers) as unknown } : {}),
        }),
      );
    } catch {
      setError('请检查渠道名称、HTTP(S) 地址与附加请求头 JSON。');
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border bg-muted/30 p-4">
      <h3 className="text-sm font-medium">{channel ? '编辑渠道' : '新渠道'}</h3>
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <Field label="渠道名称">
          <Input name="name" required maxLength={100} defaultValue={channel?.name} />
        </Field>
        <Field label="渠道预设">
          <NativeSelect
            value={preset}
            onChange={(event) => {
              const value = event.target.value as ChannelPreset;
              setPreset(value);
              setBaseUrl(channelPresets[value].baseUrl);
            }}
          >
            {Object.entries(channelPresets).map(([value, item]) => (
              <option key={value} value={value}>
                {item.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Base URL">
            <Input
              required
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </Field>
        </div>
        <Field label={channel?.hasKey ? `重新填写密钥（留空保留 ${channel.keyHint}）` : 'API 密钥'}>
          <Input name="apiKey" type="password" autoComplete="new-password" />
        </Field>
        <label className="flex items-center gap-2 text-xs">
          <input name="clearKey" type="checkbox" />
          清除已存密钥
        </label>
        <div className="sm:col-span-2">
          <Field label="附加请求头 JSON（留空保留，{} 清除）">
            <Textarea
              name="headers"
              placeholder={'{"X-Custom-Header":"value"}'}
              className="font-mono text-xs"
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input name="enabled" type="checkbox" defaultChecked={channel?.enabled ?? true} />
          启用渠道
        </label>
      </fieldset>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          保存渠道
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}

function ModelForm({
  model,
  preset,
  busy,
  onCancel,
  onSave,
}: {
  model?: ChannelModel;
  preset: ChannelPreset;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: ChannelModelWrite) => void;
}) {
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      onSave(
        ChannelModelWrite.parse({
          upstreamModelId: form.get('upstreamModelId'),
          displayName: form.get('displayName'),
          kind: form.get('kind') || null,
          protocol: form.get('protocol') || null,
          profileId: form.get('profileId') || null,
          enabled: form.get('enabled') === 'on',
          overrides: JSON.parse(formText(form, 'overrides', '{}')) as unknown,
        }),
      );
    } catch {
      setError(
        '请检查模型 ID、名称和覆盖项 JSON（contextWindow、maxTokens、reasoning、imageInput、compat）。',
      );
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border bg-muted/30 p-4">
      <h3 className="text-sm font-medium">{model ? '配置模型' : '新模型'}</h3>
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <Field label="上游模型 ID">
          <Input
            name="upstreamModelId"
            defaultValue={model?.upstreamModelId}
            required
            maxLength={300}
          />
        </Field>
        <Field label="显示名称">
          <Input name="displayName" defaultValue={model?.displayName} required maxLength={300} />
        </Field>
        <Field label="模型类别">
          <NativeSelect name="kind" defaultValue={model?.kind ?? ''}>
            <option value="">未分类</option>
            {ModelKind.options.map((kind) => (
              <option key={kind} value={kind}>
                {{ chat: '文本', image: '图片', video: '视频', tts: '语音' }[kind]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="调用协议">
          <NativeSelect
            name="protocol"
            defaultValue={model?.protocol ?? channelPresets[preset].protocol}
          >
            <option value="">未选择</option>
            {[...LlmProtocol.options, ...ImageProtocol.options, ...VideoProtocol.options].map(
              (protocol) => (
                <option key={protocol} value={protocol}>
                  {protocol}
                </option>
              ),
            )}
          </NativeSelect>
        </Field>
        <Field label="媒体档案 ID">
          <Input
            name="profileId"
            defaultValue={model?.profileId ?? ''}
            placeholder="留空按精确 ID 匹配，否则使用通用档案"
          />
        </Field>
        <p className="text-xs text-muted-foreground sm:col-span-2">
          MiniMax H3 视频请新建独立渠道，Base URL 使用 https://api.minimax.io（不含
          /anthropic）；Sora 格式用于兼容渠道。内置档案可在模型测试页查看。
        </p>
        <label className="flex items-center gap-2 text-xs">
          <input name="enabled" type="checkbox" defaultChecked={model?.enabled ?? false} />
          启用模型（先选择类别和协议）
        </label>
        <div className="sm:col-span-2">
          <Field label="元数据覆盖 JSON">
            <Textarea
              name="overrides"
              className="min-h-28 font-mono text-xs"
              defaultValue={JSON.stringify(model?.overrides ?? {}, null, 2)}
            />
          </Field>
          <p className="mt-2 text-xs text-muted-foreground">
            可填写 contextWindow、maxTokens、reasoning、imageInput 和 compat。未知 ID
            使用保守值，请按供应商文档确认。
          </p>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          保存模型
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}

import { useState, type ReactNode, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import {
  Channel,
  ChannelWrite,
  ConnectionCheck,
  DeleteResult,
  LlmProtocol,
  ModelKind,
  ModelProbeResult,
  ModelProfileList,
  protocolsByKind,
  connectionTemplates,
  connectionTemplateVersion,
  resolveModelOperation,
  serviceRoutes,
  type ServiceOperation,
  type ChannelModel,
  type ChannelModelSave,
  type ModelProbeRequest,
  type ModelProfile,
} from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Input } from '@frame-loom/ui/components/input';
import { Textarea } from '@frame-loom/ui/components/textarea';
import { NativeSelect } from '@frame-loom/ui/components/native-select';
import type { EngineClient } from '@/lib/engine-client';
import { channelsQuery, modelsQuery } from '@/lib/model-queries';
import { kindLabels } from './labels';

const protocolLabels: Record<string, string> = {
  'openai-responses': 'OpenAI Responses',
  'openai-completions': 'OpenAI Chat Completions',
  'anthropic-messages': 'Anthropic Messages',
  'google-generative-ai': 'Gemini',
  'openai-images': 'OpenAI Images',
  'gemini-image': 'Gemini 图片',
  'ark-images': '火山方舟图片',
  'ark-video-tasks': '火山方舟视频任务',
  'minimax-video-v2': 'MiniMax 视频 V2',
  'openai-videos': 'OpenAI Videos（Sora 兼容）',
  'fastaitoken-video': 'FastAIToken JSON 视频',
  'openai-speech': 'OpenAI Speech',
  'minimax-t2a': 'MiniMax T2A',
};
const urlExamples: Record<LlmProtocol, string> = {
  'openai-responses': 'https://api.openai.com/v1',
  'openai-completions': 'https://api.example.com/v1',
  'anthropic-messages': 'https://api.anthropic.com',
  'google-generative-ai': 'https://generativelanguage.googleapis.com/v1beta',
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}
function CheckResult({ result }: { result: ConnectionCheck | null | undefined }) {
  return (
    result && (
      <p className={result.ok ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>
        {result.code && `${result.code} · `}
        {result.message}
      </p>
    )
  );
}
function DeleteButton({
  label,
  onDelete,
  disabled,
}: {
  label: string;
  onDelete: () => void;
  disabled: boolean;
}) {
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
      {confirm ? '确认删除' : label}
    </Button>
  );
}

export function ModelServices({ engineClient: client }: { engineClient: EngineClient }) {
  const channels = useQuery(channelsQuery(client));
  const models = useQuery(modelsQuery(client));
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Channel | 'new' | null>(null);
  const error = channels.error ?? models.error;
  if (editing)
    return (
      <ChannelEditor
        key={editing === 'new' ? 'new' : editing.id}
        client={client}
        channel={editing === 'new' ? undefined : editing}
        models={
          editing === 'new'
            ? []
            : (models.data?.filter((model) => model.channelId === editing.id) ?? [])
        }
        onClose={() => setEditing(null)}
      />
    );
  return (
    <section aria-labelledby="models-heading" className="space-y-6">
      <header>
        <h2 id="models-heading" className="text-xl font-semibold">
          模型服务
        </h2>
        <p className="mt-2 text-xs text-muted-foreground">
          添加渠道后在渠道内选择模型。密钥加密保存在此设备，请求由本机直接发送给供应商。
        </p>
      </header>
      <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
        <Plus aria-hidden="true" />
        添加渠道
      </Button>
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
      {!channels.isPending && !channels.data?.length && !error && (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <Settings2 aria-hidden="true" className="mx-auto mb-3 size-6 text-muted-foreground" />
          <p className="text-sm">添加第一个模型渠道</p>
          <p className="mt-2 text-xs text-muted-foreground">
            密钥加密保存在此设备，保存后仅显示尾号。
          </p>
        </div>
      )}
      <ul aria-label="渠道列表" className="space-y-3">
        {channels.data?.map((channel) => {
          const count = models.data?.filter((model) => model.channelId === channel.id).length ?? 0;
          return (
            <li
              key={channel.id}
              className="flex items-center justify-between gap-3 rounded-xl border p-4"
            >
              <div className="min-w-0 space-y-1">
                <h3 className="text-sm font-medium">
                  {channel.name}
                  {!channel.enabled && (
                    <span className="ml-2 font-normal text-muted-foreground">已禁用</span>
                  )}
                </h3>
                <p className="text-xs break-all text-muted-foreground">{channel.baseUrl}</p>
                <p className="text-xs text-muted-foreground">
                  {count} 个模型 · 密钥：{channel.keyHint ?? '未配置'}
                </p>
                <CheckResult result={channel.lastCheck} />
              </div>
              <Button
                size="sm"
                variant="outline"
                aria-label={`编辑 ${channel.name}`}
                // 编辑页以当前模型列表为保存基准，未加载完成时打开会在保存时误删已有模型。
                disabled={!models.data}
                onClick={() => setEditing(channel)}
              >
                编辑
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type Draft = ChannelModelSave & {
  key: string;
  metadata?: ChannelModel['metadata'];
  lastCheck?: ChannelModel['lastCheck'];
};
type HeaderRow = { key: string; name: string; value: string };
const draftFrom = (model: ChannelModel): Draft => ({
  key: model.id,
  id: model.id,
  upstreamModelId: model.upstreamModelId,
  displayName: model.displayName,
  kind: model.kind,
  protocol: model.protocol,
  profileId: model.profileId,
  overrides: model.overrides,
  connection: model.connection,
  enabled: model.enabled,
  metadata: model.metadata,
  lastCheck: model.lastCheck,
});
const newDraft = (upstreamModelId = ''): Draft => ({
  key: crypto.randomUUID(),
  upstreamModelId,
  displayName: upstreamModelId,
  kind: null,
  protocol: null,
  profileId: null,
  overrides: {},
  enabled: false,
});

function ChannelEditor({
  client,
  channel,
  models,
  onClose,
}: {
  client: EngineClient;
  channel?: Channel;
  models: ChannelModel[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(channel?.name ?? '');
  const [apiFormat, setApiFormat] = useState<LlmProtocol>(
    channel?.apiFormat ?? 'openai-completions',
  );
  const [baseUrl, setBaseUrl] = useState(channel?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  // 已保存的请求头值不可读取；只有用户选择重新设置时才提交并整体替换。
  const [headers, setHeaders] = useState<HeaderRow[] | null>(
    channel?.headerNames.length ? null : [],
  );
  const [drafts, setDrafts] = useState<Draft[]>(() => models.map(draftFrom));
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const [checks, setChecks] = useState<Record<string, ConnectionCheck>>({});
  const [error, setError] = useState('');
  const profiles = useQuery({
    queryKey: ['generation', 'profiles'],
    queryFn: ({ signal }) => client.request('/model-profiles', ModelProfileList, { signal }),
  });
  const action = useMutation({
    mutationFn: (work: () => Promise<unknown>) => work(),
    onError: (failure) => setError(failure.message),
  });
  const busy = action.isPending;
  const perform = (work: () => Promise<unknown>) => {
    setError('');
    action.mutate(work);
  };
  const credentials = () => ({
    ...(apiKey ? { apiKey } : clearKey ? { apiKey: '' } : {}),
    ...(headers
      ? {
          headers: Object.fromEntries(
            headers.filter((row) => row.name.trim()).map((row) => [row.name.trim(), row.value]),
          ),
        }
      : {}),
  });
  const update = (key: string, patch: Partial<Draft>) =>
    setDrafts((items) => items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  const setHeader = (key: string, patch: Partial<HeaderRow>) =>
    setHeaders((rows) => rows && rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  function probe() {
    const body: ModelProbeRequest = {
      apiFormat,
      baseUrl,
      ...credentials(),
      ...(channel ? { channelId: channel.id } : {}),
    };
    perform(async () => {
      setCandidates(
        await client.request('/channels/probe-models', ModelProbeResult, {
          method: 'POST',
          body,
          timeoutMs: 20_000,
        }),
      );
    });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (drafts.some((draft) => draft.enabled && (!draft.kind || !draft.protocol))) {
      setError('启用的模型需要先选择类别和调用协议。');
      return;
    }
    const parsed = ChannelWrite.safeParse({
      name,
      apiFormat,
      baseUrl,
      enabled,
      ...credentials(),
      models: drafts.map((draft) => ({
        id: draft.id,
        upstreamModelId: draft.upstreamModelId,
        displayName: draft.displayName.trim() || draft.upstreamModelId,
        kind: draft.kind,
        protocol: draft.protocol,
        profileId: draft.profileId,
        overrides: draft.overrides,
        connection: draft.connection,
        enabled: draft.enabled,
      })),
    });
    if (!parsed.success) {
      setError('请检查渠道名称、HTTP(S) 接口地址、请求头名称与模型 ID。');
      return;
    }
    perform(async () => {
      await client.request(channel ? `/channels/${channel.id}` : '/channels', Channel, {
        method: channel ? 'PATCH' : 'POST',
        body: parsed.data,
      });
      await queryClient.invalidateQueries({ queryKey: ['models'] });
      onClose();
    });
  }
  const added = new Set(drafts.map((draft) => draft.upstreamModelId));
  return (
    <section aria-labelledby="channel-heading" className="space-y-6">
      <header className="flex items-center gap-2">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="返回渠道列表"
          onClick={onClose}
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
        <h2 id="channel-heading" className="text-xl font-semibold">
          {channel ? `编辑渠道 · ${channel.name}` : '添加渠道'}
        </h2>
      </header>
      <form onSubmit={submit} className="space-y-6">
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          <Field label="渠道名称">
            <Input
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="API 格式">
            <NativeSelect
              value={apiFormat}
              onChange={(event) => setApiFormat(LlmProtocol.parse(event.target.value))}
            >
              {LlmProtocol.options.map((protocol) => (
                <option key={protocol} value={protocol}>
                  {protocolLabels[protocol]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="space-y-1.5 sm:col-span-2">
            <Field label="接口地址">
              <Input
                required
                type="url"
                placeholder={urlExamples[apiFormat]}
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              API 格式决定拉取模型列表的方式，也是新文本模型的默认协议；每个模型可单独改用其他协议。
            </p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Field label="API 密钥">
              <Input
                type="password"
                autoComplete="new-password"
                placeholder={channel?.hasKey ? `留空保留已保存的密钥（${channel.keyHint}）` : ''}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </Field>
            {channel?.hasKey && (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={clearKey}
                  onChange={(event) => setClearKey(event.target.checked)}
                />
                清除已存密钥
              </label>
            )}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <p className="text-xs text-muted-foreground">附加请求头</p>
            {headers === null ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                已保存：{channel?.headerNames.join('、')}
                <Button type="button" size="xs" variant="outline" onClick={() => setHeaders([])}>
                  重新设置请求头
                </Button>
              </div>
            ) : (
              <>
                {headers.map((row, index) => (
                  <div key={row.key} className="flex gap-2">
                    <Input
                      aria-label={`请求头 ${index + 1} 名称`}
                      placeholder="X-Custom-Header"
                      value={row.name}
                      onChange={(event) => setHeader(row.key, { name: event.target.value })}
                    />
                    <Input
                      aria-label={`请求头 ${index + 1} 值`}
                      type="password"
                      autoComplete="off"
                      value={row.value}
                      onChange={(event) => setHeader(row.key, { value: event.target.value })}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`删除请求头 ${index + 1}`}
                      onClick={() => setHeaders(headers.filter((item) => item.key !== row.key))}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setHeaders([...headers, { key: crypto.randomUUID(), name: '', value: '' }])
                  }
                >
                  <Plus aria-hidden="true" />
                  添加请求头
                </Button>
              </>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            启用渠道
          </label>
        </fieldset>
        {channel && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !channel.enabled}
                onClick={() =>
                  perform(async () => {
                    const result = await client.request(
                      `/channels/${channel.id}/test`,
                      ConnectionCheck,
                      { method: 'POST', timeoutMs: 75_000 },
                    );
                    setChecks((items) => ({ ...items, [channel.id]: result }));
                  })
                }
              >
                测试渠道
              </Button>
              <DeleteButton
                label="删除渠道"
                disabled={busy}
                onDelete={() =>
                  perform(async () => {
                    await client.request(`/channels/${channel.id}`, DeleteResult, {
                      method: 'DELETE',
                    });
                    await queryClient.invalidateQueries({ queryKey: ['models'] });
                    onClose();
                  })
                }
              />
            </div>
            <CheckResult result={checks[channel.id] ?? channel.lastCheck} />
          </div>
        )}
        <div className="space-y-4 border-t pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">模型</h3>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !baseUrl}
                onClick={probe}
              >
                <RefreshCw aria-hidden="true" />
                拉取模型
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setDrafts([...drafts, newDraft()])}
              >
                <Plus aria-hidden="true" />
                添加模型
              </Button>
            </div>
          </div>
          {candidates && (
            <ModelPicker
              candidates={candidates}
              added={added}
              onCancel={() => setCandidates(null)}
              onAdd={(ids) => {
                setDrafts([...drafts, ...ids.map((id) => newDraft(id))]);
                setCandidates(null);
              }}
            />
          )}
          {!drafts.length && (
            <p className="text-xs text-muted-foreground">
              尚无模型。可以从渠道拉取可用模型挑选，也可以手动填写模型 ID。
            </p>
          )}
          {drafts.map((draft, index) => (
            <ModelCard
              key={draft.key}
              index={index}
              draft={draft}
              channelBaseUrl={baseUrl}
              apiFormat={apiFormat}
              profiles={profiles.data ?? []}
              busy={busy}
              check={draft.id ? checks[draft.id] : undefined}
              onChange={(patch) => update(draft.key, patch)}
              onRemove={() => setDrafts(drafts.filter((item) => item.key !== draft.key))}
              onTest={
                draft.id && channel?.enabled
                  ? () =>
                      perform(async () => {
                        const id = draft.id!;
                        const result = await client.request(
                          `/channel-models/${id}/test`,
                          ConnectionCheck,
                          { method: 'POST', timeoutMs: 75_000 },
                        );
                        setChecks((items) => ({ ...items, [id]: result }));
                      })
                  : undefined
              }
            />
          ))}
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          渠道与模型一起保存；测试使用已保存的配置，新增模型需保存后才能测试。
        </p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button type="submit" size="sm" disabled={busy}>
            保存
          </Button>
        </div>
      </form>
    </section>
  );
}

function ModelPicker({
  candidates,
  added,
  onAdd,
  onCancel,
}: {
  candidates: string[];
  added: Set<string>;
  onAdd: (ids: string[]) => void;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const visible = candidates.filter((id) => id.toLowerCase().includes(search.toLowerCase()));
  return (
    <div
      role="group"
      aria-label="选择渠道模型"
      className="space-y-3 rounded-xl border bg-muted/30 p-4"
    >
      <p className="text-xs text-muted-foreground">
        渠道返回 {candidates.length} 个模型，勾选需要添加的模型。
      </p>
      <Input
        aria-label="搜索模型"
        placeholder="搜索模型 ID"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <ul className="max-h-60 space-y-1 overflow-y-auto">
        {visible.map((id) => (
          <li key={id}>
            <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
              <input
                type="checkbox"
                disabled={added.has(id)}
                checked={added.has(id) || picked.has(id)}
                onChange={(event) => {
                  const next = new Set(picked);
                  if (event.target.checked) next.add(id);
                  else next.delete(id);
                  setPicked(next);
                }}
              />
              <span className="min-w-0 break-all">{id}</span>
              {added.has(id) && <span className="text-xs text-muted-foreground">已添加</span>}
            </label>
          </li>
        ))}
        {!visible.length && <li className="px-2 text-xs text-muted-foreground">没有匹配的模型</li>}
      </ul>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={!picked.size} onClick={() => onAdd([...picked])}>
          添加所选（{picked.size}）
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}

function BooleanOverride({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | undefined;
  onChange: (value: boolean | undefined) => void;
}) {
  return (
    <Field label={label}>
      <NativeSelect
        value={value === undefined ? '' : String(value)}
        onChange={(event) =>
          onChange(event.target.value ? event.target.value === 'true' : undefined)
        }
      >
        <option value="">按内置目录</option>
        <option value="true">支持</option>
        <option value="false">不支持</option>
      </NativeSelect>
    </Field>
  );
}

function ModelCard({
  index,
  draft,
  channelBaseUrl,
  apiFormat,
  profiles,
  busy,
  check,
  onChange,
  onRemove,
  onTest,
}: {
  index: number;
  draft: Draft;
  channelBaseUrl: string;
  apiFormat: LlmProtocol;
  profiles: ModelProfile[];
  busy: boolean;
  check?: ConnectionCheck;
  onChange: (patch: Partial<Draft>) => void;
  onRemove: () => void;
  onTest?: () => void;
}) {
  const label = draft.displayName || draft.upstreamModelId || `模型 ${index + 1}`;
  const [compat, setCompat] = useState(
    draft.overrides.compat ? JSON.stringify(draft.overrides.compat, null, 2) : '',
  );
  const [compatError, setCompatError] = useState(false);
  const [template, setTemplate] = useState('');
  const connection = draft.connection ?? {};
  const routes = serviceRoutes[draft.protocol ?? ''];
  const changeConnection = (patch: Partial<typeof connection>) =>
    onChange({ connection: { ...connection, ...patch } });
  const preview = (operation: ServiceOperation) => {
    try {
      return resolveModelOperation(channelBaseUrl, connection, draft.protocol ?? '', operation, {
        id: 'task-preview',
        model: draft.upstreamModelId.replace(/^models\//, ''),
      });
    } catch {
      return '配置无效，保存前请修正地址或路径';
    }
  };
  const protocols = draft.kind ? protocolsByKind[draft.kind] : [];
  const matching = profiles.filter(
    (profile) => profile.kind === draft.kind && profile.protocol === draft.protocol,
  );
  const selectedProfile =
    matching.find((profile) => profile.id === draft.profileId) ??
    matching.find((profile) => profile.matchIds.includes(draft.upstreamModelId)) ??
    matching.find((profile) => profile.generic);
  const overrides = (patch: Partial<Draft['overrides']>) =>
    onChange({ overrides: { ...draft.overrides, ...patch } });
  const number = (value: string) => (value ? Number(value) : undefined);
  // 新模型在类别和协议齐全时默认启用；已保存的模型保持用户的选择，但缺协议时必须停用。
  const enabledFor = (protocol: string | null) =>
    draft.id ? draft.enabled && !!protocol : !!protocol;
  return (
    <fieldset disabled={busy} className="space-y-4 rounded-xl border p-4">
      <legend className="sr-only">{label}</legend>
      <div className="flex items-center justify-between gap-2">
        <h4 className="min-w-0 text-sm font-medium break-all">{label}</h4>
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!onTest || draft.kind !== 'chat' || !draft.enabled}
            onClick={onTest}
          >
            测试模型
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`移除 ${label}`}
            onClick={onRemove}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {routes && (
          <div className="space-y-3 sm:col-span-2">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="接入模板">
                <NativeSelect
                  value={template}
                  onChange={(event) => setTemplate(event.target.value)}
                >
                  <option value="">选择模板（需点击应用）</option>
                  {connectionTemplates
                    .filter((item) => item.protocol === draft.protocol)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!template}
                onClick={() => {
                  const selected = connectionTemplates.find(
                    (item) => item.id === template && item.protocol === draft.protocol,
                  );
                  if (selected)
                    onChange({
                      connection: {
                        baseUrl: selected.baseUrl,
                        routes: serviceRoutes[selected.protocol],
                        templateId: selected.id,
                        templateVersion: connectionTemplateVersion,
                      },
                    });
                }}
              >
                应用模板并替换接入设置
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              当前模板：{connection.templateId ?? '自定义'} · 已存版本{' '}
              {connection.templateVersion ?? '无'} · 内置版本 {connectionTemplateVersion}
              。模板不会自动更新；应用前请核对下方地址与路径差异。
            </p>
            {template && (
              <div className="space-y-1 text-xs break-all text-muted-foreground">
                <p>
                  待应用地址：{connection.baseUrl ?? channelBaseUrl} →{' '}
                  {connectionTemplates.find((item) => item.id === template)?.baseUrl}
                  ；能力档案保持所选值。
                </p>
                {(Object.entries(routes) as [ServiceOperation, string][]).map(
                  ([operation, path]) => (
                    <p key={operation}>
                      {operation}：{connection.routes?.[operation] ?? path} → {path}
                    </p>
                  ),
                )}
              </div>
            )}
            <Field label="模型服务地址（留空继承渠道）">
              <Input
                type="url"
                value={connection.baseUrl ?? ''}
                placeholder={channelBaseUrl}
                onChange={(event) => changeConnection({ baseUrl: event.target.value || undefined })}
              />
            </Field>
            <details className="space-y-2 text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                高级：操作路径和有效地址
              </summary>
              {(Object.keys(routes) as ServiceOperation[]).map((operation) => (
                <div key={operation} className="mt-2 space-y-1">
                  <Field label={`${operation} 相对路径`}>
                    <Input
                      value={connection.routes?.[operation] ?? ''}
                      placeholder={routes[operation]}
                      onChange={(event) => {
                        const next = { ...connection.routes };
                        if (event.target.value) next[operation] = event.target.value;
                        else delete next[operation];
                        changeConnection({ routes: next });
                      }}
                    />
                  </Field>
                  <p className="break-all text-muted-foreground">{preview(operation)}</p>
                </div>
              ))}
            </details>
            <p className="text-xs text-muted-foreground">
              本地校验在保存时执行；拉取目录只证明目录权限。文本测试和目录成功不代表媒体生成可用。真实媒体验证请保存后在画布发起生成，可能计费，不会随保存自动执行。
            </p>
          </div>
        )}
        <Field label="模型 ID">
          <Input
            required
            maxLength={300}
            placeholder="服务商提供的模型 ID"
            value={draft.upstreamModelId}
            onChange={(event) => onChange({ upstreamModelId: event.target.value })}
          />
        </Field>
        <Field label="显示名称">
          <Input
            maxLength={300}
            placeholder="留空使用模型 ID"
            value={draft.displayName}
            onChange={(event) => onChange({ displayName: event.target.value })}
          />
        </Field>
        <Field label="模型类别">
          <NativeSelect
            value={draft.kind ?? ''}
            onChange={(event) => {
              const kind = event.target.value ? ModelKind.parse(event.target.value) : null;
              const options = kind ? protocolsByKind[kind] : [];
              const protocol =
                draft.protocol && options.includes(draft.protocol)
                  ? draft.protocol
                  : kind === 'chat'
                    ? apiFormat
                    : options.length === 1
                      ? options[0]
                      : null;
              setTemplate('');
              onChange({
                kind,
                protocol,
                profileId: null,
                connection: protocol === draft.protocol ? draft.connection : undefined,
                enabled: enabledFor(protocol),
              });
            }}
          >
            <option value="">未分类</option>
            {ModelKind.options.map((kind) => (
              <option key={kind} value={kind}>
                {kindLabels[kind]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="调用协议">
          <NativeSelect
            aria-label="调用协议"
            disabled={!draft.kind}
            value={draft.protocol ?? ''}
            onChange={(event) => {
              const protocol = event.target.value || null;
              setTemplate('');
              onChange({
                protocol,
                profileId: null,
                connection: undefined,
                enabled: enabledFor(protocol),
              });
            }}
          >
            <option value="">{draft.kind ? '选择协议' : '先选择类别'}</option>
            {protocols.map((protocol) => (
              <option key={protocol} value={protocol}>
                {protocolLabels[protocol] ?? protocol}
              </option>
            ))}
          </NativeSelect>
          <span className="text-xs text-muted-foreground">
            切换类别或协议会清除原接入设置；取消编辑可保留原配置。
          </span>
        </Field>
        {draft.kind === 'chat' && (
          <>
            <Field label="上下文窗口">
              <Input
                type="number"
                min={1}
                placeholder={draft.metadata ? `默认 ${draft.metadata.contextWindow}` : '按内置目录'}
                value={draft.overrides.contextWindow ?? ''}
                onChange={(event) => overrides({ contextWindow: number(event.target.value) })}
              />
            </Field>
            <Field label="最大输出 Token">
              <Input
                type="number"
                min={1}
                placeholder={draft.metadata ? `默认 ${draft.metadata.maxTokens}` : '按内置目录'}
                value={draft.overrides.maxTokens ?? ''}
                onChange={(event) => overrides({ maxTokens: number(event.target.value) })}
              />
            </Field>
            <BooleanOverride
              label="推理能力"
              value={draft.overrides.reasoning}
              onChange={(reasoning) => overrides({ reasoning })}
            />
            <BooleanOverride
              label="图片输入"
              value={draft.overrides.imageInput}
              onChange={(imageInput) => overrides({ imageInput })}
            />
            {draft.metadata?.needsConfirmation && (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                元数据需确认：内置目录没有该模型，当前使用保守默认值，请按供应商文档填写上限。
              </p>
            )}
            <details className="text-xs sm:col-span-2">
              <summary className="cursor-pointer text-muted-foreground">高级：compat 开关</summary>
              <Textarea
                aria-label="compat JSON"
                className="mt-2 min-h-24 font-mono text-xs"
                placeholder="{}"
                value={compat}
                onChange={(event) => {
                  setCompat(event.target.value);
                  try {
                    const value = event.target.value.trim()
                      ? (JSON.parse(event.target.value) as Record<string, never>)
                      : undefined;
                    setCompatError(false);
                    overrides({ compat: value });
                  } catch {
                    setCompatError(true);
                  }
                }}
              />
              {compatError && <p className="mt-1 text-destructive">JSON 格式无效，暂未应用。</p>}
            </details>
          </>
        )}
        {draft.kind && draft.kind !== 'chat' && draft.protocol && (
          <Field label="能力档案">
            <NativeSelect
              aria-label="能力档案"
              value={draft.profileId ?? ''}
              onChange={(event) => onChange({ profileId: event.target.value || null })}
            >
              <option value="">按模型 ID 自动匹配</option>
              {matching.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </NativeSelect>
            {selectedProfile && (
              <span className="text-xs text-muted-foreground">
                {selectedProfile.generic ? '通用保守档案，需核对供应商能力' : '精确型号档案'}：
                {selectedProfile.modes.map((mode) => mode.name).join('、')}；
                {selectedProfile.inputs
                  .map((input) => `${input.kind} 最多 ${input.maxCount} 项`)
                  .join('，')}
                。
                {selectedProfile.params
                  .map(
                    (param) =>
                      `${param.name}：${param.values?.join('/') ?? `${param.min ?? ''}–${param.max ?? ''}`}`,
                  )
                  .join('；')}
              </span>
            )}
          </Field>
        )}
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        启用模型
      </label>
      <CheckResult result={check ?? draft.lastCheck} />
    </fieldset>
  );
}

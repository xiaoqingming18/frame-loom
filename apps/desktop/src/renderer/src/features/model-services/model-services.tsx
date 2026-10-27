import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CircleHelp, Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import {
  Channel,
  ChannelWrite,
  ConnectionCheck,
  DeleteResult,
  LlmProtocol,
  ModelProbeResult,
  ModelProfileList,
  ModelImportPackage,
  GenerationJob,
  MediaFile,
  type GenerationRequest,
  type ChannelModel,
  type ChannelModelSave,
  type ModelProbeRequest,
  ModelProfile,
} from '@frame-loom/contracts';
import { Button } from '@frame-loom/ui/components/button';
import { Input } from '@frame-loom/ui/components/input';
import { Textarea } from '@frame-loom/ui/components/textarea';
import { NativeSelect } from '@frame-loom/ui/components/native-select';
import { Popover, PopoverTrigger, PopoverContent } from '@frame-loom/ui/components/popover';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@frame-loom/ui/components/dialog';
import type { EngineClient } from '@/lib/engine-client';
import { catalogQuery, channelsQuery, modelsQuery } from '@/lib/model-queries';
import { kindLabels } from './labels';
import { CatalogImport } from './catalog-import';
import { VoicePicker } from './voice-picker';
import { ModelUpgradeNotice } from './model-upgrade-report';

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
      <CatalogImport client={client} />
      <ModelUpgradeNotice client={client} />
    </section>
  );
}

type Draft = ChannelModelSave & {
  key: string;
  metadata?: ChannelModel['metadata'];
  lastCheck?: ChannelModel['lastCheck'];
  lastMediaCheck?: ChannelModel['lastMediaCheck'];
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
  lastMediaCheck: model.lastMediaCheck,
  definitionId: model.definitionId,
  connectionId: model.connectionId,
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
  const [configurationCheck, setConfigurationCheck] = useState('');
  const catalog = useQuery(catalogQuery(client));
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
  function validateConfiguration() {
    if (drafts.some((draft) => draft.enabled && (!draft.kind || !draft.protocol))) {
      setError('启用的模型需要先选择模型定义和接入。');
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
        definitionId: draft.definitionId,
        connectionId: draft.connectionId,
        overrides: draft.overrides,
        connection: draft.connection,
        enabled: draft.enabled,
      })),
    });
    if (!parsed.success) {
      setError('请检查渠道名称、HTTP(S) 接口地址、请求头名称与模型 ID。');
      return;
    }
    return parsed.data;
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = validateConfiguration();
    if (!data) return;
    perform(async () => {
      await client.request(channel ? `/channels/${channel.id}` : '/channels', Channel, {
        method: channel ? 'PATCH' : 'POST',
        body: data,
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
      <form onSubmit={submit} onChange={() => setConfigurationCheck('')} className="space-y-6">
        <div className="space-y-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setError('');
              setConfigurationCheck('');
              if (validateConfiguration())
                setConfigurationCheck(
                  '草稿格式检查通过；未访问目录或发起调用。执行能力仍需服务端校验，保存后才能实测。',
                );
            }}
          >
            检查草稿配置
          </Button>
          {configurationCheck && (
            <p role="status" className="text-xs text-muted-foreground">
              {configurationCheck}
            </p>
          )}
        </div>
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          <Field label="渠道名称">
            <Input
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <details className="space-y-2 sm:col-span-2">
            <summary className="cursor-pointer text-xs">高级：目录方式</summary>
            <Field label="目录协议">
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
            <p className="text-xs text-muted-foreground">
              只影响拉取目录；模型调用由所选定义和接入决定。目录不可访问时可手动添加模型。
            </p>
          </details>
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
            <Help label="接口地址帮助">
              填写供应商 API 根地址。接入留空地址时继承此地址，特殊路径与多域名在共享接入中配置。
            </Help>
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
          <details className="space-y-2 sm:col-span-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              高级：附加请求头
            </summary>
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
          </details>
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
                检查已保存目录权限
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
              catalog={catalog.data}
              client={client}
              allowTest={
                !!channel?.enabled &&
                name === channel.name &&
                baseUrl === channel.baseUrl &&
                apiFormat === channel.apiFormat &&
                enabled === channel.enabled &&
                !apiKey &&
                !clearKey &&
                (headers === null || (!channel.headerNames.length && !headers.length)) &&
                JSON.stringify({ ...draft, lastCheck: undefined, lastMediaCheck: undefined }) ===
                  JSON.stringify(
                    models.find((item) => item.id === draft.id)
                      ? {
                          ...draftFrom(models.find((item) => item.id === draft.id)!),
                          lastCheck: undefined,
                          lastMediaCheck: undefined,
                        }
                      : null,
                  )
              }
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
        {(catalog.error || profiles.error) && (
          <p role="alert" className="text-xs text-destructive">
            {(catalog.error ?? profiles.error)?.message}
          </p>
        )}
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

function Help({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoringFocus = useRef(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          ref={trigger}
          onMouseEnter={() => setOpen(true)}
          onFocus={() => {
            if (!restoringFocus.current) setOpen(true);
          }}
          onClick={(event) => {
            event.preventDefault();
            setOpen(true);
          }}
        >
          <CircleHelp aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        onEscapeKeyDown={() => setOpen(false)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoringFocus.current = true;
          trigger.current?.focus();
          restoringFocus.current = false;
        }}
        className="text-xs"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

function ModelCard({
  index,
  draft,
  profiles,
  busy,
  check,
  onChange,
  onRemove,
  onTest,
  catalog,
  client,
  allowTest,
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
  catalog?: ModelImportPackage;
  client: EngineClient;
  allowTest: boolean;
}) {
  const label = draft.displayName || draft.upstreamModelId || `模型 ${index + 1}`;
  const definition = catalog?.definitions.find((item) => item.id === draft.definitionId);
  const profile =
    definition && definition.kind !== 'chat'
      ? ModelProfile.parse(definition.profile)
      : profiles.find(
          (item) => item.id === draft.profileId || item.matchIds.includes(draft.upstreamModelId),
        );
  return (
    <fieldset disabled={busy} className="space-y-4 rounded-xl border p-4">
      <legend className="sr-only">{label}</legend>
      <div className="flex items-center justify-between gap-2">
        <h4 className="min-w-0 text-sm font-medium break-all">{label}</h4>
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="逻辑模型">
          <NativeSelect
            value={draft.definitionId ?? ''}
            onChange={(event) => {
              const selected = catalog?.definitions.find((item) => item.id === event.target.value);
              const connection = catalog?.connections.find(
                (item) => item.protocol === selected?.protocol,
              );
              onChange({
                definitionId: selected?.id ?? null,
                connectionId: connection?.id ?? null,
                kind: selected?.kind ?? null,
                protocol: selected?.protocol ?? null,
                profileId:
                  selected?.kind !== 'chat' && selected
                    ? ModelProfile.parse(selected.profile).id
                    : null,
                connection: undefined,
                enabled: !!selected && !!connection,
                upstreamModelId: draft.upstreamModelId || selected?.aliases[0] || '',
                lastCheck: null,
                lastMediaCheck: null,
              });
            }}
          >
            <option value="">{draft.id ? '旧配置（选择定义以升级）' : '选择模型定义'}</option>
            {catalog?.definitions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="接入">
          <NativeSelect
            aria-label="接入"
            disabled={!definition}
            value={draft.connectionId ?? ''}
            onChange={(event) =>
              onChange({
                connectionId: event.target.value || null,
                lastCheck: null,
                lastMediaCheck: null,
              })
            }
          >
            <option value="">选择接入</option>
            {catalog?.connections
              .filter((item) => item.protocol === definition?.protocol)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </NativeSelect>
        </Field>
        <Field label="模型 ID">
          <Input
            required
            maxLength={300}
            placeholder="供应商提供的上游 ID"
            value={draft.upstreamModelId}
            onChange={(event) =>
              onChange({
                upstreamModelId: event.target.value,
                lastCheck: null,
                lastMediaCheck: null,
              })
            }
          />
        </Field>
        <Field label="显示名称">
          <Input
            maxLength={300}
            value={draft.displayName}
            onChange={(event) => onChange({ displayName: event.target.value })}
          />
        </Field>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {draft.kind ? kindLabels[draft.kind] : '未分类'} ·{' '}
        {definition ? `能力 ${definition.capabilityVersion}` : '旧配置保留原协议'}
        <Help label="模型与接入帮助">
          模型定义自动决定类别、参数与模式；上游 ID
          来自供应商。接入继承渠道地址和密钥，多域名及特殊路径在共享接入中管理。
        </Help>
      </div>
      {profile && (
        <details className="text-xs">
          <summary className="cursor-pointer">有效能力与参数</summary>
          <p className="mt-2 text-muted-foreground">
            {profile.modes.map((mode) => mode.name).join('、')}；
            {profile.params
              .map(
                (param) =>
                  `${param.name}：${param.values?.join('/') ?? `${param.min ?? ''}–${param.max ?? ''}`}`,
              )
              .join('；')}
          </p>
        </details>
      )}
      <details className="space-y-2 text-xs">
        <summary className="cursor-pointer">高级：模型限制</summary>
        <Field label="并发上限（只能收窄）">
          <Input
            type="number"
            min={1}
            max={profile?.runtime.concurrency ?? 16}
            value={draft.overrides.concurrency ?? ''}
            onChange={(event) =>
              onChange({
                overrides: {
                  ...draft.overrides,
                  concurrency: event.target.value ? Number(event.target.value) : undefined,
                },
              })
            }
          />
        </Field>
        {draft.kind === 'chat' && (
          <>
            {(['reasoning', 'imageInput'] as const).map((key) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.overrides[key] ?? draft.metadata?.[key] ?? false}
                  onChange={(event) =>
                    onChange({ overrides: { ...draft.overrides, [key]: event.target.checked } })
                  }
                />
                {key === 'reasoning' ? '推理能力' : '图片输入能力'}
              </label>
            ))}
            <Field label="上下文窗口">
              <Input
                type="number"
                min={1}
                value={draft.overrides.contextWindow ?? ''}
                onChange={(event) =>
                  onChange({
                    overrides: {
                      ...draft.overrides,
                      contextWindow: event.target.value ? Number(event.target.value) : undefined,
                    },
                  })
                }
              />
            </Field>
            <Field label="最大输出 Token">
              <Input
                type="number"
                min={1}
                value={draft.overrides.maxTokens ?? ''}
                onChange={(event) =>
                  onChange({
                    overrides: {
                      ...draft.overrides,
                      maxTokens: event.target.value ? Number(event.target.value) : undefined,
                    },
                  })
                }
              />
            </Field>
          </>
        )}
      </details>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={!draft.protocol || (!draft.id && !definition)}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        启用模型
      </label>
      <CheckResult result={check ?? draft.lastCheck} />
      {draft.id && !allowTest && (
        <p className="text-xs text-muted-foreground">配置有未保存改动，请保存后再测试。</p>
      )}
      {draft.id && draft.kind === 'chat' && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!onTest || !draft.enabled || !allowTest}
          onClick={onTest}
        >
          测试已保存文本模型（可能计费）
        </Button>
      )}
      {draft.id && profile && (
        <MediaTest
          key={`${draft.id}:${draft.definitionId}:${draft.connectionId}:${draft.upstreamModelId}`}
          client={client}
          modelId={draft.id}
          profile={profile}
          check={draft.lastMediaCheck}
          disabled={!allowTest || !draft.enabled}
        />
      )}
    </fieldset>
  );
}

function MediaTest({
  client,
  modelId,
  profile,
  check,
  disabled,
}: {
  client: EngineClient;
  modelId: string;
  profile: ModelProfile;
  check?: ChannelModel['lastMediaCheck'];
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('测试');
  const [mode, setMode] = useState(profile.modes[0].id);
  const [jobId, setJobId] = useState<string | undefined>(check?.jobId);
  const [error, setError] = useState('');
  const [inputs, setInputs] = useState<GenerationRequest['inputs']>([]);
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useState<GenerationRequest['params']>({});
  const queryClient = useQueryClient();
  const job = useQuery({
    queryKey: ['generation', 'settings-test', jobId],
    enabled: !!jobId,
    queryFn: ({ signal }) => client.request(`/generation-jobs/${jobId}`, GenerationJob, { signal }),
    refetchInterval: (query) =>
      query.state.data &&
      ['succeeded', 'failed', 'cancelled', 'paused', 'submit_unknown', 'download_failed'].includes(
        query.state.data.status,
      )
        ? false
        : 1000,
  });
  useEffect(() => {
    if (job.data?.status === 'succeeded')
      void queryClient.invalidateQueries({ queryKey: ['models'] });
  }, [job.data?.status, queryClient]);
  async function submit() {
    setBusy(true);
    setError('');
    try {
      const result = await client.request('/generation-jobs', GenerationJob, {
        method: 'POST',
        body: { modelId, mode, prompt, inputs, params, source: 'test' },
      });
      setJobId(result.id);
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['models'] });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '测试失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 text-xs">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={
          disabled ||
          (!!jobId &&
            (!job.data ||
              ['pending', 'submitting', 'running', 'downloading'].includes(job.data.status)))
        }
        onClick={() => setOpen(true)}
      >
        {profile.kind === 'tts' ? '音色管理与试听' : '实际媒体调用测试'}
      </Button>
      <p className="text-muted-foreground">
        {job.data
          ? `测试任务：${job.data.status} · ${job.data.errorMessage ?? ''}`
          : check
            ? `已验证模式 ${check.mode} · ${check.checkedAt}`
            : '尚未验证实际媒体调用'}
      </p>
      {job.error && <p role="alert">{job.error.message}</p>}
      {job.data && (
        <div className="space-y-2">
          <p className="break-all text-muted-foreground">
            调用版本：{job.data.configVersion ?? '历史版本未记录'}
            {job.data.definitionVersion && ` · 定义 ${job.data.definitionVersion}`}
          </p>
          {job.data.outputs.map(
            (media) =>
              media.mime.startsWith('audio/') && (
                <div key={media.sha256} className="space-y-1">
                  <audio
                    controls
                    preload="metadata"
                    aria-label="语音测试结果"
                    src={`frame-media://${media.sha256}`}
                    className="w-full"
                  />
                  <p className="text-muted-foreground">
                    {media.mime} ·{' '}
                    {media.durationMs == null ? '时长未知' : `${media.durationMs / 1000} 秒`} ·{' '}
                    {media.sampleRate ?? '未知'} Hz · {media.channels ?? '未知'} 声道
                  </p>
                </div>
              ),
          )}
          {job.data.usage != null && (
            <details>
              <summary>供应商用量</summary>
              <pre className="overflow-auto">{JSON.stringify(job.data.usage, null, 2)}</pre>
            </details>
          )}
          {job.data.recoveryAction && job.data.recoveryAction !== 'none' && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void client
                  .request(`/generation-jobs/${jobId}/resubmit`, GenerationJob, { method: 'POST' })
                  .then((result) => {
                    setJobId(result.id);
                    return job.refetch();
                  })
                  .catch((failure: Error) => setError(failure.message))
                  .finally(() => setBusy(false));
              }}
            >
              恢复测试任务
            </Button>
          )}
          {!['succeeded', 'cancelled'].includes(job.data.status) && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void client
                  .request(`/generation-jobs/${jobId}/cancel`, GenerationJob, { method: 'POST' })
                  .then(() => job.refetch())
                  .catch((failure: Error) => setError(failure.message))
                  .finally(() => setBusy(false));
              }}
            >
              本地放弃（远端可能仍计费）
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent overlayClassName="z-[51]" className="z-[52] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {profile.kind === 'tts' ? '音色管理与试听' : '实际媒体调用测试'}
            </DialogTitle>
            <DialogDescription>
              将使用已保存的配置向供应商发起一次真实调用，可能计费。草稿改动不会用于测试；成功仅证明本次绑定、模式与参数。
            </DialogDescription>
          </DialogHeader>
          <Field label="测试模式">
            <NativeSelect
              value={mode}
              onChange={(event) => {
                setMode(event.target.value);
                setInputs([]);
              }}
            >
              {profile.modes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="测试提示词">
            <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          </Field>
          {profile.kind === 'tts' && (
            <VoicePicker
              key={modelId}
              client={client}
              modelId={modelId}
              value={String(params.voice ?? params.voice_id ?? '')}
              onChange={(key, value) => setParams({ ...params, [key]: value })}
            />
          )}
          {profile.params
            .filter((param) => profile.kind !== 'tts' || !['voice', 'voice_id'].includes(param.key))
            .map((param) => (
              <Field key={param.key} label={`测试${param.name}`}>
                {param.type === 'boolean' ? (
                  <NativeSelect
                    value={String(params[param.key] ?? param.default ?? false)}
                    onChange={(event) =>
                      setParams({ ...params, [param.key]: event.target.value === 'true' })
                    }
                  >
                    <option value="true">开启</option>
                    <option value="false">关闭</option>
                  </NativeSelect>
                ) : param.values ? (
                  <NativeSelect
                    value={String(params[param.key] ?? param.default)}
                    onChange={(event) =>
                      setParams({
                        ...params,
                        [param.key]:
                          param.type === 'number' ? Number(event.target.value) : event.target.value,
                      })
                    }
                  >
                    {param.values.map((value) => (
                      <option key={String(value)} value={String(value)}>
                        {String(value)}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <Input
                    type={param.type === 'number' ? 'number' : 'text'}
                    min={param.min}
                    max={param.max}
                    value={String(params[param.key] ?? param.default ?? '')}
                    onChange={(event) =>
                      setParams({
                        ...params,
                        [param.key]:
                          param.type === 'number' ? Number(event.target.value) : event.target.value,
                      })
                    }
                  />
                )}
              </Field>
            ))}
          {mode !== 'text' && profile.inputs.length > 0 && (
            <Field label="参考素材（按选择顺序上传）">
              <Input
                type="file"
                multiple
                disabled={busy}
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])];
                  if (!files.length) return;
                  setError('');
                  setBusy(true);
                  void Promise.all(
                    files.map((file) =>
                      client.request('/media', MediaFile, {
                        method: 'POST',
                        body: file,
                        timeoutMs: 120_000,
                      }),
                    ),
                  )
                    .then((mediaFiles) => {
                      setInputs(
                        mediaFiles.map((media, index) => {
                          const kind = media.mime.split('/')[0];
                          if (kind !== 'image' && kind !== 'video' && kind !== 'audio')
                            throw new Error('素材类别无效');
                          return {
                            sha256: media.sha256,
                            kind,
                            role:
                              mode === 'frames'
                                ? index === 0
                                  ? 'first_frame'
                                  : 'last_frame'
                                : 'reference',
                          };
                        }),
                      );
                    })
                    .catch((failure: Error) => setError(failure.message))
                    .finally(() => setBusy(false));
                }}
              />
            </Field>
          )}
          {inputs.map((input, index) => (
            <Field
              key={`${input.sha256}-${index}`}
              label={`素材 ${index + 1}（${input.kind}）角色`}
            >
              <NativeSelect
                value={input.role}
                onChange={(event) =>
                  setInputs(
                    inputs.map((item, position) =>
                      position === index
                        ? { ...item, role: event.target.value as typeof input.role }
                        : item,
                    ),
                  )
                }
              >
                {['reference', 'first_frame', 'last_frame'].map((role) => (
                  <option key={role} value={role}>
                    {{ reference: '参考', first_frame: '首帧', last_frame: '尾帧' }[role]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ))}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={
                busy ||
                !prompt.trim() ||
                (profile.kind === 'tts' && !String(params.voice ?? params.voice_id ?? '').trim()) ||
                (mode !== 'text' && !!profile.inputs.length && !inputs.length)
              }
              onClick={() => void submit()}
            >
              确认调用并承担可能费用
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

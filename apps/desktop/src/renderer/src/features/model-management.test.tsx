import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getProtocol, emptyCapability, resolveEndpoints } from '@frame-loom/contracts';
import { Channel, Model, ModelWrite } from '@frame-loom/contracts';
import { TooltipProvider } from '@frame-loom/ui/components/tooltip';
import type { EngineClient } from '@/lib/engine-client';
import { ModelServices } from './model-services/model-services';
import { ModelDefaultsSettings } from './model-services/model-defaults';
import { ChannelForm } from './model-services/channel-form';
import { CatalogDialog } from './model-services/catalog-dialog';
import { ModelEditor } from './model-services/model-editor/model-editor';
import { modelWrite } from './model-services/model-editor/use-model-draft';
import { NumberField, TagsField } from './model-services/model-editor/capability-controls';
import { EndpointSection } from './model-services/model-editor/endpoint-section';
import { ModelTest } from './model-services/model-test';
import { VoicePicker } from './model-services/voice-picker';
import { CapabilityTab } from './model-services/model-editor/capability-tab';
import { CapabilityImage } from './model-services/model-editor/capability-image';
import { CapabilityVideo } from './model-services/model-editor/capability-video';
import { CapabilityTts } from './model-services/model-editor/capability-tts';
import { ProtocolPicker } from './model-services/model-editor/protocol-picker';
import { ExtrasTab } from './model-services/model-editor/extras-tab';
import { BasicTab } from './model-services/model-editor/basic-tab';
import { ChannelDetail } from './model-services/channel-detail';
import { CanvasPreview } from './model-services/model-editor/canvas-preview';
import {
  restoreCapabilityGroup,
  type Capability,
  type ImageCap,
  type VideoCap,
  type TtsCap,
} from '@frame-loom/contracts';

const channelId = '11111111-1111-4111-8111-111111111111';
const modelId = '22222222-2222-4222-8222-222222222222';
const channel = Channel.parse({
  id: channelId,
  name: '本地测试',
  baseUrl: 'http://127.0.0.1:9000/v1',
  catalogFormat: 'openai',
  concurrency: 2,
  enabled: true,
  hasKey: true,
  keyHint: '••••1234',
  hasSecretKey: false,
  headerNames: ['X-Custom'],
  createdAt: '2026-10-29T00:00:00Z',
  updatedAt: '2026-10-29T00:00:00Z',
});
function model(
  protocolId = 'openai-responses',
  kind: Model['kind'] = 'chat',
  patch: Partial<Model> = {},
) {
  const descriptor = getProtocol(protocolId)!;
  const write = ModelWrite.parse({
    protocolId,
    kind,
    upstreamModelId: 'test-model',
    displayName: '测试模型',
    capability: descriptor.templates[kind],
    enabled: true,
  });
  return Model.parse({
    ...write,
    id: modelId,
    channelId,
    configHash: 'hash',
    lastCheck: null,
    endpoints: resolveEndpoints(channel, write, descriptor),
    blockedReason: null,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    ...patch,
  });
}
const queries: QueryClient[] = [];
beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
);
afterEach(() => {
  cleanup();
  queries.splice(0).forEach((query) => query.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function wrap(children: ReactNode) {
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queries.push(query);
  return render(
    <QueryClientProvider client={query}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>,
  );
}
function clientFor(
  handler: (path: string, init: Parameters<EngineClient['request']>[2]) => unknown,
) {
  const calls: { path: string; init: Parameters<EngineClient['request']>[2] }[] = [];
  const client: EngineClient = {
    async request(path, schema, init) {
      calls.push({ path, init });
      return schema.parse(await handler(path, init));
    },
    stream() {
      throw new Error('此测试不订阅事件流');
    },
  };
  return { client, calls };
}
function change(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
const noop = () => {};

it('渠道空状态进入添加，预设只填渠道，不创建模型', async () => {
  const { client, calls } = clientFor(() => []);
  wrap(<ModelServices engineClient={client} />);
  fireEvent.click(await screen.findByRole('button', { name: '添加第一个渠道' }));
  fireEvent.click(screen.getByRole('button', { name: 'Google Gemini' }));
  expect(screen.getByLabelText<HTMLInputElement>('服务地址').value).toContain('googleapis.com');
  expect(screen.getByLabelText<HTMLInputElement>('渠道名称').value).toBe('Google Gemini');
  expect(calls.every((call) => !call.init?.method)).toBe(true);
});
it.each([false, true])('编辑渠道留空保留凭据，清除勾选=%s，保存并读取', async (clear) => {
  const { client, calls } = clientFor(() => channel);
  const saved = vi.fn(async () => {});
  wrap(<ChannelForm client={client} channel={channel} onClose={noop} onSaved={saved} />);
  if (clear) fireEvent.click(screen.getByRole('checkbox', { name: '清除已保存的 Key' }));
  fireEvent.click(screen.getByRole('button', { name: '保存并读取模型' }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith(channel, true));
  expect(calls[0].init).toMatchObject({
    method: 'PATCH',
    body: { name: channel.name, baseUrl: channel.baseUrl },
  });
  const body = calls[0].init!.body as Record<string, unknown>;
  expect(body).not.toHaveProperty('headers');
  expect(body).not.toHaveProperty('secretKey');
  if (clear) expect(body.apiKey).toBe('');
  else expect(body).not.toHaveProperty('apiKey');
});
it('无效服务地址就地报错，重新设置请求头只在保存时发送', async () => {
  const { client, calls } = clientFor(() => channel);
  wrap(<ChannelForm client={client} channel={channel} onClose={noop} onSaved={async () => {}} />);
  change('服务地址', 'https://test.invalid/v1/models');
  fireEvent.click(screen.getByRole('button', { name: '保存并读取模型' }));
  expect((await screen.findByRole('alert')).textContent).toContain('服务根地址');
  expect(calls).toHaveLength(0);
  change('服务地址', channel.baseUrl);
  fireEvent.click(screen.getByRole('checkbox', { name: /重新设置请求头/, hidden: true }));
  fireEvent.click(screen.getByRole('button', { name: '添加请求头', hidden: true }));
  change('请求头名称 1', 'X-Test');
  change('请求头值 1', 'only-test');
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() =>
    expect(calls[0]?.init?.body).toMatchObject({ headers: { 'X-Test': 'only-test' } }),
  );
});
it('读取候选：已添加禁用、未知类别不可选、批量添加空能力卡', async () => {
  const candidates = [
    {
      id: 'test-model',
      kind: 'chat',
      protocolId: 'openai-responses',
      endpointTypes: [],
      outputModalities: [],
    },
    { id: 'unknown', kind: null, protocolId: null, endpointTypes: [], outputModalities: [] },
    { id: 'image', kind: 'image', protocolId: null, endpointTypes: [], outputModalities: [] },
  ];
  const { client, calls } = clientFor((path, init) =>
    path === '/channels/catalog'
      ? candidates
      : (init!.body as ModelWrite[]).map((write) => model('openai-images', 'image', { ...write })),
  );
  const added = vi.fn(async () => {});
  wrap(
    <CatalogDialog
      client={client}
      channel={channel}
      models={[model()]}
      onClose={noop}
      onAdded={added}
    />,
  );
  await screen.findByText('已添加');
  expect(screen.getByRole<HTMLButtonElement>('checkbox', { name: '选择 unknown' }).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: '全选未添加' }));
  fireEvent.click(screen.getByRole('button', { name: '添加所选 (1)' }));
  await waitFor(() => expect(added).toHaveBeenCalled());
  expect(calls.at(-1)?.init?.body).toMatchObject([
    { kind: 'image', protocolId: null, enabled: false, capability: emptyCapability('image') },
  ]);
});
it('渠道待选徽标、模型筛选与搜索、禁用原因、删除确认', async () => {
  const pending = model('openai-images', 'image', {
    id: '33333333-3333-4333-8333-333333333333',
    displayName: '待设置图像',
    protocolId: null,
    enabled: false,
    blockedReason: '请先选择协议',
    capability: emptyCapability('image'),
  });
  const { client } = clientFor((path) => (path === '/channels' ? [channel] : [model(), pending]));
  wrap(<ModelServices engineClient={client} />);
  expect(await screen.findByText('1 个模型待选协议')).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: /本地测试/ }));
  expect(screen.getAllByText('尚无当前配置的测试结果，配置修改后旧结果失效')).toHaveLength(2);
  expect(
    screen.getByRole<HTMLButtonElement>('switch', { name: '启用模型 待设置图像' }).disabled,
  ).toBe(true);
  change('筛选类别', 'image');
  expect(screen.queryByText('测试模型')).toBeNull();
  change('筛选类别', 'all');
  change('搜索模型', '待设置');
  expect(screen.queryByText('测试模型')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  expect(await screen.findByText('将同时删除 2 个模型，已生成的资产不受影响')).toBeTruthy();
});
it('模型草稿取消需要确认，类别切换清空协议，未保存禁止生成', async () => {
  const { client } = clientFor(() => null);
  const closed = vi.fn();
  wrap(
    <ModelEditor
      client={client}
      channel={channel}
      model={model()}
      onClose={closed}
      onSaved={async () => {}}
      onTest={noop}
      onOpenStorage={noop}
    />,
  );
  change('显示名', '修改');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '生成测试' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '图像' }));
  expect(await screen.findByText('将清空协议与能力卡')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  expect(screen.getByRole('button', { name: '图像' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(closed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
  expect(closed).toHaveBeenCalledOnce();
});
it('数值留空与零不同，标签能连续输入逗号分隔的多个值', () => {
  const number = vi.fn();
  const tags = vi.fn();
  function Fields() {
    const [values, setValues] = useState<string[]>([]);
    return (
      <>
        <NumberField path="contextWindow" value={5} onChange={number} label="长度" />
        <TagsField
          path="reasoningLevels"
          values={values}
          onChange={(next) => {
            setValues(next);
            tags(next);
          }}
          label="档位"
        />
      </>
    );
  }
  wrap(<Fields />);
  change('长度', '');
  expect(number).toHaveBeenLastCalledWith(undefined);
  change('长度', '0');
  expect(number).toHaveBeenLastCalledWith(0);
  change('档位', 'low,');
  expect(screen.getByLabelText<HTMLInputElement>('档位').value).toBe('low,');
  change('档位', 'low,high');
  expect(tags).toHaveBeenLastCalledWith(['low', 'high']);
});
it.each([
  'https://api.test.invalid',
  'https://api.test.invalid/v1',
  'https://api.test.invalid/gateway/v1',
])('地址预览统一解析 %s', (baseUrl) => {
  const draft = modelWrite(model('minimax-video-v2', 'video'));
  const value = { ...channel, baseUrl };
  wrap(<EndpointSection channel={value} draft={draft} onChange={noop} />);
  const expected = resolveEndpoints(value, draft, getProtocol('minimax-video-v2')!);
  expect(screen.getByRole('region', { name: '请求地址' }).textContent).toContain(
    expected.operations.submit!.url,
  );
});
it('覆盖地址可推导、外部主机需确认，坏地址仍可继续输入', () => {
  function Endpoints() {
    const [draft, setDraft] = useState(modelWrite(model('minimax-video-v2', 'video')));
    return <EndpointSection channel={channel} draft={draft} onChange={setDraft} />;
  }
  wrap(<Endpoints />);
  change('使用完整地址覆盖（可选）', 'https://other.invalid/v2/video_generation');
  expect(screen.getByText('已根据提交地址推导查询地址')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: /密钥将发送到/ }));
  expect(screen.getByRole('checkbox', { name: /密钥将发送到/ }).getAttribute('aria-checked')).toBe(
    'true',
  );
  change('使用完整地址覆盖（可选）', 'bad');
  expect(screen.getByLabelText('使用完整地址覆盖（可选）')).toBeTruthy();
  change('使用完整地址覆盖（可选）', 'https://other.invalid/custom');
  expect(screen.getByLabelText('查询地址')).toBeTruthy();
});
it('媒体生成需计费确认，文本显示两步测试结果', async () => {
  const { client, calls } = clientFor(() => ({
    type: 'chat',
    ok: true,
    configHash: 'hash',
    checkedAt: channel.createdAt,
    code: null,
    message: '通过',
    steps: { connection: true, reply: true },
  }));
  const view = wrap(
    <ModelTest client={client} model={model('openai-images', 'image')} onClose={noop} />,
  );
  expect(screen.getByText(/可能产生费用/)).toBeTruthy();
  expect(calls).toHaveLength(0);
  view.unmount();
  wrap(<ModelTest client={client} model={model()} onClose={noop} />);
  fireEvent.click(screen.getByRole('button', { name: '开始测试' }));
  expect(await screen.findByText('连接：通过')).toBeTruthy();
  expect(screen.getByText('文本回复：通过')).toBeTruthy();
});
it('默认模型按类别筛选，禁用模型与禁用渠道不出现', async () => {
  const models = [
    model(),
    model('openai-speech', 'tts', {
      id: '33333333-3333-4333-8333-333333333333',
      displayName: 'TTS模型',
    }),
    model('openai-responses', 'chat', { displayName: '已禁用', enabled: false }),
  ];
  const { client, calls } = clientFor((path, init) =>
    path === '/channels'
      ? [channel]
      : path === '/models'
        ? models
        : { chat: null, image: null, video: null, tts: null, ...(init?.body as object) },
  );
  wrap(<ModelDefaultsSettings engineClient={client} onOpenModels={noop} />);
  const chat = await screen.findByLabelText('文本');
  expect(within(chat).queryByRole('option', { name: /TTS模型/ })).toBeNull();
  expect(screen.queryByRole('option', { name: /已禁用/ })).toBeNull();
  fireEvent.change(chat, { target: { value: modelId } });
  await waitFor(() => expect(calls.at(-1)?.init?.body).toEqual({ chat: modelId }));
});
it('拉取音色失败保留手填 ID', async () => {
  const { client } = clientFor((path) => {
    if (path.endsWith('/remote')) throw new Error('模拟拉取失败');
    return { param: 'voice', canManual: true, canFetch: true, voices: [] };
  });
  function Picker() {
    const [voice, setVoice] = useState('');
    return (
      <VoicePicker
        client={client}
        modelId={modelId}
        value={voice}
        onChange={(_, value) => setVoice(value)}
      />
    );
  }
  wrap(<Picker />);
  await screen.findByLabelText('音色 ID');
  change('音色 ID', 'my-voice');
  fireEvent.click(screen.getByRole('button', { name: '拉取供应商音色' }));
  expect(await screen.findByText('模拟拉取失败')).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>('音色 ID').value).toBe('my-voice');
});

it('协议目录按类别和路径搜索，切换有冲突时先确认', async () => {
  const view = wrap(<ProtocolPicker kind="image" value={null} onChange={noop} />);
  expect(screen.queryByRole('radio', { name: /Responses/ })).toBeNull();
  change('搜索协议', 'images/generations');
  expect(screen.getAllByRole('radio').length).toBeGreaterThan(0);
  expect(screen.queryByRole('radio', { name: /Gemini/ })).toBeNull();
  view.unmount();
  const { client } = clientFor(() => null);
  const modified = model('openai-responses', 'chat', {
    endpointOverride: { submitUrl: 'https://other.invalid/v1/responses', confirmedHosts: [] },
  });
  wrap(
    <ModelEditor
      client={client}
      channel={channel}
      model={modified}
      onClose={noop}
      onSaved={async () => {}}
      onTest={noop}
      onOpenStorage={noop}
    />,
  );
  fireEvent.click(screen.getByRole('radio', { name: /Anthropic/ }));
  expect(await screen.findByText('确认切换协议？')).toBeTruthy();
  expect(screen.getByText(/切换协议后需重新确认地址覆盖/)).toBeTruthy();
});
it('能力字段修改标记与分组恢复只影响目标分组', () => {
  const descriptor = getProtocol('openai-responses')!;
  function Editor() {
    const [draft, setDraft] = useState(modelWrite(model()));
    return (
      <CapabilityTab
        draft={draft}
        onChange={(capability) => setDraft({ ...draft, capability })}
        onRestore={(group) =>
          setDraft({
            ...draft,
            capability: restoreCapabilityGroup(draft.capability, descriptor, group),
          })
        }
      />
    );
  }
  wrap(<Editor />);
  const length = screen.getAllByPlaceholderText<HTMLInputElement>('不限')[0];
  fireEvent.change(length, { target: { value: '123' } });
  expect(length.closest('[data-modified]')?.getAttribute('data-modified')).toBe('true');
  const tool = screen.queryByRole('checkbox', { name: '工具调用' });
  if (tool) fireEvent.click(tool);
  fireEvent.click(screen.getByRole('button', { name: '输入能力 · 恢复为协议默认' }));
  expect(length.value).toBe('123');
  fireEvent.click(screen.getByRole('button', { name: '长度限制 · 恢复为协议默认' }));
  expect(length.closest('[data-modified]')?.getAttribute('data-modified')).toBe('false');
});
it('档位开关实时影响预览，支持手改像素、添加比例与档位', () => {
  const descriptor = getProtocol('ark-seedream')!;
  let result: Capability;
  function Editor() {
    const [draft, setDraft] = useState(modelWrite(model(descriptor.id, 'image')));
    result = draft.capability;
    return (
      <CapabilityTab
        draft={draft}
        onRestore={noop}
        onChange={(capability) => setDraft({ ...draft, capability })}
      />
    );
  }
  wrap(<Editor />);
  const tier = descriptor.templates.image!.size.tiers[0];
  const preview = screen.getByRole('complementary', { name: '画布参数预览' });
  fireEvent.click(screen.getByRole('checkbox', { name: tier.name }));
  expect(within(preview).queryByRole('button', { name: tier.name })).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: tier.name }));
  const ratio = tier.ratios[0].ratio;
  change(`${tier.name} ${ratio} 像素`, '1200x1200');
  expect(screen.getByText('手动')).toBeTruthy();
  change(`${tier.name} 其他比例`, '17:11');
  const other = screen.getByLabelText(`${tier.name} 其他比例`).parentElement!;
  fireEvent.click(within(other).getByRole('button', { name: '添加' }));
  expect(screen.getByRole('checkbox', { name: `${tier.name} 17:11` })).toBeTruthy();
  change('新档位名称', '自定义');
  fireEvent.click(screen.getByRole('button', { name: '添加档位' }));
  expect((result! as ImageCap).size.tiers.at(-1)?.name).toBe('自定义');
});
it('服务商尺寸显示说明，超协议上限的开关隐藏', () => {
  const descriptor = structuredClone(getProtocol('gemini-generate')!);
  descriptor.ceiling.image!.mask = [];
  descriptor.ceiling.image!.seed = false;
  wrap(
    <CapabilityImage value={descriptor.templates.image!} onChange={noop} descriptor={descriptor} />,
  );
  expect(screen.getAllByText('由服务商决定').length).toBeGreaterThan(0);
  expect(screen.queryByRole('checkbox', { name: '蒙版编辑' })).toBeNull();
  expect(screen.queryByRole('checkbox', { name: '随机种子' })).toBeNull();
});
it('视频素材配置、协议规则和时长三种模式', () => {
  const descriptor = getProtocol('ark-seedance')!;
  let result: VideoCap;
  function Editor() {
    const [cap, setCap] = useState(descriptor.templates.video!);
    result = cap;
    return <CapabilityVideo value={cap} onChange={setCap} descriptor={descriptor} />;
  }
  wrap(<Editor />);
  expect(screen.getAllByText(/协议规则：/).length).toBeGreaterThan(0);
  expect(screen.getByText('参考素材限制')).toBeTruthy();
  change('输出时长模式', 'values');
  change('固定时长（秒）', '4,8');
  expect(result!.duration).toMatchObject({ kind: 'values', values: [4, 8] });
  change('输出时长模式', 'auto');
  expect(result!.duration.kind).toBe('auto');
  change('输出时长模式', 'range');
  change('时长 最长', '12');
  expect(result!.duration).toMatchObject({ kind: 'range', max: 12 });
});
it('TTS 预置音色增删', () => {
  const descriptor = getProtocol('openai-speech')!;
  let result: TtsCap;
  function Editor() {
    const [cap, setCap] = useState(descriptor.templates.tts!);
    result = cap;
    return <CapabilityTts value={cap} onChange={setCap} descriptor={descriptor} />;
  }
  wrap(<Editor />);
  const count = descriptor.templates.tts!.voices.presets.length;
  fireEvent.click(screen.getByRole('button', { name: '添加预置音色' }));
  change(`音色 ID ${count + 1}`, 'custom');
  change(`音色名称 ${count + 1}`, '自定义');
  expect(result!.voices.presets.at(-1)).toEqual({ id: 'custom', name: '自定义' });
  fireEvent.click(screen.getAllByRole('button', { name: '移除' }).at(-1)!);
  expect(result!.voices.presets).toHaveLength(count);
});

it('链接传输提示对象存储，未确认跨主机时不能启用', () => {
  const openStorage = vi.fn();
  const draft = modelWrite(
    model('ark-seedance', 'video', {
      enabled: false,
      transport: { image: 'url' },
      endpointOverride: {
        submitUrl: 'https://foreign.invalid/api/v3/contents/generations/tasks',
        confirmedHosts: [],
      },
    }),
  );
  wrap(
    <BasicTab
      channel={channel}
      draft={draft}
      onChange={noop}
      onProtocol={noop}
      onOpenStorage={openStorage}
      storageReady={false}
    />,
  );
  expect(screen.getByText('对象存储未配置。')).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>('switch', { name: '启用模型' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '前往对象存储' }));
  expect(openStorage).toHaveBeenCalledOnce();
});
it('请求体预览使用 POST，固定 JSON 删除不串行且无效 JSON 阻止保存', async () => {
  const { client, calls } = clientFor(() => ({
    method: 'POST',
    url: 'http://127.0.0.1:9000/v1/responses',
    body: { model: 'test-model', input: '示例' },
  }));
  const invalid = vi.fn();
  function Editor() {
    const [draft, setDraft] = useState<ModelWrite>({
      ...modelWrite(model()),
      fixedFields: [
        { path: 'one', value: 1 },
        { path: 'two', value: 2 },
      ],
    });
    return (
      <ExtrasTab
        client={client}
        modelId={modelId}
        draft={draft}
        onChange={setDraft}
        onInvalid={invalid}
      />
    );
  }
  wrap(<Editor />);
  change('JSON 值 1', '{');
  expect(invalid).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
  expect(screen.getByLabelText<HTMLTextAreaElement>('JSON 值 1').value).toBe('2');
  expect(invalid).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByRole('button', { name: '预览已保存的请求' }));
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0].init).toMatchObject({ method: 'POST' });
  expect(await screen.findByText(/"input": "示例"/)).toBeTruthy();
  expect(screen.queryByText(/Authorization|apiKey/)).toBeNull();
});
it('固定请求字段与保留路径冲突时就地报错且禁止保存', async () => {
  const { client } = clientFor(() => null);
  wrap(
    <ModelEditor
      client={client}
      channel={channel}
      model={model()}
      onClose={noop}
      onSaved={async () => {}}
      onTest={noop}
      onOpenStorage={noop}
    />,
  );
  fireEvent.mouseDown(screen.getByRole('tab', { name: '附加参数' }), { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByRole('tab', { name: '附加参数' }));
  fireEvent.click(await screen.findByRole('button', { name: '添加固定字段' }));
  change('固定字段路径 1', 'model');
  expect(screen.getByRole('alert').textContent).toContain('保留');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存' }).disabled).toBe(true);
});

it('导入先显示问题列表，确认后复验，不保存有问题的配置', async () => {
  const write = modelWrite(model());
  const fields = Object.fromEntries(
    Object.entries(write).filter(([key]) => !['enabled', 'endpointOverride'].includes(key)),
  );
  const exported = {
    schema: 'frame-loom.model',
    schemaVersion: 1,
    model: { ...fields, endpointOverride: {} },
  };
  const { client, calls } = clientFor(() => ({
    model: { ...write, enabled: false },
    issues: [{ field: 'protocolId', message: '协议需要确认' }],
  }));
  wrap(
    <ChannelDetail
      client={client}
      channel={channel}
      models={[model()]}
      highlighted={[]}
      onBack={noop}
      onEdit={noop}
      onCatalog={noop}
      onModel={noop}
      onTest={noop}
      onRefresh={async () => {}}
      onDeleted={noop}
    />,
  );
  const file = new File([JSON.stringify(exported)], 'model.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(JSON.stringify(exported)) });
  fireEvent.change(screen.getByLabelText('选择模型 JSON 文件'), { target: { files: [file] } });
  expect(await screen.findByText('protocolId：协议需要确认')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls.every((call) => call.path.endsWith('/import'))).toBe(true);
});
it('视频预览跟随参考混用选项，协议锁定的比例置灰', () => {
  const descriptor = getProtocol('ark-seedance')!;
  const cap = structuredClone(descriptor.templates.video!);
  cap.defaultMode = 'first_last';
  cap.aspectRatios = ['adaptive', '16:9'];
  const view = wrap(<CanvasPreview capability={cap} descriptor={descriptor} name="视频" />);
  expect(screen.getByRole<HTMLButtonElement>('radio', { name: '比例 16:9' }).disabled).toBe(true);
  expect(screen.queryByText(/图 0\//)).toBeNull();
  const mode = cap.modes.find((mode) => mode.id === 'first_last')!;
  mode.withReference = true;
  view.unmount();
  wrap(<CanvasPreview capability={cap} descriptor={descriptor} name="视频" />);
  expect(screen.getByText(/图 0\//)).toBeTruthy();
});

it('导出 JSON 从公开接口读取，下载文件不含凭据', async () => {
  const write = modelWrite(model());
  const fields = Object.fromEntries(
    Object.entries(write).filter(([key]) => !['enabled', 'endpointOverride'].includes(key)),
  );
  const exported = {
    schema: 'frame-loom.model',
    schemaVersion: 1,
    model: { ...fields, endpointOverride: {} },
  };
  const { client, calls } = clientFor(() => exported);
  const blobs: Blob[] = [];
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL(blob: Blob) {
        blobs.push(blob);
        return 'blob:test';
      }
      static revokeObjectURL() {}
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(noop);
  wrap(
    <ChannelDetail
      client={client}
      channel={channel}
      models={[model()]}
      highlighted={[]}
      onBack={noop}
      onEdit={noop}
      onCatalog={noop}
      onModel={noop}
      onTest={noop}
      onRefresh={async () => {}}
      onDeleted={noop}
    />,
  );
  fireEvent.keyDown(screen.getByRole('button', { name: '测试模型 更多操作' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: '导出 JSON' }));
  await waitFor(() => expect(blobs).toHaveLength(1));
  const text = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsText(blobs[0]);
  });
  expect(JSON.parse(text)).toEqual(exported);
  expect(text).not.toMatch(/apiKey|secretKey|headers|confirmedHosts/);
  expect(calls[0].path).toBe(`/models/${modelId}/export`);
});

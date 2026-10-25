import { afterEach, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Channel, ChannelModel, type LlmEvent } from '@frame-loom/contracts';
import type { EngineClient } from '@/lib/engine-client';
import { ModelServices } from './model-services/model-services';
import { ModelDefaultsSettings } from './model-services/model-defaults';
import { ModelLab } from './model-lab/model-lab';

const channelId = '11111111-1111-4111-8111-111111111111';
const modelId = '22222222-2222-4222-8222-222222222222';
const channel = Channel.parse({
  id: channelId,
  name: '本地测试',
  apiFormat: 'openai-completions',
  baseUrl: 'http://127.0.0.1:9000/v1',
  enabled: true,
  hasKey: true,
  keyHint: '••••1234',
  headerNames: ['X-Custom'],
  lastCheck: null,
  createdAt: '2026-10-25T00:00:00.000Z',
  updatedAt: '2026-10-25T00:00:00.000Z',
});
const model = ChannelModel.parse({
  id: modelId,
  channelId,
  upstreamModelId: 'unknown',
  displayName: '测试文本',
  kind: 'chat',
  protocol: 'openai-completions',
  profileId: null,
  enabled: true,
  overrides: {},
  metadata: {
    contextWindow: 8192,
    maxTokens: 1024,
    reasoning: false,
    imageInput: false,
    needsConfirmation: true,
    compat: {},
  },
  lastCheck: null,
});
const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 };
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

function setup(view: 'services' | 'defaults' | 'lab', empty = false) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(queries);
  let channels = empty ? [] : [channel];
  let models = empty ? [] : [model];
  let defaults = { chat: null as string | null, image: null, video: null, tts: null };
  const calls: { path: string; init: Parameters<EngineClient['request']>[2] }[] = [];
  let events: (signal?: AbortSignal | null) => AsyncGenerator<LlmEvent> = async function* () {
    await Promise.resolve();
    yield { type: 'thinking.delta', delta: '先思考' };
    yield { type: 'text.delta', delta: '测试' };
    yield { type: 'text.delta', delta: '成功' };
    yield { type: 'done', usage, stopReason: 'stop' };
  };
  const client: EngineClient = {
    request(path, schema, init) {
      calls.push({ path, init });
      const body = init?.body as Record<string, unknown>;
      let result: unknown;
      if (path === '/channels' && !init?.method) result = channels;
      else if (path === '/channel-models' && !init?.method) result = models;
      else if (path === '/model-defaults') {
        if (init?.method) defaults = { ...defaults, ...body };
        result = defaults;
      } else if (
        path === '/channels' ||
        (path === `/channels/${channelId}` && init?.method === 'PATCH')
      ) {
        const publicFields = Object.fromEntries(
          Object.entries(body).filter(([key]) => !['apiKey', 'headers', 'models'].includes(key)),
        );
        const saved = { ...channel, ...publicFields };
        channels = [saved];
        if (body.models)
          models = (body.models as Record<string, unknown>[]).map((item, index) => ({
            ...model,
            ...item,
            id: (item.id as string | undefined) ?? `33333333-3333-4333-8333-33333333333${index}`,
          }));
        result = saved;
      } else if (path === '/channels/probe-models') result = ['unknown', 'gpt-4o', 'claude-x'];
      else if (path === '/model-profiles') result = [];
      else if (init?.method === 'DELETE') {
        channels = [];
        models = [];
        result = { deleted: true };
      } else throw new Error(`未处理的替身请求：${path}`);
      return Promise.resolve(schema.parse(result));
    },
    async *stream(path, schema, init) {
      calls.push({ path, init });
      for await (const event of events(init?.signal)) yield schema.parse(event);
    },
  };
  const rendered = render(
    <QueryClientProvider client={queries}>
      {view === 'services' ? (
        <ModelServices engineClient={client} />
      ) : view === 'defaults' ? (
        <ModelDefaultsSettings engineClient={client} onOpenModels={() => {}} />
      ) : (
        <ModelLab engineClient={client} />
      )}
    </QueryClientProvider>,
  );
  return {
    ...rendered,
    calls,
    queries,
    setEvents: (value: typeof events) => {
      events = value;
    },
  };
}
function change(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function send(text: string) {
  change('测试消息', text);
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
}

it('新建渠道：草稿拉取后勾选模型，协议随类别过滤，渠道与模型一次保存', async () => {
  const { calls } = setup('services', true);
  await screen.findByText('添加第一个模型渠道');
  fireEvent.click(screen.getByRole('button', { name: '添加渠道' }));
  change('渠道名称', '新的渠道');
  change('API 格式', 'anthropic-messages');
  change('接口地址', 'https://relay.example.com');
  change('API 密钥', 'sk-private');
  fireEvent.click(screen.getByRole('button', { name: '添加请求头' }));
  change('请求头 1 名称', 'X-Custom');
  change('请求头 1 值', 'secret');
  fireEvent.click(screen.getByRole('button', { name: '拉取模型' }));
  const picker = await screen.findByRole('group', { name: '选择渠道模型' });
  expect(calls.find((call) => call.path === '/channels/probe-models')?.init?.body).toEqual({
    apiFormat: 'anthropic-messages',
    baseUrl: 'https://relay.example.com',
    apiKey: 'sk-private',
    headers: { 'X-Custom': 'secret' },
  });
  fireEvent.change(within(picker).getByLabelText('搜索模型'), { target: { value: 'claude' } });
  expect(within(picker).queryByText('gpt-4o')).toBeNull();
  fireEvent.click(within(picker).getByLabelText(/claude-x/));
  fireEvent.click(within(picker).getByRole('button', { name: '添加所选（1）' }));
  const card = screen.getByRole('group', { name: 'claude-x' });
  const protocol = within(card).getByLabelText<HTMLSelectElement>('调用协议');
  expect(protocol.disabled).toBe(true);
  fireEvent.change(within(card).getByLabelText('模型类别'), { target: { value: 'chat' } });
  expect(protocol.value).toBe('anthropic-messages');
  fireEvent.change(within(card).getByLabelText('模型类别'), { target: { value: 'image' } });
  expect([...protocol.options].map((option) => option.value)).toEqual([
    '',
    'openai-images',
    'gemini-image',
    'ark-images',
  ]);
  expect(protocol.value).toBe('');
  fireEvent.change(within(card).getByLabelText('模型类别'), { target: { value: 'chat' } });
  fireEvent.change(within(card).getByLabelText('上下文窗口'), { target: { value: '200000' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByRole('button', { name: '编辑 新的渠道' });
  const saved = calls.find((call) => call.path === '/channels' && call.init?.method === 'POST');
  expect(saved?.init?.body).toMatchObject({
    apiFormat: 'anthropic-messages',
    apiKey: 'sk-private',
    headers: { 'X-Custom': 'secret' },
    models: [
      {
        upstreamModelId: 'claude-x',
        kind: 'chat',
        protocol: 'anthropic-messages',
        enabled: true,
        overrides: { contextWindow: 200000 },
      },
    ],
  });
  expect(screen.queryByDisplayValue('sk-private')).toBeNull();
  expect(screen.getByText(/1 个模型 · 密钥：••••1234/)).toBeTruthy();
});

it('列表只显示渠道；编辑时密钥与请求头留空保留，拉取复用已存凭据', async () => {
  const { calls } = setup('services');
  await screen.findByRole('button', { name: '编辑 本地测试' });
  expect(screen.queryByText('测试文本')).toBeNull();
  for (const value of [undefined, 'sk-rotated', '']) {
    fireEvent.click(screen.getByRole('button', { name: '编辑 本地测试' }));
    const input = screen.getByLabelText<HTMLInputElement>('API 密钥');
    expect(input.value).toBe('');
    expect(input.type).toBe('password');
    if (value) fireEvent.change(input, { target: { value } });
    if (value === '') fireEvent.click(screen.getByLabelText('清除已存密钥'));
    if (value === undefined) {
      fireEvent.click(screen.getByRole('button', { name: '拉取模型' }));
      await screen.findByRole('group', { name: '选择渠道模型' });
      const probe = calls.find((call) => call.path === '/channels/probe-models')?.init?.body;
      expect(probe).toEqual({
        apiFormat: 'openai-completions',
        baseUrl: channel.baseUrl,
        channelId,
      });
      // 已添加的模型不可重复勾选。
      expect(screen.getByLabelText<HTMLInputElement>(/unknown/).disabled).toBe(true);
    }
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByRole('button', { name: '编辑 本地测试' });
    const body = calls.filter((call) => call.init?.method === 'PATCH').at(-1)?.init?.body;
    expect(body).not.toHaveProperty('headers');
    expect(body).toMatchObject({ models: [{ id: modelId, upstreamModelId: 'unknown' }] });
    if (value === undefined) expect(body).not.toHaveProperty('apiKey');
    else expect(body).toHaveProperty('apiKey', value);
  }
});

it('编辑页移除模型、启用未分类模型被拦截，删除渠道须确认', async () => {
  const { calls } = setup('services');
  fireEvent.click(await screen.findByRole('button', { name: '编辑 本地测试' }));
  expect(screen.getByText(/元数据需确认/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '添加模型' }));
  const blank = screen.getByRole('group', { name: '模型 2' });
  fireEvent.change(within(blank).getByLabelText('模型 ID'), { target: { value: 'manual' } });
  fireEvent.click(within(blank).getByLabelText('启用模型'));
  expect(
    within(screen.getByRole('group', { name: 'manual' })).getByRole<HTMLButtonElement>('button', {
      name: '测试模型',
    }).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect((await screen.findByRole('alert')).textContent).toContain('先选择类别和调用协议');
  fireEvent.click(screen.getByRole('button', { name: '移除 manual' }));
  fireEvent.click(screen.getByRole('button', { name: '移除 测试文本' }));
  fireEvent.click(screen.getByRole('button', { name: '删除渠道' }));
  expect(calls.some((call) => call.init?.method === 'DELETE')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  await screen.findByText('添加第一个模型渠道');
});

it('默认模型独立页面只列出已启用模型并写入', async () => {
  const { calls } = setup('defaults');
  await screen.findByRole('option', { name: '本地测试 / 测试文本' });
  change('文本', modelId);
  await waitFor(() =>
    expect(
      calls.find((call) => call.path === '/model-defaults' && call.init?.method === 'PUT')?.init
        ?.body,
    ).toEqual({ chat: modelId }),
  );
  expect(within(screen.getByLabelText('图片')).getAllByRole('option')).toHaveLength(1);
});

it('文本页合并推理和文本增量，展示用量，并将完整上一轮送入下一轮', async () => {
  const { calls } = setup('lab');
  await screen.findByRole('option', { name: '本地测试 / 测试文本' });
  send('你好');
  await screen.findByText('测试成功');
  expect(screen.getByText('先思考')).toBeTruthy();
  expect((await screen.findByRole('status')).textContent).toContain('总计 15');
  send('继续');
  await waitFor(() =>
    expect(calls.filter((call) => call.path === '/llm/test-chat')).toHaveLength(2),
  );
  expect(calls.at(-1)?.init?.body).toMatchObject({
    modelId,
    messages: [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '测试成功' },
      { role: 'user', content: '继续' },
    ],
  });
});

it('流式错误显示类别，失败轮不会送入下一轮；模型失效自动清空历史', async () => {
  const { calls, setEvents, queries } = setup('lab');
  await screen.findByRole('option', { name: '本地测试 / 测试文本' });
  setEvents(async function* () {
    await Promise.resolve();
    yield { type: 'error', code: 'RATE_LIMITED', message: '稍后重试' };
  });
  send('失败轮');
  expect((await screen.findByRole('alert')).textContent).toContain('RATE_LIMITED');
  setEvents(async function* () {
    await Promise.resolve();
    yield { type: 'text.delta', delta: 'OK' };
    yield { type: 'done', usage, stopReason: 'stop' };
  });
  send('重试');
  await screen.findByText('OK');
  expect(calls.at(-1)?.init?.body).toMatchObject({ messages: [{ role: 'user', content: '重试' }] });
  // 直接使共享查询失效，模拟另一入口删除模型。
  act(() => {
    queries.setQueryData(['models', 'list'], []);
  });
  await waitFor(() => expect(screen.queryByText('OK')).toBeNull());
  expect(screen.getByLabelText<HTMLTextAreaElement>('测试消息').disabled).toBe(true);
});

it('停止及卸载中断客户端流', async () => {
  const { setEvents, unmount } = setup('lab');
  await screen.findByRole('option', { name: '本地测试 / 测试文本' });
  const signals: AbortSignal[] = [];
  setEvents(async function* (signal) {
    signals.push(signal!);
    yield { type: 'text.delta', delta: '处理中' };
    await new Promise<void>((_, reject) =>
      signal!.addEventListener('abort', () => reject(new Error('中止')), { once: true }),
    );
  });
  send('停止测试');
  await screen.findByText('处理中');
  fireEvent.click(screen.getByRole('button', { name: '停止' }));
  expect((await screen.findByRole('alert')).textContent).toContain('REQUEST_ABORTED');
  expect(signals[0].aborted).toBe(true);
  send('卸载测试');
  await waitFor(() => expect(signals).toHaveLength(2));
  unmount();
  expect(signals[1].aborted).toBe(true);
});

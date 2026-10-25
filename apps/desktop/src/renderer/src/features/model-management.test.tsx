import { afterEach, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Channel, ChannelModel, type LlmEvent } from '@frame-loom/contracts';
import type { EngineClient } from '@/lib/engine-client';
import { ModelServices } from './model-services/model-services';
import { ModelLab } from './model-lab/model-lab';

const channelId = '11111111-1111-4111-8111-111111111111';
const modelId = '22222222-2222-4222-8222-222222222222';
const channel = Channel.parse({
  id: channelId,
  name: '本地测试',
  preset: 'openai-compatible',
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

function setup(view: 'services' | 'lab', empty = false) {
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
          Object.entries(body).filter(([key]) => key !== 'apiKey' && key !== 'headers'),
        );
        const saved = { ...channel, ...publicFields };
        channels = [saved];
        result = saved;
      } else if (path.endsWith('/fetch-models')) {
        models = [{ ...model, enabled: false, kind: null, protocol: null, metadata: null }];
        result = models;
      } else if (path === `/channel-models/${modelId}` && init?.method === 'PATCH') {
        models = [{ ...model, ...body }];
        result = models[0];
      } else if (init?.method === 'DELETE') {
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

it('渠道表单应用预设，校验请求头后保存，只显示密钥尾号', async () => {
  const { calls } = setup('services', true);
  await screen.findByText('添加第一个模型渠道');
  fireEvent.click(screen.getByRole('button', { name: '添加渠道' }));
  change('渠道名称', '新的渠道');
  change('渠道预设', 'gemini');
  expect(screen.getByLabelText<HTMLInputElement>('Base URL').value).toBe(
    'https://generativelanguage.googleapis.com/v1beta',
  );
  change('API 密钥', 'sk-private');
  change(/附加请求头 JSON/, '{bad');
  fireEvent.click(screen.getByRole('button', { name: '保存渠道' }));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    expect.stringContaining('请检查渠道'),
  );
  change(/附加请求头 JSON/, '{"X-Custom":"secret"}');
  fireEvent.click(screen.getByRole('button', { name: '保存渠道' }));
  await screen.findByRole('heading', { name: '新的渠道' });
  expect(calls.find((call) => call.init?.method === 'POST')?.init?.body).toMatchObject({
    preset: 'gemini',
    apiKey: 'sk-private',
    headers: { 'X-Custom': 'secret' },
  });
  expect(screen.queryByDisplayValue('sk-private')).toBeNull();
  expect(screen.getByText(/密钥：••••1234/)).toBeTruthy();
});

it('编辑渠道密钥留空保留，重新填写和显式清除分别发送对应值', async () => {
  const { calls } = setup('services');
  await screen.findByRole('button', { name: '编辑渠道' });
  for (const value of [undefined, 'sk-rotated', '']) {
    fireEvent.click(screen.getByRole('button', { name: '编辑渠道' }));
    const input = screen.getByLabelText<HTMLInputElement>(/重新填写密钥/);
    expect(input.value).toBe('');
    expect(input.type).toBe('password');
    if (value) fireEvent.change(input, { target: { value } });
    if (value === '') fireEvent.click(screen.getByLabelText('清除已存密钥'));
    fireEvent.click(screen.getByRole('button', { name: '保存渠道' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '保存渠道' })).toBeNull());
    const body = calls.filter((call) => call.init?.method === 'PATCH').at(-1)?.init?.body;
    if (value === undefined) expect(body).not.toHaveProperty('apiKey');
    else expect(body).toHaveProperty('apiKey', value);
  }
});

it('未知元数据可配置，默认模型写入；拉取未分类模型后禁用测试，删除须确认', async () => {
  const { calls } = setup('services');
  await screen.findByText(/元数据需确认/);
  change('文本', modelId);
  await waitFor(() =>
    expect(
      calls.some((call) => call.path === '/model-defaults' && call.init?.method === 'PUT'),
    ).toBe(true),
  );
  fireEvent.click(screen.getByRole('button', { name: '配置 测试文本' }));
  change('显示名称', '新名称');
  change('元数据覆盖 JSON', '{"contextWindow":16384}');
  fireEvent.click(screen.getByRole('button', { name: '保存模型' }));
  await screen.findByRole('button', { name: '配置 新名称' });
  expect(
    calls.find((call) => call.path === `/channel-models/${modelId}`)?.init?.body,
  ).toMatchObject({ displayName: '新名称', overrides: { contextWindow: 16384 } });
  fireEvent.click(screen.getByRole('button', { name: '拉取模型' }));
  await screen.findByText(/未分类 · 未选协议/);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '测试模型' }).disabled).toBe(true);
  const list = screen.getByRole('list');
  fireEvent.click(within(list).getByRole('button', { name: '删除' }));
  expect(calls.some((call) => call.init?.method === 'DELETE')).toBe(false);
  fireEvent.click(within(list).getByRole('button', { name: '确认删除' }));
  await screen.findByText(/尚无模型/);
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

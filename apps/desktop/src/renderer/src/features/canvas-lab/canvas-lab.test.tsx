import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CanvasEditorProps, CanvasHost } from '@frame-loom/canvas';
import { ModelProfile, type CanvasRecord } from '@frame-loom/contracts';
import { EngineRequestError, type EngineClient } from '@/lib/engine-client';
import { commandWindow, onEngineExited } from '@/lib/desktop-bridge';
import { CanvasLab } from './canvas-lab';

const captured = vi.hoisted(() => ({ host: null as CanvasHost | null }));

vi.mock('@frame-loom/canvas', async (original) => ({
  ...(await original<typeof import('@frame-loom/canvas')>()),
  CanvasEditor: ({ store, host }: CanvasEditorProps) => {
    captured.host = host;
    return (
      <button
        onClick={() =>
          store!.getState().apply((doc) => ({
            ...doc,
            nodes: [
              {
                id: 'one',
                type: 'image',
                typeVersion: 1,
                position: { x: 0, y: 0 },
                size: { width: 280, height: 180 },
                data: { versions: [], activeVersion: 0, prompt: '本地内容', inputOrder: [] },
              },
            ],
          }))
        }
      >
        编辑画布
      </button>
    );
  },
}));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => ({ status: 'idle' }) }));
vi.mock('@/lib/desktop-bridge', () => ({
  commandWindow: vi.fn(),
  onEngineExited: vi.fn(() => vi.fn()),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function setup(initialFailure?: Error) {
  const record: CanvasRecord | null = null;
  let failure = initialFailure;
  const calls: { path: string; body: unknown; method: string | undefined }[] = [];
  const client: EngineClient = {
    request(path, schema, init) {
      calls.push({ path, body: init?.body, method: init?.method });
      if (failure) return Promise.reject(failure);
      if (path === '/channels') return Promise.resolve(schema.parse([]));
      if (path === '/channel-models') return Promise.resolve(schema.parse([]));
      if (path === '/model-defaults')
        return Promise.resolve(schema.parse({ chat: null, image: null, video: null, tts: null }));
      if (path === '/model-profiles' || path === '/generation-jobs')
        return Promise.resolve(schema.parse([]));
      return Promise.resolve(schema.parse(init?.method ? { revision: 1 } : record));
    },
    stream() {
      throw new Error('不应订阅流');
    },
  };
  const view = render(<CanvasLab engineClient={client} />);
  return {
    ...view,
    calls,
    fail(error?: Error) {
      failure = error;
    },
  };
}

it('宿主图片档案按最长前缀匹配且显式选择优先，单张重试调用 resubmit', async () => {
  const base = ModelProfile.parse({
    id: 'base',
    name: '图片',
    kind: 'image',
    protocol: 'openai-images',
    matchIds: ['gpt-image-2'],
    generic: false,
    modes: [{ id: 'text', name: '文生图' }],
    params: [],
    constraints: [],
    inputs: [],
    runtime: {
      concurrency: 1,
      pollInitialMs: 1000,
      pollMaxMs: 5000,
      timeoutMs: 10000,
      submitTimeoutMs: 1000,
      supportsCancel: false,
    },
  });
  const profiles = [
    base,
    { ...base, id: 'new', matchIds: ['gpt-image-2.5'] },
    { ...base, id: 'generic', generic: true, matchIds: [] },
  ];
  const channelId = crypto.randomUUID();
  const model = {
    channelId,
    enabled: true,
    kind: 'image',
    protocol: 'openai-images',
    displayName: '图片',
    profileId: null,
    overrides: {},
    metadata: null,
    lastCheck: null,
  };
  const request = vi.fn<EngineClient['request']>().mockImplementation((path, schema) => {
    const values: Record<string, unknown> = {
      '/channels': [
        {
          id: channelId,
          name: '渠道',
          enabled: true,
          apiFormat: 'openai-completions',
          baseUrl: 'https://example.com',
          hasKey: true,
          keyHint: null,
          headerNames: [],
          lastCheck: null,
          createdAt: '2026-10-26T00:00:00Z',
          updatedAt: '2026-10-26T00:00:00Z',
        },
      ],
      '/channel-models': [
        { ...model, id: crypto.randomUUID(), upstreamModelId: 'gpt-image-2.5-2026-09-08' },
        { ...model, id: crypto.randomUUID(), upstreamModelId: 'gpt-image-2.5', profileId: 'base' },
      ],
      '/model-defaults': { chat: null, image: null, video: null, tts: null },
      '/model-profiles': profiles,
      '/object-storage': null,
      '/canvases/lab': null,
    };
    return Promise.resolve(schema.parse(values[path]));
  });
  render(
    <CanvasLab
      engineClient={{
        request: (path, schema, init) =>
          request(path, schema, init).then((value) => schema.parse(value)),
        stream: vi.fn(),
      }}
    />,
  );
  await screen.findByRole('button', { name: '编辑画布' });
  const config = await captured.host!.generation!.load(new AbortController().signal);
  expect(config.models.map((model) => model.profile?.id)).toEqual(['new', 'base']);
  request.mockRejectedValueOnce(new Error('重试响应'));
  await expect(captured.host!.generation!.resubmit('failed-id')).rejects.toThrow('重试响应');
  expect(request).toHaveBeenLastCalledWith(
    '/generation-jobs/failed-id/resubmit',
    expect.anything(),
    { method: 'POST' },
  );
});

it('替身 client 加载失败只显示重试，重试成功后才允许编辑', async () => {
  const test = setup(new Error('读取失败'));
  await screen.findByText('读取失败');
  expect(screen.queryByRole('button', { name: '编辑画布' })).toBeNull();
  expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  expect(test.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  test.fail();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByRole('button', { name: '编辑画布' });
});

it('409 显示重新加载与导出，重新加载后可继续编辑；关闭前保存失败保留画布', async () => {
  const test = setup();
  fireEvent.click(await screen.findByRole('button', { name: '编辑画布' }));
  test.fail(new EngineRequestError(409, 'CANVAS_REVISION_CONFLICT', '其他窗口已修改画布'));
  const event = new Event('beforeunload', { cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
  expect(commandWindow).not.toHaveBeenCalled();
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: '留在画布' }));
  expect(screen.getByRole('button', { name: '导出当前画布 JSON' })).toBeTruthy();
  test.fail();
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  await screen.findByRole('button', { name: '编辑画布' });
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '编辑画布' }));
  act(() => {
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
  });
  await waitFor(() => expect(commandWindow).toHaveBeenCalledWith('close'));
  expect(test.calls.filter((call) => call.method === 'PUT').map((call) => call.body)).toMatchObject(
    [{ revision: 0 }, { revision: 0 }],
  );
});

it('引擎退出保留内容并提供导出；放弃未保存修改才允许关闭', async () => {
  const test = setup();
  fireEvent.click(await screen.findByRole('button', { name: '编辑画布' }));
  const callback = vi.mocked(onEngineExited).mock.calls.at(-1)![0];
  act(() => callback(1));
  expect(screen.getByRole('button', { name: '编辑画布' })).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('本地引擎已退出');
  test.fail(new Error('连接失败'));
  act(() => {
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
  });
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: '放弃更改并离开' }));
  expect(commandWindow).toHaveBeenCalledWith('close');
});

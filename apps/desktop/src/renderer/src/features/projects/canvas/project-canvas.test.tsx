import {
  act,
  cleanup,
  fireEvent,
  render as baseRender,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CanvasEditorProps, CanvasHost } from '@frame-loom/canvas';
import { ModelProfile, emptyCanvasDocument } from '@frame-loom/contracts';
import { EngineRequestError, type EngineClient } from '@/lib/engine-client';
import { commandWindow, onEngineExited } from '@/lib/desktop-bridge';
import { ProjectCanvas } from './project-canvas';

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
vi.mock('@tanstack/react-router', () => ({
  useBlocker: () => ({ status: 'idle' }),
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('@/lib/desktop-bridge', () => ({
  commandWindow: vi.fn(),
  onEngineExited: vi.fn(() => vi.fn()),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function render(node: ReactNode) {
  return baseRender(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {node}
    </QueryClientProvider>,
  );
}
const record = {
  format: 'frame-loom-page',
  formatVersion: 1,
  id: '00000000-0000-4000-8000-000000000002',
  revision: 1,
  document: emptyCanvasDocument(),
  view: null,
};
function setup(initialFailure?: Error) {
  let failure = initialFailure;
  const calls: { path: string; body: unknown; method: string | undefined }[] = [];
  const client: EngineClient = {
    request(path, schema, init) {
      calls.push({ path, body: init?.body, method: init?.method });
      if (path.includes('/sessions/')) return Promise.resolve(schema.parse({ saved: true }));
      if (path === '/projects/00000000-0000-4000-8000-000000000001')
        return Promise.reject(new Error('不读取面包屑'));
      if (failure) return Promise.reject(failure);
      if (path === '/channels') return Promise.resolve(schema.parse([]));
      if (path === '/channel-models') return Promise.resolve(schema.parse([]));
      if (path === '/model-defaults')
        return Promise.resolve(schema.parse({ chat: null, image: null, video: null, tts: null }));
      if (path === '/generation-jobs' && init?.method === 'POST')
        return Promise.reject(new Error('只检查生成请求归属'));
      if (path === '/model-profiles' || path === '/generation-jobs')
        return Promise.resolve(schema.parse([]));
      return Promise.resolve(schema.parse(init?.method ? { revision: 2, missing: [] } : record));
    },
    stream() {
      throw new Error('不应订阅流');
    },
  };
  const view = render(
    <ProjectCanvas
      projectId="00000000-0000-4000-8000-000000000001"
      pageId="00000000-0000-4000-8000-000000000002"
      engineClient={client}
    />,
  );
  return {
    ...view,
    calls,
    fail(error?: Error) {
      failure = error;
    },
  };
}

it('宿主使用服务端有效档案而不按别名推断，单张重试调用 resubmit', async () => {
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
        {
          ...model,
          id: crypto.randomUUID(),
          upstreamModelId: 'custom-billing-id',
          effectiveProfile: profiles[1],
        },
        {
          ...model,
          id: crypto.randomUUID(),
          upstreamModelId: 'gpt-image-2.5',
          profileId: 'base',
          effectiveProfile: base,
        },
      ],
      '/model-defaults': { chat: null, image: null, video: null, tts: null },
      '/model-profiles': profiles,
      '/object-storage': null,
      '/projects/00000000-0000-4000-8000-000000000001/pages/00000000-0000-4000-8000-000000000002':
        null,
      '/projects/00000000-0000-4000-8000-000000000001/sessions/open': { saved: true },
      '/projects/00000000-0000-4000-8000-000000000001/sessions/close': { saved: true },
    };
    return Promise.resolve(
      schema.parse(
        path.endsWith('/pages/00000000-0000-4000-8000-000000000002') ? record : values[path],
      ),
    );
  });
  render(
    <ProjectCanvas
      projectId="00000000-0000-4000-8000-000000000001"
      pageId="00000000-0000-4000-8000-000000000002"
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
  expect(request.mock.calls.some(([path]) => path === '/model-profiles')).toBe(false);
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
it('会话先打开再加载，离开时保存成功后关闭，生成请求附带项目与页面归属', async () => {
  const test = setup();
  await screen.findByRole('button', { name: '编辑画布' });
  const paths = test.calls.map((call) => call.path);
  expect(
    paths.indexOf('/projects/00000000-0000-4000-8000-000000000001/sessions/open'),
  ).toBeLessThan(
    paths.indexOf(
      '/projects/00000000-0000-4000-8000-000000000001/pages/00000000-0000-4000-8000-000000000002',
    ),
  );
  await captured
    .host!.generation!.create({
      modelId: '00000000-0000-4000-8000-000000000003',
      mode: 'text',
      prompt: '项目生成',
      params: {},
      inputs: [],
      source: 'canvas',
    })
    .catch(() => {});
  expect(test.calls.find((call) => call.path === '/generation-jobs')?.body).toMatchObject({
    projectId: '00000000-0000-4000-8000-000000000001',
    pageId: '00000000-0000-4000-8000-000000000002',
  });
  fireEvent.click(screen.getByRole('button', { name: '编辑画布' }));
  test.unmount();
  await vi.waitFor(() => expect(test.calls.at(-1)?.path).toMatch(/sessions\/close$/));
  expect(test.calls.at(-2)?.method).toBe('PUT');
});

it('409 显示重新加载与导出，重新加载后可继续编辑；关闭前保存失败保留画布', async () => {
  const test = setup();
  fireEvent.click(await screen.findByRole('button', { name: '编辑画布' }));
  test.fail(new EngineRequestError(409, 'PAGE_REVISION_CONFLICT', '其他窗口已修改画布'));
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
    [{ revision: 1 }, { revision: 1 }],
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
  await waitFor(() => expect(commandWindow).toHaveBeenCalledWith('close'));
});

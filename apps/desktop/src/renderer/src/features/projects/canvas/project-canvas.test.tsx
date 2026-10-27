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
import type { CanvasEditorProps, CanvasHost, CanvasStore } from '@frame-loom/canvas';
import {
  ModelProfile,
  ProjectTag,
  ProjectTagUsage,
  emptyCanvasDocument,
} from '@frame-loom/contracts';
import { EngineRequestError, type EngineClient } from '@/lib/engine-client';
import { commandWindow, onEngineExited } from '@/lib/desktop-bridge';
import { ProjectCanvas } from './project-canvas';

const captured = vi.hoisted(() => ({
  host: null as CanvasHost | null,
  store: null as CanvasStore | null,
}));

vi.mock('@frame-loom/canvas', async (original) => ({
  ...(await original<typeof import('@frame-loom/canvas')>()),
  CanvasEditor: ({ store, host }: CanvasEditorProps) => {
    captured.host = host;
    captured.store = store ?? null;
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
const projectId = '00000000-0000-4000-8000-000000000001';
const pageId = '00000000-0000-4000-8000-000000000002';
const otherPageId = '00000000-0000-4000-8000-000000000003';
const oldTag = ProjectTag.parse({ id: 'old', name: '旧标签', color: 'blue', builtin: false });
const newTag = ProjectTag.parse({ id: 'new', name: '新标签', color: 'green', builtin: false });
const tagUsages = ProjectTagUsage.array().parse([
  {
    pageId,
    pageName: '当前页',
    nodeId: 'one',
    nodeType: 'image',
    title: '锁定图片',
    locked: true,
    thumbnailSha256: null,
  },
  {
    pageId: otherPageId,
    pageName: '其他页',
    nodeId: 'two',
    nodeType: 'video',
    title: '视频',
    locked: false,
    thumbnailSha256: null,
  },
]);

function setupTags() {
  let tags = [oldTag, newTag];
  let usages = [...tagUsages];
  const save = vi.fn().mockResolvedValue({ revision: 2, missing: [] });
  const remove = vi.fn().mockImplementation(() => {
    tags = [newTag];
    return Promise.resolve(tags);
  });
  const scan = vi.fn().mockImplementation(() => Promise.resolve(usages));
  const request = vi
    .fn<EngineClient['request']>()
    .mockImplementation(async (path, schema, init) => {
      let value: unknown;
      if (path.endsWith('/sessions/open') || path.endsWith('/sessions/close'))
        value = { saved: true };
      else if (path.endsWith('/usages')) value = await scan();
      else if (path.endsWith('/delete')) value = await remove(init?.body);
      else if (path.endsWith('/tags')) {
        if (init?.method === 'POST') tags = [...tags, { ...newTag, id: 'third', name: '新增' }];
        value = tags;
      } else if (path.endsWith('/tags/new')) {
        tags = tags.map((tag) => (tag.id === 'new' ? { ...tag, name: '改名' } : tag));
        value = tags;
      } else if (path.endsWith(`/pages/${pageId}`)) {
        value =
          init?.method === 'PUT'
            ? await save(init.body)
            : {
                ...record,
                document: {
                  ...emptyCanvasDocument(),
                  nodes: [
                    {
                      id: 'one',
                      type: 'image',
                      typeVersion: 2,
                      title: '锁定图片',
                      locked: true,
                      tagId: 'old',
                      position: { x: 0, y: 0 },
                      size: { width: 280, height: 180 },
                      data: { versions: [], activeVersion: 0, prompt: '', inputOrder: [] },
                    },
                  ],
                },
              };
      } else throw new Error('本测试不读取其他资源');
      return schema.parse(value);
    });
  const view = render(
    <ProjectCanvas
      projectId={projectId}
      pageId={pageId}
      engineClient={{
        request: (path, schema, init) =>
          request(path, schema, init).then((value) => schema.parse(value)),
        stream: vi.fn(),
      }}
    />,
  );
  return {
    ...view,
    save,
    remove,
    scan,
    request,
    setUsages(value: ProjectTagUsage[]) {
      usages = value;
    },
  };
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
      if (path.endsWith('/tags')) return Promise.resolve(schema.parse([]));
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

it('标签增改通过宿主请求并同步查询与画布列表', async () => {
  setupTags();
  await screen.findByRole('button', { name: '编辑画布' });
  await act(async () => {
    await captured.host!.tags!.create({ name: '新增', color: 'green' });
  });
  await waitFor(() =>
    expect(captured.store!.getState().tags?.map((tag) => tag.name)).toContain('新增'),
  );
  await act(async () => {
    await captured.host!.tags!.update('new', { name: '改名' });
  });
  await waitFor(() =>
    expect(captured.store!.getState().tags?.find((tag) => tag.id === 'new')?.name).toBe('改名'),
  );
});

it('删除先保存，当前页锁定节点一次改派可撤销，其他页交由 engine', async () => {
  const test = setupTags();
  await screen.findByRole('button', { name: '编辑画布' });
  act(() => {
    captured
      .store!.getState()
      .apply((doc) => ({ ...doc, nodes: doc.nodes.map((node) => ({ ...node, title: '编辑后' })) }));
  });
  let result!: Promise<ProjectTag[] | null>;
  act(() => {
    result = captured.host!.tags!.remove(oldTag);
  });
  await screen.findByRole('dialog');
  expect(test.save).toHaveBeenCalledOnce();
  expect(test.save.mock.invocationCallOrder[0]).toBeLessThan(test.scan.mock.invocationCallOrder[0]);
  const history = captured.store!.getState().past.length;
  fireEvent.change(screen.getByRole('combobox', { name: '全部改为' }), {
    target: { value: 'new' },
  });
  fireEvent.click(screen.getByRole('button', { name: '删除标签' }));
  await act(async () => {
    expect(await result).toEqual([newTag]);
  });
  expect(test.save).toHaveBeenCalledTimes(2);
  expect(test.save.mock.invocationCallOrder[1]).toBeLessThan(
    test.remove.mock.invocationCallOrder[0],
  );
  expect(test.remove).toHaveBeenCalledWith({
    reassign: [{ pageId: otherPageId, nodeId: 'two', tagId: 'new' }],
  });
  expect(captured.store!.getState().document.nodes[0]).toMatchObject({
    tagId: 'new',
    locked: true,
  });
  expect(captured.store!.getState().past).toHaveLength(history + 1);
  act(() => captured.store!.getState().undo());
  expect(captured.store!.getState().document.nodes[0].tagId).toBe('old');
});

it('删除遇到 409 后重新扫描并重置选择，取消不再提交', async () => {
  const test = setupTags();
  test.remove.mockRejectedValueOnce(new EngineRequestError(409, 'TAG_IN_USE', '仍有引用'));
  await screen.findByRole('button', { name: '编辑画布' });
  let result!: Promise<ProjectTag[] | null>;
  act(() => {
    result = captured.host!.tags!.remove(oldTag);
  });
  await screen.findByRole('dialog');
  test.setUsages([{ ...tagUsages[1], nodeId: 'three', title: '新增引用' }]);
  fireEvent.change(screen.getByRole('combobox', { name: '全部改为' }), {
    target: { value: '__none' },
  });
  fireEvent.click(screen.getByRole('button', { name: '删除标签' }));
  await screen.findByRole('combobox', { name: '新增引用的改派标签' });
  expect(test.scan).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('alert').textContent).toContain('引用已变化');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '删除标签' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await act(async () => {
    expect(await result).toBeNull();
  });
  expect(test.remove).toHaveBeenCalledOnce();
});

it('保存失败中止删除，既不扫描引用也不提交', async () => {
  const test = setupTags();
  await screen.findByRole('button', { name: '编辑画布' });
  test.save.mockRejectedValueOnce(new Error('磁盘写入失败'));
  fireEvent.click(screen.getByRole('button', { name: '编辑画布' }));
  await act(async () => {
    expect(await captured.host!.tags!.remove(oldTag)).toBeNull();
  });
  expect(screen.getByRole('alert').textContent).toContain('磁盘写入失败');
  expect(test.scan).not.toHaveBeenCalled();
  expect(test.remove).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('当前页改派后保存失败保留本地修改，但不发送删除请求', async () => {
  const test = setupTags();
  await screen.findByRole('button', { name: '编辑画布' });
  let result!: Promise<ProjectTag[] | null>;
  act(() => {
    result = captured.host!.tags!.remove(oldTag);
  });
  await screen.findByRole('dialog');
  test.save.mockRejectedValueOnce(new Error('改派保存失败'));
  fireEvent.change(screen.getByRole('combobox', { name: '全部改为' }), {
    target: { value: '__none' },
  });
  fireEvent.click(screen.getByRole('button', { name: '删除标签' }));
  await act(async () => {
    expect(await result).toBeNull();
  });
  expect(captured.store!.getState().document.nodes[0]).not.toHaveProperty('tagId');
  expect(test.remove).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('改派保存失败');
});

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
      '/projects/00000000-0000-4000-8000-000000000001/tags': [],
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

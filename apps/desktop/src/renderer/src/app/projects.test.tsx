import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import type { EngineClient } from '@/lib/engine-client';
import { EngineRequestError } from '@/lib/engine-client';
import { AppProviders } from '@/app/providers';
import { createAppRouter } from '@/app/router';
import { visibleProjects } from '@/lib/project-queries';
import { getPreferences, pickDirectory, setPreferences, trashProject } from '@/lib/desktop-bridge';

vi.mock('@/lib/desktop-bridge', () => ({
  getPreferences: vi.fn(),
  setPreferences: vi.fn(),
  pickDirectory: vi.fn(),
  trashProject: vi.fn(),
  revealProject: vi.fn(),
  getTheme: vi.fn().mockResolvedValue('system'),
  onEngineExited: vi.fn(() => () => {}),
  getWindowMaximized: vi.fn().mockResolvedValue(false),
  onWindowMaximizedChanged: vi.fn(() => () => {}),
}));
const id = '00000000-0000-4000-8000-000000000001';
const pageId = '00000000-0000-4000-8000-000000000002';
const time = '2026-10-26T00:00:00Z';
const episodeId = '00000000-0000-4000-8000-000000000004';
const episode = {
  id: episodeId,
  number: 3,
  title: '重逢',
  createdAt: time,
  updatedAt: time,
  scenes: 0,
  chars: 0,
  draft: false,
  conversion: null,
  pending: 0,
};
const project = {
  id,
  name: '项目 2',
  rootPath: 'D:\\Projects\\项目 2',
  locationKind: 'local' as const,
  remoteId: null,
  createdAt: time,
  updatedAt: time,
  addedAt: time,
  lastOpenedAt: time,
  status: 'available' as const,
};
const manifest = {
  id,
  name: '项目 2',
  format: 'frame-loom-project',
  formatVersion: 1,
  createdAt: time,
  updatedAt: time,
  pages: [] as {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    coverSha256: string | null;
  }[],
};
const prefs = {
  version: 1 as const,
  theme: 'system' as const,
  projectLocation: 'D:\\Projects',
  projectSort: 'updated' as const,
};
const clients: QueryClient[] = [];
const histories: ReturnType<typeof createMemoryHistory>[] = [];
beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('__APP_VERSION__', '0.1.0');
  vi.mocked(getPreferences).mockResolvedValue(prefs);
  vi.mocked(setPreferences).mockImplementation((value) => Promise.resolve({ ...prefs, ...value }));
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  histories.splice(0).forEach((history) => history.destroy());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function mount(
  path = '/projects',
  override?: (path: string, init?: RequestInit & { body?: unknown }) => unknown,
) {
  const request = vi.fn((path: string, init?: RequestInit & { body?: unknown }) => {
    const result = override?.(path, init);
    if (result !== undefined) return result;
    if (path === '/health')
      return { status: 'ok', engineVersion: '0.1.0', schemaVersion: '3', startedAt: time };
    if (path === '/projects') return [project];
    if (path === `/projects/${id}`) return manifest;
    if (path === `/projects/${id}/episodes`) return [];
    if (path.includes('/assets?')) return [];
    if (path === '/generation-jobs') return [];
    throw new Error(`未模拟 ${path}`);
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(queryClient);
  const history = createMemoryHistory({ initialEntries: [path] });
  histories.push(history);
  const engineClient: EngineClient = {
    stream: vi.fn(),
    request(path, schema, init) {
      return Promise.resolve(request(path, init as never)).then((value) => schema.parse(value));
    },
  };
  const router = createAppRouter({ engineClient, queryClient }, history);
  await router.load();
  render(
    <StrictMode>
      <AppProviders router={router} />
    </StrictMode>,
  );
  return { router, request };
}
function openMenu(name = '项目 2') {
  fireEvent.keyDown(screen.getByRole('button', { name: `${name} 的菜单` }), { key: 'Enter' });
}

it('项目设定可选，题材限制五个并支持自定义，卡片菜单保存使用 PUT', async () => {
  const profile = { form: 'short', medium: 'live', genres: ['都市'], aspect: '9:16' };
  const { request } = await mount('/projects', (path, init) =>
    path === `/projects/${id}/profile` && init?.method === 'PUT'
      ? { ...manifest, profile: init.body }
      : undefined,
  );
  await screen.findByText('未设置项目设定');
  openMenu();
  fireEvent.click(await screen.findByRole('menuitem', { name: '项目设定' }));
  const dialog = within(await screen.findByRole('dialog'));
  fireEvent.click(dialog.getByRole('radio', { name: '短剧' }));
  fireEvent.click(dialog.getByRole('radio', { name: '真人实拍' }));
  for (const name of ['都市', '古装', '悬疑', '爱情', '喜剧', '科幻'])
    fireEvent.click(dialog.getByRole('button', { name }));
  await dialog.findByText('最多选择 5 个题材');
  for (const name of ['古装', '悬疑', '爱情', '喜剧'])
    fireEvent.click(dialog.getByRole('button', { name }));
  fireEvent.click(dialog.getByRole('button', { name: '+ 自定义' }));
  fireEvent.change(dialog.getByLabelText('自定义题材'), { target: { value: '公路' } });
  fireEvent.keyDown(dialog.getByLabelText('自定义题材'), { key: 'Enter' });
  fireEvent.click(dialog.getByRole('button', { name: '删除题材 公路' }));
  fireEvent.click(dialog.getByRole('radio', { name: '9:16' }));
  fireEvent.click(dialog.getByRole('button', { name: '确认' }));
  await vi.waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      `/projects/${id}/profile`,
      expect.objectContaining({ method: 'PUT', body: profile }),
    ),
  );
});

it('新建项目填写设定后携带 profile，收起时默认不携带', async () => {
  const { request } = await mount('/projects', (path, init) =>
    path === '/projects' && init?.method === 'POST' ? project : undefined,
  );
  fireEvent.click(screen.getAllByRole('button', { name: '新建项目' }).at(-1)!);
  const dialog = within(await screen.findByRole('dialog'));
  fireEvent.change(dialog.getByLabelText('项目名称'), { target: { value: '新项目' } });
  const details = dialog.getByText('项目设定（可选）').closest('details')!;
  details.open = true;
  fireEvent.click(dialog.getByRole('radio', { name: '短剧' }));
  fireEvent.click(dialog.getByRole('radio', { name: '真人实拍' }));
  fireEvent.click(dialog.getByRole('button', { name: '都市' }));
  fireEvent.click(dialog.getByRole('button', { name: '创建项目' }));
  await vi.waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      '/projects',
      expect.objectContaining({
        body: {
          name: '新项目',
          location: prefs.projectLocation,
          profile: { form: 'short', medium: 'live', genres: ['都市'], aspect: null },
        },
      }),
    ),
  );
});

it('剧集默认集号递增，重复错误展示并可创建后进入剧本', async () => {
  let conflict = true;
  const { router } = await mount(`/projects/${id}`, (path, init) => {
    if (path === `/projects/${id}/episodes`) {
      if (init?.method === 'POST') {
        if (conflict) throw new EngineRequestError(409, 'EPISODE_NUMBER_CONFLICT', '集号已存在');
        return {
          id: episode.id,
          number: 4,
          title: '',
          createdAt: time,
          updatedAt: time,
          scenes: 0,
          chars: 0,
          draft: false,
        };
      }
      return [episode];
    }
    if (path === `/projects/${id}/episodes/${episodeId}/script`)
      return {
        format: 'frame-loom-script',
        formatVersion: 1,
        id: episodeId,
        revision: 1,
        source: null,
        pendingImport: null,
        convertedAt: null,
        document: { schemaVersion: 1, blocks: [] },
        conversion: null,
      };
    return undefined;
  });
  fireEvent.click(await screen.findByRole('button', { name: '新建剧集' }));
  const dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getByRole<HTMLInputElement>('spinbutton', { name: '集号' }).value).toBe('4');
  fireEvent.click(dialog.getByRole('button', { name: '确认' }));
  await dialog.findByText('集号已存在');
  conflict = false;
  fireEvent.click(dialog.getByRole('button', { name: '确认' }));
  await vi.waitFor(() =>
    expect(router.state.location.pathname).toBe(`/projects/${id}/episodes/${episodeId}`),
  );
});

it('创作页只修改所属剧集时提交 episodeId，并在侧栏按剧集分组', async () => {
  const page = { id: pageId, name: '画布', createdAt: time, updatedAt: time, coverSha256: null };
  const { request } = await mount(`/projects/${id}?tab=pages`, (path, init) => {
    if (path === `/projects/${id}`)
      return {
        ...manifest,
        episodes: [
          {
            id: episode.id,
            number: episode.number,
            title: episode.title,
            createdAt: time,
            updatedAt: time,
            scenes: 0,
            chars: 0,
            draft: false,
          },
        ],
        pages: [page],
      };
    if (path === `/projects/${id}/episodes`) return [episode];
    if (path === `/projects/${id}/pages/${pageId}` && init?.method === 'PATCH')
      return { ...page, episodeId };
    return undefined;
  });
  await screen.findByRole('heading', { name: '画布' });
  openMenu('画布');
  fireEvent.click(await screen.findByRole('menuitem', { name: '重命名' }));
  const dialog = within(await screen.findByRole('dialog'));
  await vi.waitFor(() =>
    expect(dialog.getByRole<HTMLSelectElement>('combobox').disabled).toBe(false),
  );
  fireEvent.change(dialog.getByRole('combobox'), { target: { value: episodeId } });
  fireEvent.click(dialog.getByRole('button', { name: '确认' }));
  await vi.waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      `/projects/${id}/pages/${pageId}`,
      expect.objectContaining({ method: 'PATCH', body: { episodeId } }),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '展开 项目 2' }));
  fireEvent.click(await screen.findByRole('button', { name: '第 3 集 重逢' }));
  expect(screen.getByRole('link', { name: '剧本' }).getAttribute('href')).toContain(
    `/episodes/${episodeId}`,
  );
});

it('删除提示未结束任务，勾选后先放弃任务再移到回收站', async () => {
  const job = {
    id: pageId,
    kind: 'image',
    modelId: id,
    configHash: 'test',
    status: 'running',
    request: { projectId: id, modelId: id, prompt: 'test', inputs: [], params: {}, extras: {} },
    remoteTaskId: null,
    remoteStatus: null,
    attempts: 1,
    nextPollAt: null,
    errorCategory: null,
    errorCode: null,
    errorMessage: null,
    outputs: [],
    createdAt: time,
    updatedAt: time,
    finishedAt: null,
  };
  const { request } = await mount('/projects', (path, init) =>
    path === '/generation-jobs'
      ? [job]
      : path.endsWith('/cancel')
        ? { ...job, status: 'cancelled' }
        : path === `/projects/${id}` && init?.method === 'DELETE'
          ? { saved: true }
          : undefined,
  );
  vi.mocked(trashProject).mockImplementation(() => {
    expect(request.mock.calls.some(([path]) => path.endsWith('/cancel'))).toBe(true);
    return Promise.resolve();
  });
  await screen.findByRole('article');
  openMenu();
  fireEvent.click(await screen.findByRole('menuitem', { name: '删除' }));
  const dialog = within(await screen.findByRole('dialog'));
  await dialog.findByText('有 1 个未结束任务，远端可能仍在运行并计费。');
  const checkbox = dialog.getByRole<HTMLInputElement>('checkbox', { name: '同时放弃这些任务' });
  expect(checkbox.checked).toBe(false);
  fireEvent.click(checkbox);
  fireEvent.click(dialog.getByRole('button', { name: '确认' }));
  await vi.waitFor(() => expect(trashProject).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('资产目录与后退同步 search，布局持久化；全项目搜索显示路径与上限且非媒体不预览', async () => {
  const folder = {
    name: '角色',
    path: '角色',
    type: 'directory',
    bytes: 0,
    updatedAt: time,
    mediaKind: null,
  };
  const file = { ...folder, name: '说明.txt', path: '角色/说明.txt', type: 'file', bytes: 20 };
  const { router } = await mount(`/projects/${id}?tab=assets`, (path) => {
    if (path.endsWith('/assets?path=')) return [folder];
    if (path.includes('/assets?path=')) return [file];
    if (path.includes('/assets/search?')) return { entries: [file], truncated: true };
  });
  fireEvent.click(await screen.findByRole('button', { name: '角色' }));
  await vi.waitFor(() => expect(router.state.location.search.path).toBe('角色'));
  expect(await screen.findByRole('button', { name: '说明.txt' })).toBeDefined();
  router.history.back();
  await vi.waitFor(() => expect(router.state.location.search.path).toBe(''));
  fireEvent.click(screen.getByRole('radio', { name: '宫格视图' }));
  await vi.waitFor(() => expect(setPreferences).toHaveBeenCalledWith({ assetView: 'grid' }));
  fireEvent.change(screen.getByRole('textbox', { name: '搜索项目资产' }), {
    target: { value: '说明' },
  });
  await screen.findByText('结果超过上限，请缩小搜索范围。');
  expect(screen.getByText('角色/说明.txt')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: '说明.txt' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('资产文件夹重名显示错误，删除明确移到回收站并传非空 path', async () => {
  const entry = {
    name: '角色',
    path: '角色',
    type: 'directory',
    bytes: 0,
    updatedAt: time,
    mediaKind: null,
  };
  await mount(`/projects/${id}?tab=assets`, (path, init) => {
    if (path.includes('/assets?')) return [entry];
    if (path.endsWith('/assets/folders') && init?.method === 'POST')
      throw new Error('已存在同名文件夹');
  });
  fireEvent.click(await screen.findByRole('button', { name: '新建文件夹' }));
  fireEvent.change(screen.getByRole('textbox', { name: '资产名称' }), {
    target: { value: '角色' },
  });
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  await screen.findByText('已存在同名文件夹');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  fireEvent.keyDown(screen.getByRole('button', { name: '角色 的菜单' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: '删除' }));
  expect(screen.getByText('「角色」将移到回收站。')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: '移到回收站' }));
  await vi.waitFor(() =>
    expect(trashProject).toHaveBeenCalledWith({ projectId: id, path: '角色' }),
  );
});
it('普通文件拖放允许复制并进入上传队列', async () => {
  let uploadBody: unknown;
  await mount(`/projects/${id}?tab=assets`, (path, init) => {
    if (path.includes('/assets/files?')) {
      uploadBody = init?.body;
      return new Promise(() => {});
    }
  });
  const content = await screen.findByLabelText('项目资产内容');
  const target = content.querySelector('[role="list"]')!.parentElement!.parentElement!;
  const file = new File(['image'], '拖放图片.png', { type: 'image/png' });
  const dataTransfer = {
    types: ['Files'],
    dropEffect: 'none',
    items: [{ webkitGetAsEntry: () => ({ isDirectory: false }), getAsFile: () => file }],
    files: [file],
  };
  expect(fireEvent.dragOver(target, { dataTransfer })).toBe(false);
  expect(dataTransfer.dropEffect).toBe('copy');
  fireEvent.drop(target, { dataTransfer });
  await vi.waitFor(() => expect(uploadBody).toBe(file));
  expect(await screen.findByRole('region', { name: '上传队列' })).toBeDefined();
});
it('点击上传文件触发文件输入，选中文件后上传完成', async () => {
  const entry = {
    name: '图片.png',
    path: '图片.png',
    type: 'file',
    bytes: 1,
    updatedAt: time,
    mediaKind: 'image',
  };
  const { request } = await mount(`/projects/${id}?tab=assets`, (path) =>
    path.includes('/assets/files?') ? entry : undefined,
  );
  await screen.findByLabelText('项目资产内容');
  const input = await screen.findByLabelText<HTMLInputElement>('上传项目文件');
  const clickInput = vi.spyOn(input, 'click');
  fireEvent.click(screen.getByRole('button', { name: '上传文件' }));
  expect(clickInput).toHaveBeenCalledOnce();
  fireEvent.change(input, {
    target: { files: [new File(['image'], '图片.png', { type: 'image/png' })] },
  });
  await screen.findByRole('region', { name: '上传队列' });
  await screen.findByText('已完成');
  const upload = request.mock.calls.find(([path]) => path.includes('/assets/files?'));
  expect(upload?.[1]?.method).toBe('POST');
  expect(upload?.[1]?.body).toBeInstanceOf(File);
});
it('文件夹拖放被跳过，上传未结束时离开确认，确认离开中止请求', async () => {
  let uploadSignal: AbortSignal | undefined;
  const { router, request } = await mount(`/projects/${id}?tab=assets`, (path, init) => {
    if (path.includes('/assets/files?')) {
      uploadSignal = init?.signal ?? undefined;
      return new Promise(() => {});
    }
  });
  const content = await screen.findByLabelText('项目资产内容');
  const target = content.querySelector('[role="list"]')!.parentElement!.parentElement!;
  fireEvent.drop(target, {
    dataTransfer: {
      items: [{ webkitGetAsEntry: () => ({ isDirectory: true }), getAsFile: () => null }],
      files: [],
    },
  });
  await screen.findByText('暂不支持上传文件夹');
  expect(request.mock.calls.some(([path]) => path.includes('/assets/files?'))).toBe(false);
  fireEvent.change(screen.getByLabelText('上传项目文件'), {
    target: { files: [new File(['x'], '图片.png')] },
  });
  await vi.waitFor(() => expect(uploadSignal).toBeDefined());
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const assetsTab = screen.getByRole('tab', { name: '项目资产' });
  assetsTab.focus();
  fireEvent.keyDown(assetsTab, { key: 'ArrowLeft' });
  await vi.waitFor(() => expect(router.state.location.search.tab).toBe('story'));
  expect(uploadSignal!.aborted).toBe(false);
  fireEvent.click(screen.getAllByRole('link', { name: '项目库' })[0]);
  await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  expect(router.state.location.pathname).toBe(`/projects/${id}`);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getAllByRole('link', { name: '项目库' })[0]);
  await vi.waitFor(() => expect(router.state.location.pathname).toBe('/projects'));
  expect(uploadSignal!.aborted).toBe(true);
  confirm.mockRestore();
});

it('打开已有项目支持副本及重名修改，取消选择不会提交', async () => {
  const { request, router } = await mount('/projects', (path) =>
    path === '/projects/open' ? project : undefined,
  );
  fireEvent.click(screen.getByRole('button', { name: '打开已有项目' }));
  const dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getByRole<HTMLButtonElement>('button', { name: '确认' }).disabled).toBe(true);
  vi.mocked(pickDirectory).mockResolvedValue('D:\\已有项目');
  fireEvent.click(dialog.getByRole('button', { name: '更改' }));
  await dialog.findByText('D:\\已有项目');
  fireEvent.click(dialog.getByRole('checkbox'));
  expect(dialog.getByRole<HTMLButtonElement>('button', { name: '确认' }).disabled).toBe(true);
  fireEvent.change(dialog.getByRole('textbox'), { target: { value: '项目副本' } });
  fireEvent.click(dialog.getByRole('button', { name: '确认' }));
  await vi.waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      '/projects/open',
      expect.objectContaining({
        body: { rootPath: 'D:\\已有项目', asCopy: true, name: '项目副本' },
      }),
    ),
  );
  await vi.waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${id}`));
});

it('清理先统计再确认执行；活动会话跳过时禁用操作', async () => {
  let skipped = false;
  const { request } = await mount('/projects', (path) =>
    path.includes('/media/cleanup?') ? { files: 2, bytes: 1048576, skipped } : undefined,
  );
  await screen.findByRole('article');
  openMenu();
  fireEvent.click(await screen.findByRole('menuitem', { name: '清理未使用媒体' }));
  let dialog = within(await screen.findByRole('dialog'));
  await dialog.findByText('将永久删除 2 个文件，释放 1.00 MiB，无法撤销。');
  expect(request.mock.calls.some(([path]) => path.endsWith('dryRun=false'))).toBe(false);
  fireEvent.click(dialog.getByRole('button', { name: '确认' }));
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(request.mock.calls.some(([path]) => path.endsWith('dryRun=false'))).toBe(true);
  skipped = true;
  openMenu();
  fireEvent.click(await screen.findByRole('menuitem', { name: '清理未使用媒体' }));
  dialog = within(await screen.findByRole('dialog'));
  await dialog.findByText('项目正在编辑，请关闭创作页后重试。');
  expect(dialog.getByRole<HTMLButtonElement>('button', { name: '确认' }).disabled).toBe(true);
});

it('搜索与三种排序使用数字感知；更新与创建分别排序且不改输入', () => {
  const list = [
    project,
    { ...project, name: '项目 10', createdAt: '2026-10-27T00:00:00Z' },
    { ...project, name: '项目 1', updatedAt: '2026-10-28T00:00:00Z' },
  ];
  expect(visibleProjects(list, 'name').map((p) => p.name)).toEqual(['项目 1', '项目 2', '项目 10']);
  expect(visibleProjects(list, 'updated')[0].name).toBe('项目 1');
  expect(visibleProjects(list, 'created')[0].name).toBe('项目 10');
  expect(visibleProjects(list, 'name', ' 10 ').map((p) => p.name)).toEqual(['项目 10']);
  expect(list[0]).toBe(project);
});
it('项目库搜索过滤与排序偏好保存', async () => {
  await mount();
  await screen.findByRole('article', { name: '项目 2' });
  fireEvent.change(screen.getByRole('textbox', { name: '搜索项目' }), {
    target: { value: '不存在' },
  });
  expect(screen.queryByRole('article')).toBeNull();
  expect(screen.getByText('没有找到项目')).toBeDefined();
  fireEvent.keyDown(screen.getByRole('button', { name: '项目排序：最近修改' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitemradio', { name: '名称' }));
  await vi.waitFor(() => expect(setPreferences).toHaveBeenCalledWith({ projectSort: 'name' }));
});
it('新建校验禁用，目录选择取消保留原路径，engine 错误显示在名称下方', async () => {
  await mount('/projects', (path, init) => {
    if (path === '/projects' && init?.method === 'POST')
      throw new EngineRequestError(409, 'PROJECT_NAME_CONFLICT', '项目名称已存在');
  });
  fireEvent.click(screen.getAllByRole('button', { name: '新建项目' }).at(-1)!);
  const dialog = within(await screen.findByRole('dialog'));
  const submit = dialog.getByRole<HTMLButtonElement>('button', { name: '创建项目' });
  expect(submit.disabled).toBe(true);
  fireEvent.change(dialog.getByRole('textbox', { name: '项目名称' }), { target: { value: 'CON' } });
  expect(submit.disabled).toBe(true);
  fireEvent.change(dialog.getByRole('textbox', { name: '项目名称' }), {
    target: { value: '新项目' },
  });
  vi.mocked(pickDirectory).mockResolvedValue(null);
  fireEvent.click(dialog.getByRole('button', { name: '更改' }));
  await vi.waitFor(() => expect(pickDirectory).toHaveBeenCalled());
  await vi.waitFor(() => expect(submit.disabled).toBe(false));
  fireEvent.click(submit);
  await vi.waitFor(() => expect(dialog.getByText('项目名称已存在').id).toBe('project-name-error'));
  expect(dialog.getByText('D:\\Projects')).toBeDefined();
});
it('删除默认回收站，失败时不移除注册记录，重试成功后才移除', async () => {
  const { request } = await mount('/projects', (path, init) =>
    path === `/projects/${id}` && init?.method === 'DELETE' ? { saved: true } : undefined,
  );
  await screen.findByRole('article');
  openMenu();
  fireEvent.click(await screen.findByRole('menuitem', { name: '删除' }));
  const dialog = within(await screen.findByRole('dialog'));
  expect(
    dialog.getByRole<HTMLInputElement>('radio', { name: '同时将项目文件夹移到回收站' }).checked,
  ).toBe(true);
  vi.mocked(trashProject).mockRejectedValueOnce(new Error('文件被占用'));
  await vi.waitFor(() =>
    expect(dialog.getByRole<HTMLButtonElement>('button', { name: '确认' }).disabled).toBe(false),
  );
  fireEvent.click(dialog.getByRole('button', { name: '确认' }));
  await dialog.findByText('文件被占用');
  expect(request.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  vi.mocked(trashProject).mockResolvedValue(undefined);
  fireEvent.click(dialog.getByRole('button', { name: '确认' }));
  await vi.waitFor(() =>
    expect(request.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true),
  );
});
it('不可用卡片只提供重新定位与移除，移除不调用回收站', async () => {
  const { request } = await mount('/projects', (path, init) =>
    path === '/projects'
      ? [{ ...project, status: 'missing' }]
      : path === `/projects/${id}` && init?.method === 'DELETE'
        ? { saved: true }
        : undefined,
  );
  await screen.findByRole('article');
  openMenu();
  expect(await screen.findByRole('menuitem', { name: '重新定位' })).toBeDefined();
  expect(screen.queryByRole('menuitem', { name: '在资源管理器中显示' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: '从项目库移除' }));
  const dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getByRole<HTMLInputElement>('radio', { name: '仅从项目库移除' }).checked).toBe(
    true,
  );
  await vi.waitFor(() =>
    expect(dialog.getByRole<HTMLButtonElement>('button', { name: '确认' }).disabled).toBe(false),
  );
  fireEvent.click(dialog.getByRole('button', { name: '确认' }));
  await vi.waitFor(() =>
    expect(request.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true),
  );
  expect(trashProject).not.toHaveBeenCalled();
});
it('详情非法 search 回退、侧栏展开空项目；新建创作页跳转独立页面路由', async () => {
  const page = { id: pageId, name: '第一集', createdAt: time, updatedAt: time, coverSha256: null };
  const { router } = await mount(`/projects/${id}?tab=bad&path=..`, (path, init) =>
    path === `/projects/${id}/pages` && init?.method === 'POST' ? page : undefined,
  );
  await screen.findByRole('heading', { name: '项目 2' });
  expect(router.state.location.search).toMatchObject({ tab: 'episodes', path: '' });
  fireEvent.click(screen.getByRole('button', { name: '展开 项目 2' }));
  await screen.findByText('无内容');
  screen.getByRole('tab', { name: '剧集' }).focus();
  fireEvent.keyDown(screen.getByRole('tab', { name: '剧集' }), { key: 'ArrowRight' });
  fireEvent.click(await screen.findByRole('button', { name: '新建创作页' }));
  const dialog = within(await screen.findByRole('dialog'));
  fireEvent.change(dialog.getByRole('textbox', { name: '创作页名称' }), {
    target: { value: '第一集' },
  });
  fireEvent.click(dialog.getByRole('button', { name: '确认' }));
  await vi.waitFor(() =>
    expect(router.state.location.pathname).toBe(`/projects/${id}/pages/${pageId}`),
  );
  expect(await screen.findByRole('region', { name: '项目画布' })).toBeDefined();
});
it('详情封面与纯色卡片、侧栏页面高亮，Tab 支持键盘导航', async () => {
  const page = {
    id: pageId,
    name: '第一集',
    createdAt: time,
    updatedAt: time,
    coverSha256: 'a'.repeat(64),
  };
  const { router } = await mount(`/projects/${id}?tab=pages`, (path) =>
    path === `/projects/${id}`
      ? {
          ...manifest,
          pages: [
            page,
            {
              ...page,
              id: '00000000-0000-4000-8000-000000000003',
              name: '第二集',
              coverSha256: null,
            },
          ],
        }
      : undefined,
  );
  await screen.findByRole('heading', { name: '第一集' });
  expect(document.querySelector('img[src^="frame-project:"]')?.getAttribute('src')).toBe(
    `frame-project://${id}/media/${page.coverSha256}`,
  );
  fireEvent.click(screen.getByRole('button', { name: '展开 项目 2' }));
  const tree = within(screen.getByRole('navigation', { name: '项目树' }));
  await tree.findByRole('link', { name: '第一集' });
  const pagesTab = screen.getByRole('tab', { name: '创作页' });
  pagesTab.focus();
  fireEvent.keyDown(pagesTab, { key: 'ArrowRight' });
  await vi.waitFor(() => expect(router.state.location.search.tab).toBe('story'));
  fireEvent.click(screen.getByRole('tab', { name: '项目资产' }));
  expect(screen.getByLabelText('项目资产内容')).toBeDefined();
  fireEvent.click(tree.getByRole('link', { name: '第一集' }));
  await vi.waitFor(() =>
    expect(tree.getByRole('link', { name: '第一集' }).getAttribute('aria-current')).toBe('page'),
  );
});

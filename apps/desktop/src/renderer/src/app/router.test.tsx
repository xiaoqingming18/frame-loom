import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { AppProviders } from '@/app/providers';
import { createAppRouter } from '@/app/router';
import { EngineRequestError, type EngineClient } from '@/lib/engine-client';
import {
  commandWindow,
  getTheme,
  setTheme,
  getWindowMaximized,
  onWindowMaximizedChanged,
  onEngineExited,
} from '@/lib/desktop-bridge';

vi.mock('@/lib/desktop-bridge', () => ({
  getTheme: vi.fn(),
  setTheme: vi.fn(),
  commandWindow: vi.fn(),
  getWindowMaximized: vi.fn(),
  onWindowMaximizedChanged: vi.fn(),
  onEngineExited: vi.fn(),
}));

const clients: QueryClient[] = [];
const histories: ReturnType<typeof createMemoryHistory>[] = [];

beforeEach(() => {
  vi.mocked(getWindowMaximized).mockResolvedValue(false);
  vi.mocked(onWindowMaximizedChanged).mockReturnValue(vi.fn());
  vi.mocked(onEngineExited).mockReturnValue(vi.fn());
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('__APP_VERSION__', '0.1.0');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.mocked(getTheme).mockResolvedValue('system');
  vi.mocked(setTheme).mockImplementation((source) => Promise.resolve(source));
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  histories.splice(0).forEach((history) => history.destroy());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function renderPage(
  request: (...args: Parameters<EngineClient['request']>) => Promise<unknown>,
  path = '/',
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createAppRouter(
    {
      queryClient,
      engineClient: {
        stream: () => {
          throw new Error('当前路由测试不应订阅事件');
        },
        async request(path, schema, init) {
          return schema.parse(await request(path, schema, init));
        },
      },
    },
    history,
  );
  clients.push(queryClient);
  histories.push(history);
  await router.load();
  render(<AppProviders router={router} />);
  return router;
}

it('通过路由 context 注入替身客户端，显示加载中并禁用检查按钮', async () => {
  const request = vi.fn<EngineClient['request']>(() => new Promise(() => {}));
  await renderPage(request, '/?settings=engine');
  expect((await screen.findByRole('status')).textContent).toBe('正在连接');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '连接中…' }).disabled).toBe(true);
  expect(request).toHaveBeenCalledWith('/health', expect.anything(), {
    signal: expect.anything() as AbortSignal,
  });
});

it('显示正常状态、版本和启动时间，允许重新检查', async () => {
  const request = vi.fn<EngineClient['request']>().mockResolvedValue({
    status: 'ok',
    engineVersion: '0.1.0',
    schemaVersion: '1',
    startedAt: '2026-10-24T00:00:00Z',
  });
  await renderPage(request, '/?settings=engine');
  await screen.findByText('运行正常');
  expect(screen.getByTestId('engine-version').textContent).toBe('0.1.0');
  expect(document.querySelector('time')?.dateTime).toBe('2026-10-24T00:00:00Z');
  fireEvent.click(screen.getByRole('button', { name: /重新检查/ }));
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
});

it('错误状态显示中文业务消息且不自动重试', async () => {
  const request = vi
    .fn<EngineClient['request']>()
    .mockRejectedValue(new EngineRequestError(401, 'HTTP_401', '访问令牌无效'));
  await renderPage(request, '/?settings=engine');
  expect((await screen.findByRole('alert')).textContent).toContain('访问令牌无效');
  expect(screen.getByRole('status').textContent).toBe('连接中断');
  expect(request).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('本地引擎连接失败')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '设置中心' }));
  fireEvent.click(await screen.findByRole('button', { name: '设置' }));
  fireEvent.mouseDown(await screen.findByRole('tab', { name: '本地引擎' }), {
    button: 0,
    ctrlKey: false,
  });
  await screen.findByText('连接中断');
  expect(request).toHaveBeenCalledOnce();
});

it('engine 退出事件使健康查询失效并显示错误圆点，不重载页面', async () => {
  const listeners: ((code: number | null) => void)[] = [];
  const unsubscribe = vi.fn();
  vi.mocked(onEngineExited).mockImplementation((callback) => {
    listeners.push(callback);
    return unsubscribe;
  });
  const request = vi
    .fn<EngineClient['request']>()
    .mockResolvedValueOnce({
      status: 'ok',
      engineVersion: '0.1.0',
      schemaVersion: '1',
      startedAt: '2026-10-24T00:00:00Z',
    })
    .mockRejectedValue(new EngineRequestError(0, 'NETWORK', '无法连接本地服务'));
  await renderPage(request);
  await vi.waitFor(() =>
    expect(clients.at(-1)!.getQueryState(['engine', 'health'])?.status).toBe('success'),
  );
  expect(screen.queryByLabelText('本地引擎连接失败')).toBeNull();
  act(() => listeners.at(-1)!(1));
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(await screen.findByLabelText('本地引擎连接失败')).toBeDefined();
  cleanup();
  expect(unsubscribe).toHaveBeenCalled();
});

it('未知路由显示中文 404 页并可返回首页', async () => {
  const request = vi.fn<EngineClient['request']>(() => new Promise(() => {}));
  await renderPage(request, '/missing');
  expect(await screen.findByRole('heading', { name: '页面不存在' })).toBeDefined();
  expect(screen.getByRole('link', { name: '返回首页' }).getAttribute('href')).toBe('/');
  expect(request).toHaveBeenCalledOnce();
});

const healthy = {
  status: 'ok',
  engineVersion: '0.1.0',
  schemaVersion: '1',
  startedAt: '2026-10-24T00:00:00Z',
};

it('侧栏随路由高亮，可折叠和恢复，首页控件不可提交但可聚焦', async () => {
  await renderPage(vi.fn().mockResolvedValue(healthy));
  expect(screen.getByRole('link', { name: '开始创作' }).getAttribute('aria-current')).toBe('page');
  const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '创作描述' });
  expect(input.readOnly).toBe(true);
  input.focus();
  expect(document.activeElement).toBe(input);
  expect(input.getAttribute('aria-describedby')).toBe('creation-unavailable');
  expect(screen.getByRole('button', { name: '发送' }).getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '折叠侧栏' }));
  expect(screen.getByRole('button', { name: '展开侧栏' })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: '展开侧栏' }));
  fireEvent.click(screen.getByRole('link', { name: '项目库' }));
  await screen.findByRole('heading', { name: '项目库' });
  expect(screen.getByRole('link', { name: '项目库' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('link', { name: '开始创作' }).getAttribute('aria-current')).toBeNull();
});

it('设置可打开、切页、关闭，路由保存页签，关于显示构建版本', async () => {
  const router = await renderPage(vi.fn().mockResolvedValue(healthy), '/projects');
  fireEvent.click(screen.getByRole('button', { name: '设置中心' }));
  await screen.findByRole('dialog', { name: '快捷设置' });
  expect(screen.queryByRole('dialog', { name: '设置中心' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  await screen.findByRole('dialog', { name: '设置中心' });
  await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: '快捷设置' })).toBeNull());
  await vi.waitFor(() =>
    expect(screen.getByRole('dialog', { name: '设置中心' }).contains(document.activeElement)).toBe(
      true,
    ),
  );
  await screen.findByRole('radio', { name: /跟随系统/ });
  expect(router.state.location.search.settings).toBe('appearance');
  fireEvent.mouseDown(screen.getByRole('tab', { name: '本地引擎' }), { button: 0, ctrlKey: false });
  await screen.findByText('运行正常');
  expect(router.state.location.search.settings).toBe('engine');
  fireEvent.mouseDown(screen.getByRole('tab', { name: '关于' }), { button: 0, ctrlKey: false });
  expect((await screen.findByTestId('app-version')).textContent).toBe('0.1.0');
  expect(router.state.location.search.settings).toBe('about');
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(router.state.location.search.settings).toBeUndefined();
  expect(router.state.location.pathname).toBe('/projects');
  await vi.waitFor(() => expect(document.activeElement?.id).toBe('settings-button'));
});

it('外观通过桥接读写主题，保存失败显示错误且保留原选择', async () => {
  await renderPage(vi.fn().mockResolvedValue(healthy), '/?settings=appearance');
  const dark = await screen.findByRole('radio', { name: /暗黑/ });
  fireEvent.click(dark);
  await vi.waitFor(() => expect(setTheme).toHaveBeenCalledWith('dark', expect.anything()));
  await vi.waitFor(() => expect(dark.getAttribute('aria-checked')).toBe('true'));
  vi.mocked(setTheme).mockRejectedValueOnce(new Error('磁盘不可写'));
  fireEvent.click(screen.getByRole('radio', { name: /明亮/ }));
  expect((await screen.findByRole('alert')).textContent).toContain('主题保存失败');
  expect(dark.getAttribute('aria-checked')).toBe('true');
});

it('快捷面板切换主题不关闭，打开设置后选择同步，Esc 恢复入口焦点', async () => {
  const router = await renderPage(vi.fn().mockResolvedValue(healthy));
  fireEvent.click(screen.getByRole('button', { name: '设置中心' }));
  fireEvent.click(await screen.findByRole('radio', { name: '暗黑' }));
  await vi.waitFor(() =>
    expect(screen.getByRole('radio', { name: '暗黑' }).getAttribute('aria-checked')).toBe('true'),
  );
  expect(screen.getByRole('dialog', { name: '快捷设置' })).toBeDefined();
  expect(router.state.location.search.settings).toBeUndefined();
  vi.mocked(getTheme).mockResolvedValue('dark');
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  await screen.findByRole('dialog', { name: '设置中心' });
  expect((await screen.findByRole('radio', { name: '暗黑' })).getAttribute('aria-checked')).toBe(
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '设置中心' }));
  await screen.findByRole('dialog', { name: '快捷设置' });
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await vi.waitFor(() => expect(document.activeElement?.id).toBe('settings-button'));
});

it('保存主题期间从面板进入设置仍禁止重复保存', async () => {
  let finish!: (source: 'dark') => void;
  vi.mocked(setTheme).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await renderPage(vi.fn().mockResolvedValue(healthy));
  fireEvent.click(screen.getByRole('button', { name: '设置中心' }));
  fireEvent.click(await screen.findByRole('radio', { name: '暗黑' }));
  await vi.waitFor(() => expect(setTheme).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  await screen.findByRole('dialog', { name: '设置中心' });
  await vi.waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('radio', { name: '明亮' }).disabled).toBe(true),
  );
  vi.mocked(getTheme).mockResolvedValue('dark');
  finish('dark');
  await vi.waitFor(() =>
    expect(screen.getByRole('radio', { name: '暗黑' }).getAttribute('aria-checked')).toBe('true'),
  );
  expect(screen.getByRole<HTMLButtonElement>('radio', { name: '明亮' }).disabled).toBe(false);
});

it('快捷主题读取失败可重试，保存失败保留原选择', async () => {
  vi.mocked(getTheme).mockRejectedValueOnce(new Error('读取失败'));
  await renderPage(vi.fn().mockResolvedValue(healthy));
  fireEvent.click(screen.getByRole('button', { name: '设置中心' }));
  expect((await screen.findByRole('alert')).textContent).toContain('主题读取失败');
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  vi.mocked(setTheme).mockRejectedValueOnce(new Error('磁盘不可写'));
  fireEvent.click(await screen.findByRole('radio', { name: '明亮' }));
  expect((await screen.findByRole('alert')).textContent).toContain('主题保存失败');
  expect(screen.getByRole('radio', { name: '跟随系统' }).getAttribute('aria-checked')).toBe('true');
});

it('非法设置参数回退到关闭状态，未出错时没有错误圆点', async () => {
  const router = await renderPage(vi.fn().mockResolvedValue(healthy), '/?settings=invalid');
  await screen.findByRole('heading', { name: '帧织' });
  expect(router.state.location.search.settings).toBeUndefined();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('img', { name: '本地引擎连接失败' })).toBeNull();
});

it.each([
  ['文件', '退出', 'quit'],
  ['窗口', '最小化', 'minimize'],
  ['窗口', '最大化 / 还原', 'toggle-maximize'],
  ['窗口', '切换全屏', 'toggle-fullscreen'],
] as const)('标题栏 %s 菜单的 %s 使用可信窗口桥接', async (menu, item, command) => {
  vi.mocked(commandWindow).mockResolvedValue();
  await renderPage(vi.fn().mockResolvedValue(healthy));
  fireEvent.keyDown(screen.getByRole('menuitem', { name: menu }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: item }));
  expect(commandWindow).toHaveBeenCalledWith(command);
});

it('帮助菜单打开关于页', async () => {
  await renderPage(vi.fn().mockResolvedValue(healthy));
  fireEvent.keyDown(screen.getByRole('menuitem', { name: '帮助' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: '关于 Frame Loom' }));
  expect((await screen.findByTestId('app-version')).textContent).toBe('0.1.0');
});

it('自绘窗口按钮转发命令，最大化事件优先于初始查询并在卸载时清理', async () => {
  let resolveInitial!: (value: boolean) => void;
  vi.mocked(getWindowMaximized).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveInitial = resolve;
      }),
  );
  const unsubscribe = vi.fn();
  vi.mocked(onWindowMaximizedChanged).mockReturnValue(unsubscribe);
  vi.mocked(commandWindow).mockResolvedValue();
  await renderPage(vi.fn().mockResolvedValue(healthy));
  const callback = vi.mocked(onWindowMaximizedChanged).mock.calls.at(-1)![0];
  act(() => callback(true));
  expect(screen.getByRole('button', { name: '还原窗口' })).toBeDefined();
  await act(() => {
    resolveInitial(false);
    return Promise.resolve();
  });
  expect(screen.getByRole('button', { name: '还原窗口' })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: '还原窗口' }));
  expect(commandWindow).toHaveBeenLastCalledWith('toggle-maximize');
  act(() => callback(false));
  fireEvent.click(screen.getByRole('button', { name: '最大化窗口' }));
  expect(commandWindow).toHaveBeenLastCalledWith('toggle-maximize');
  fireEvent.click(screen.getByRole('button', { name: '最小化窗口' }));
  expect(commandWindow).toHaveBeenLastCalledWith('minimize');
  fireEvent.click(screen.getByRole('button', { name: '关闭窗口' }));
  expect(commandWindow).toHaveBeenLastCalledWith('close');
  cleanup();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

it('初次读取最大化状态，窗口命令失败时保留可重试入口', async () => {
  vi.mocked(getWindowMaximized).mockResolvedValueOnce(true);
  vi.mocked(commandWindow).mockRejectedValueOnce(new Error('窗口关闭失败'));
  await renderPage(vi.fn().mockResolvedValue(healthy));
  await screen.findByRole('button', { name: '还原窗口' });
  fireEvent.click(screen.getByRole('button', { name: '关闭窗口' }));
  expect((await screen.findByRole('alert')).textContent).toContain('窗口操作失败');
  vi.mocked(commandWindow).mockResolvedValue();
  fireEvent.click(screen.getByRole('button', { name: '关闭窗口' }));
  await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});

it('默认 history 把空 hash 归一为首页，并保留已有 hash 路径', () => {
  const queryClient = new QueryClient();
  clients.push(queryClient);
  const context = {
    queryClient,
    engineClient: {
      request: vi.fn(),
      stream: () => {
        throw new Error('当前路由测试不应订阅事件');
      },
    },
  };
  window.history.replaceState(null, '', '/');
  const home = createAppRouter(context);
  histories.push(home.history);
  expect(window.location.hash).toBe('#/');
  window.history.replaceState(null, '', '#/missing');
  const missing = createAppRouter(context);
  histories.push(missing.history);
  expect(window.location.hash).toBe('#/missing');
  expect(missing.history.location.pathname).toBe('/missing');
  window.history.replaceState(null, '', '/');
});

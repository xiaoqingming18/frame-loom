import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { AppProviders } from '@/app/providers';
import { createAppRouter } from '@/app/router';
import { EngineRequestError, type EngineClient } from '@/lib/engine-client';

const clients: QueryClient[] = [];
const histories: ReturnType<typeof createMemoryHistory>[] = [];

beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()));

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  histories.splice(0).forEach((history) => history.destroy());
  vi.unstubAllGlobals();
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
}

it('通过路由 context 注入替身客户端，显示加载中并禁用检查按钮', async () => {
  const request = vi.fn<EngineClient['request']>(() => new Promise(() => {}));
  await renderPage(request);
  expect((await screen.findByRole('status')).textContent).toBe('正在连接');
  expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(true);
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
  await renderPage(request);
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
  await renderPage(request);
  expect((await screen.findByRole('alert')).textContent).toContain('访问令牌无效');
  expect(screen.getByRole('status').textContent).toBe('连接中断');
  expect(request).toHaveBeenCalledOnce();
});

it('未知路由显示中文 404 页并可返回首页', async () => {
  const request = vi.fn<EngineClient['request']>();
  await renderPage(request, '/missing');
  expect(await screen.findByRole('heading', { name: '页面不存在' })).toBeDefined();
  expect(screen.getByRole('link', { name: '返回首页' }).getAttribute('href')).toBe('/');
  expect(request).not.toHaveBeenCalled();
});

it('默认 history 把空 hash 归一为首页，并保留已有 hash 路径', () => {
  const queryClient = new QueryClient();
  clients.push(queryClient);
  const context = { queryClient, engineClient: { request: vi.fn() } };
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

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectTree } from './project-tree';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => ({ engineClient: { request } }),
  Link: ({ children, params }: { children: ReactNode; params: Record<string, string> }) => (
    <a href={Object.values(params).join('/')}>{children}</a>
  ),
}));
vi.mock('./project-dialog', () => ({ ProjectDialog: () => null }));
vi.mock('@/lib/desktop-bridge', () => ({
  getPreferences: () => Promise.resolve({ projectSort: 'updated' }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('I02 项目树读取聚合剧集，解除归属后页面仍在根目录可访问', async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const project = {
    id: 'p',
    name: '剧名',
    status: 'available',
    updatedAt: '2026-11-01',
    createdAt: '2026-11-01',
  };
  const manifest = {
    episodes: [{ id: 'e', number: 2, title: '重逢' }],
    pages: [{ id: 'page', name: '分集画布', episodeId: 'e' }],
  };
  request.mockImplementation((path: string) =>
    Promise.resolve(path === '/projects' ? [project] : manifest),
  );
  render(
    <QueryClientProvider client={cache}>
      <ProjectTree />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: '展开 剧名' }));
  fireEvent.click(await screen.findByRole('button', { name: '第 2 集 重逢' }));
  expect(screen.getByRole('link', { name: '剧本' }).getAttribute('href')).toBe('p/e');
  expect(screen.getByRole('link', { name: '分集画布' }).getAttribute('href')).toBe('p/page');
  cache.setQueryData(['projects', 'p'], {
    ...manifest,
    episodes: [],
    pages: [{ ...manifest.pages[0], episodeId: null }],
  });
  expect(await screen.findByRole('link', { name: '分集画布' })).toBeTruthy();
  await waitFor(() =>
    expect(
      within(screen.getByRole('navigation', { name: '项目树' })).queryByRole('link', {
        name: '剧本',
      }),
    ).toBeNull(),
  );
});

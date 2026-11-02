import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { emptyScriptDocument } from '@frame-loom/contracts';
import { ScriptPage } from './script-page';
const { client } = vi.hoisted(() => ({ client: { request: vi.fn() } }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useRouteContext: () => ({ engineClient: client }),
  useBlocker: vi.fn(),
}));
vi.mock('@/lib/desktop-bridge', () => ({ commandWindow: vi.fn() }));
afterEach(cleanup);
it('I02 页面工具栏精确为重新导入和保存，新草稿无脏写', async () => {
  client.request.mockImplementation((path: string) =>
    path.endsWith('/script')
      ? {
          id: 'e',
          revision: 1,
          document: emptyScriptDocument({
            name: '剧名',
            episode: { number: 1, title: '', duration_sec: 0 },
          }),
          source: null,
          conversion: null,
        }
      : { id: 'p', name: '剧名', episodes: [{ id: 'e', number: 1, title: '', duration_sec: 0 }] },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ScriptPage projectId="p" episodeId="e" />
    </QueryClientProvider>,
  );
  const toolbar = await screen.findByRole('toolbar', { name: '剧本操作' });
  expect(
    within(toolbar)
      .getAllByRole('button')
      .map((b) => b.textContent),
  ).toEqual(['重新导入', '保存']);
  expect(within(toolbar).getByRole('button', { name: '保存' }).hasAttribute('disabled')).toBe(true);
});

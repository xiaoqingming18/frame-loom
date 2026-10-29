import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EngineRequestError, type EngineClient } from '@/lib/engine-client';
import type { StoryResult } from '@frame-loom/contracts';
import { StoryTab } from './story-tab';
import { ElementDrawer } from './element-drawer';
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    params,
    search,
  }: {
    children: ReactNode;
    params: { projectId: string; episodeId: string };
    search: { block: string };
  }) => (
    <a href={`/projects/${params.projectId}/episodes/${params.episodeId}?block=${search.block}`}>
      {children}
    </a>
  ),
}));
afterEach(cleanup);
const now = new Date().toISOString();
const story: StoryResult = {
  revision: 1,
  ignored: [{ kind: 'character', name: '路人' }],
  elements: [
    {
      id: 'a',
      kind: 'character',
      name: '林夏',
      aliases: ['小林'],
      description: '',
      attrs: {},
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
      mentions: 3,
      episodes: [{ episodeId: 'e', scenes: 2 }],
    },
    {
      id: 'b',
      kind: 'character',
      name: '周屿',
      aliases: [],
      description: '',
      attrs: {},
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      mentions: 1,
      episodes: [],
    },
    {
      id: 'c',
      kind: 'location',
      name: '天台',
      aliases: [],
      description: '',
      attrs: {},
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
      mentions: 1,
      episodes: [],
    },
  ],
};
const episodes = [
  {
    id: 'e',
    number: 1,
    title: '重逢',
    createdAt: now,
    updatedAt: now,
    scenes: 7,
    chars: 500,
    draft: false,
  },
];
const provider = (children: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);
it('分类计数、别名搜索、待确认筛选与已忽略恢复', async () => {
  const request = vi
    .fn()
    .mockImplementation((path: string, _schema: unknown, init?: { method?: string }) =>
      Promise.resolve(init?.method ? { saved: true } : story),
    );
  render(
    provider(
      <StoryTab
        client={{ request } as unknown as EngineClient}
        projectId="p"
        episodes={episodes}
      />,
    ),
  );
  await screen.findByRole('heading', { name: '林夏' });
  expect(screen.getByRole('button', { name: '人物 2' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('搜索设定'), { target: { value: '小林' } });
  expect(screen.getByRole('heading', { name: '林夏' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '周屿' })).toBeNull();
  fireEvent.change(screen.getByLabelText('搜索设定'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('radio', { name: '待确认' }));
  expect(screen.getByRole('heading', { name: '周屿' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '林夏' })).toBeNull();
  fireEvent.click(screen.getByRole('radio', { name: '已忽略' }));
  fireEvent.click(screen.getByRole('button', { name: '恢复' }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('/projects/p/story/ignored/restore', expect.anything(), {
      method: 'POST',
      body: { kind: 'character', name: '路人' },
    }),
  );
});
it('批量确认两项', async () => {
  const request = vi
    .fn()
    .mockImplementation((_path: string, _schema: unknown, init?: { method?: string }) =>
      Promise.resolve(init?.method ? { saved: true } : story),
    );
  render(
    provider(
      <StoryTab
        client={{ request } as unknown as EngineClient}
        projectId="p"
        episodes={episodes}
      />,
    ),
  );
  await screen.findByRole('heading', { name: '林夏' });
  fireEvent.click(screen.getByRole('button', { name: '批量选择' }));
  fireEvent.click(screen.getByLabelText('选择 林夏'));
  fireEvent.click(screen.getByLabelText('选择 周屿'));
  fireEvent.click(screen.getByRole('button', { name: '确认 2 项' }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('/projects/p/story/batch', expect.anything(), {
      method: 'POST',
      body: { ids: ['a', 'b'], action: 'confirm' },
    }),
  );
});
it('别名只 patch aliases，冲突字段报错，出现位置跳转，合并只同类', async () => {
  const request = vi
    .fn()
    .mockResolvedValue([
      { episodeId: 'e', blockId: 'block', sceneId: 'scene', excerpt: '林夏走到天台' },
    ]);
  const mutate = vi
    .fn()
    .mockRejectedValue(new EngineRequestError(409, 'ELEMENT_NAME_CONFLICT', '别名已存在'));
  render(
    provider(
      <ElementDrawer
        client={{ request } as unknown as EngineClient}
        projectId="p"
        element={story.elements[0]}
        elements={story.elements}
        episodes={episodes}
        mutate={mutate}
        onClose={vi.fn()}
      />,
    ),
  );
  fireEvent.change(screen.getByLabelText('新增别名'), { target: { value: '夏夏' } });
  fireEvent.click(screen.getByRole('button', { name: '添加' }));
  await screen.findByText('别名已存在');
  expect(mutate).toHaveBeenCalledWith('elements/a', 'PATCH', { aliases: ['小林', '夏夏'] });
  expect((await screen.findByRole('link', { name: '林夏走到天台' })).getAttribute('href')).toBe(
    '/projects/p/episodes/e?block=block',
  );
  fireEvent.click(screen.getByRole('button', { name: '合并到…' }));
  const select = screen.getByLabelText('合并目标');
  expect(within(select).getByRole('option', { name: '周屿' })).toBeTruthy();
  expect(within(select).queryByRole('option', { name: '天台' })).toBeNull();
});

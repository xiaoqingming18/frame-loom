import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { EngineClient } from '@/lib/engine-client';
import type { ProjectProfile } from '@frame-loom/contracts';
import { ImportDialog } from './import-dialog';
afterEach(cleanup);
const profile: ProjectProfile = { form: 'short', medium: 'live', genres: ['都市'], aspect: null };
function setup(options: { complete?: boolean; hasBlocks?: boolean; flush?: boolean } = {}) {
  const request = vi
    .fn()
    .mockImplementation((path: string) =>
      Promise.resolve(path === '/models' ? [] : path === '/model-defaults' ? { chat: null } : {}),
    );
  const flush = vi.fn().mockResolvedValue(options.flush ?? true);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ImportDialog
        client={{ request } as unknown as EngineClient}
        projectId="p"
        episodeId="e"
        profile={options.complete ? profile : undefined}
        hasBlocks={options.hasBlocks ?? false}
        flush={flush}
        revision={() => 5}
        onImported={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('剧本原文'), { target: { value: '△原文' } });
  return { request, flush };
}
it('补齐三项后导入带 profile，无默认模型提示', async () => {
  const { request } = setup();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '开始转换' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: '短剧' }));
  fireEvent.click(screen.getByRole('radio', { name: '真人实拍' }));
  fireEvent.click(screen.getByRole('button', { name: '都市' }));
  expect(
    screen.getByText('未设置默认文本模型，将仅按规则识别，可在 设置 → 默认模型 中配置'),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '开始转换' }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining('/script/import'),
      expect.anything(),
      { method: 'POST', body: { revision: 5, text: '△原文', profile } },
    ),
  );
});
it('完整设定不重复提交 profile，已有段落二次确认', async () => {
  const { request } = setup({ complete: true, hasBlocks: true });
  fireEvent.click(screen.getByRole('button', { name: '开始转换' }));
  expect(screen.getByText('将替换本集全部段落，设定库元素保留')).toBeTruthy();
  expect(
    request.mock.calls.filter(([path]) => (path as string).includes('/script/import')),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '确认替换并转换' }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining('/script/import'),
      expect.anything(),
      { method: 'POST', body: { revision: 5, text: '△原文' } },
    ),
  );
});
it('flush 失败不发送导入请求', async () => {
  const { request } = setup({ complete: true, flush: false });
  fireEvent.click(screen.getByRole('button', { name: '开始转换' }));
  await screen.findByRole('alert');
  expect(
    request.mock.calls.filter(([path]) => (path as string).includes('/script/import')),
  ).toHaveLength(0);
});

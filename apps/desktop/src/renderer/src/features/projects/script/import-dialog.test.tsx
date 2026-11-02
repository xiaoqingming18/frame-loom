import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyScriptDocument } from '@frame-loom/contracts';
import type { EngineClient } from '@/lib/engine-client';
import { ImportDialog } from './import-dialog';
afterEach(cleanup);
function setup(enabled: boolean, hasScenes = false) {
  const flush = vi.fn().mockResolvedValue(true),
    close = vi.fn(),
    imported = vi.fn().mockResolvedValue(undefined);
  const submit = vi.fn<() => Promise<unknown>>().mockResolvedValue({});
  const request = vi.fn((path: string) =>
    path === '/models'
      ? Promise.resolve([{ id: 'chat', displayName: '文本模型', enabled }])
      : path === '/model-defaults'
        ? Promise.resolve({ chat: 'chat' })
        : submit(),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ImportDialog
        client={{ request } as unknown as EngineClient}
        projectId="p"
        episodeId="e"
        meta={
          emptyScriptDocument({ name: '剧名', episode: { number: 1, title: '', duration_sec: 0 } })
            .meta
        }
        hasScenes={hasScenes}
        text="原文"
        flush={flush}
        revision={() => 7}
        onImported={imported}
        onClose={close}
      />
    </QueryClientProvider>,
  );
  return { request, submit, flush, close, imported };
}
it('I03 无可用模型禁止导入，无无关设定补全要求', async () => {
  const s = setup(false);
  await screen.findByText(/请在设置中配置可用的默认文本模型/);
  expect(screen.getByRole('button', { name: '开始解析' }).hasAttribute('disabled')).toBe(true);
  expect(screen.queryByLabelText('制作媒介')).toBeNull();
  expect(s.submit).not.toHaveBeenCalled();
});
it('I04 替换需明确确认，先保存草稿；失败保留原文，重试成功关闭', async () => {
  const s = setup(true, true);
  await screen.findByText(/使用 文本模型/);
  fireEvent.change(screen.getByLabelText('剧本原文'), {
    target: { value: '完整原文，不要改写。' },
  });
  fireEvent.click(screen.getByRole('button', { name: '开始解析' }));
  expect(s.flush).not.toHaveBeenCalled();
  s.flush.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByRole('button', { name: '确认替换并解析' }));
  await screen.findByText('请先完成组字并处理草稿保存问题');
  expect(s.submit).not.toHaveBeenCalled();
  expect(screen.getByLabelText<HTMLTextAreaElement>('剧本原文').value).toBe('完整原文，不要改写。');
  s.submit.mockRejectedValueOnce(new Error('连接失败'));
  fireEvent.click(screen.getByRole('button', { name: '确认替换并解析' }));
  await screen.findByText('连接失败');
  expect(s.close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认替换并解析' }));
  await waitFor(() => expect(s.close).toHaveBeenCalledOnce());
  expect(s.request).toHaveBeenLastCalledWith(
    '/projects/p/episodes/e/script/import',
    expect.anything(),
    { method: 'POST', body: { revision: 7, text: '完整原文，不要改写。' } },
  );
});

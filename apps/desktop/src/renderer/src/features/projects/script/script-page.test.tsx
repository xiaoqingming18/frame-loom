import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ScriptResult } from '@frame-loom/contracts';
import { ScriptPage } from './script-page';

const { client } = vi.hoisted(() => ({ client: { request: vi.fn(), stream: vi.fn() } }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useRouteContext: () => ({ engineClient: client }),
  useBlocker: vi.fn(),
}));
afterEach(cleanup);
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

function setup(blockId?: string, initial: Partial<ScriptResult> = {}) {
  let record: ScriptResult = {
    format: 'frame-loom-script',
    formatVersion: 1,
    id: 'e',
    revision: 1,
    source: null,
    pendingImport: null,
    convertedAt: null,
    conversion: null,
    document: {
      schemaVersion: 2,
      preface: '',
      appendix: '',
      blocks: [{ id: 'target', type: 'action', text: '目标段落' }],
    },
    ...initial,
  };
  let emit: (() => void) | undefined;
  client.request.mockImplementation((path: string) => {
    if (path.endsWith('/script')) return record;
    if (path.endsWith('/story')) return { revision: 0, elements: [], ignored: [] };
    return { id: 'p', name: '测试项目', episodes: [{ id: 'e', number: 1, title: '' }] };
  });
  client.stream.mockImplementation(async function* (
    _path: string,
    _schema: unknown,
    { signal }: { signal: AbortSignal },
  ) {
    while (!signal.aborted) {
      await new Promise<void>((resolve) => {
        emit = resolve;
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      if (!signal.aborted)
        yield { type: 'script.conversion.updated', projectId: 'p', episodeId: 'e' };
    }
  });
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queries}>
      <ScriptPage projectId="p" episodeId="e" blockId={blockId} />
    </QueryClientProvider>,
  );
  return (next: Partial<ScriptResult>) => {
    record = { ...record, ...next };
    emit?.();
  };
}

it('从空白开始创建场标题并聚焦编辑区', async () => {
  setup(undefined, { document: { schemaVersion: 2, preface: '', appendix: '', blocks: [] } });
  fireEvent.click(await screen.findByRole('button', { name: '从空白开始写' }));
  const editor = await screen.findByRole('textbox', { name: '剧本编辑区' });
  expect(editor.querySelector('p')?.dataset.blockType).toBe('scene');
  await waitFor(() => expect(document.activeElement).toBe(editor));
});

it('外部段落定位、原文禁用与只读原文抽屉', async () => {
  const scroll = vi.fn();
  HTMLElement.prototype.scrollIntoView = scroll;
  const update = setup('target');
  await screen.findByRole('textbox', { name: '剧本编辑区' });
  await waitFor(() => expect(scroll).toHaveBeenCalled());
  expect(screen.getAllByRole<HTMLButtonElement>('button', { name: '查看原文' })[0].disabled).toBe(
    true,
  );
  update({
    revision: 2,
    source: { text: '原文第一行\n原文第二行', importedAt: new Date().toISOString() },
  });
  await waitFor(() =>
    expect(screen.getAllByRole<HTMLButtonElement>('button', { name: '查看原文' })[0].disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getAllByRole('button', { name: '查看原文' })[0]);
  expect(await screen.findByText('原文第二行')).toBeTruthy();
  expect(screen.getByText('最近一次成功转换的原文，只读。')).toBeTruthy();
});

it('事件流驱动运行锁定与成功结果刷新', async () => {
  const update = setup();
  await screen.findByRole('textbox', { name: '剧本编辑区' });
  const conversion = {
    status: 'running' as const,
    stage: 'classify' as const,
    done: 1,
    total: 2,
    warnings: [],
    error: null,
    result: null,
  };
  update({ conversion });
  await screen.findByText('识别段落类型 · 已处理 1 / 2 批');
  expect(screen.queryByRole('textbox', { name: '剧本编辑区' })).toBeNull();
  update({
    revision: 2,
    convertedAt: new Date().toISOString(),
    conversion: {
      ...conversion,
      status: 'succeeded',
      result: { scenes: 7, blocks: 60, unsure: 3, addedElements: 10 },
    },
  });
  expect(await screen.findByText('已识别 7 场、60 段，新增 10 个元素')).toBeTruthy();
  await screen.findByRole('textbox', { name: '剧本编辑区' });
});

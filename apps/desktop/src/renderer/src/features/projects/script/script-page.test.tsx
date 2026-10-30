import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ScriptResult } from '@frame-loom/contracts';
import { applyMarkdownEdit, renderScriptMarkdown } from '@frame-loom/contracts';
import { EngineRequestError } from '@/lib/engine-client';
import { ScriptPage } from './script-page';

const { client, getPreferences, setPreferences, blocker } = vi.hoisted(() => ({
  client: { request: vi.fn(), stream: vi.fn() },
  getPreferences: vi.fn(),
  setPreferences: vi.fn(),
  blocker: vi.fn(),
}));
vi.mock('@/lib/desktop-bridge', () => ({ getPreferences, setPreferences, commandWindow: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useRouteContext: () => ({ engineClient: client }),
  useBlocker: blocker,
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
HTMLElement.prototype.scrollIntoView = vi.fn();

function setup(
  blockId?: string,
  initial: Partial<ScriptResult> = {},
  view: 'styled' | 'markdown' = 'styled',
) {
  client.request.mockClear();
  setPreferences.mockClear();
  let prefs = {
    version: 1 as const,
    theme: 'system' as const,
    scriptView: view,
    scriptMentions: false,
  };
  getPreferences.mockResolvedValue(prefs);
  setPreferences.mockImplementation((patch: Partial<typeof prefs>) => {
    prefs = { ...prefs, ...patch };
    return Promise.resolve(prefs);
  });
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
  client.request.mockImplementation(
    (
      path: string,
      _schema: unknown,
      options?: { method?: string; body?: { document: ScriptResult['document'] } },
    ) => {
      if (path.endsWith('/script')) {
        if (options?.method === 'PUT') {
          record = { ...record, revision: record.revision + 1, document: options.body!.document };
          return Promise.resolve({ revision: record.revision, addedElements: 0 });
        }
        return record;
      }
      if (path.endsWith('/story')) return { revision: 0, elements: [], ignored: [] };
      return { id: 'p', name: '测试项目', episodes: [{ id: 'e', number: 1, title: '' }] };
    },
  );
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

it('Markdown 页签写偏好，连续输入一秒保存一次，切回一次撤销', async () => {
  setup();
  await screen.findByRole('textbox', { name: '剧本编辑区' });
  expect(screen.queryByRole('textbox', { name: 'Markdown 原文' })).toBeNull();
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Markdown' }), { button: 0, ctrlKey: false });
  const textarea = await screen.findByRole<HTMLTextAreaElement>('textbox', {
    name: 'Markdown 原文',
  });
  expect(setPreferences).toHaveBeenCalledWith({ scriptView: 'markdown' });
  const before = {
    schemaVersion: 2 as const,
    preface: '',
    appendix: '',
    blocks: [{ id: 'target', type: 'action' as const, text: '目标段落' }],
  };
  const markdown = renderScriptMarkdown(before).text;
  expect(textarea.value).toBe(markdown);
  client.request.mockClear();
  vi.useFakeTimers();
  fireEvent.change(textarea, { target: { value: markdown.replace('目标段落', '第一笔') } });
  await vi.advanceTimersByTimeAsync(500);
  const changed = markdown.replace('目标段落', '新文字');
  fireEvent.change(textarea, { target: { value: changed } });
  await vi.advanceTimersByTimeAsync(999);
  expect(
    client.request.mock.calls.filter(
      ([, , options]) => (options as { method?: string } | undefined)?.method === 'PUT',
    ),
  ).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  const saves = client.request.mock.calls.filter(
    ([, , options]) => (options as { method?: string } | undefined)?.method === 'PUT',
  );
  expect(saves).toHaveLength(1);
  expect((saves[0][2] as { body: { document: unknown } }).body.document).toEqual(
    applyMarkdownEdit(before, markdown, changed).document,
  );
  vi.useRealTimers();
  fireEvent.mouseDown(screen.getByRole('tab', { name: '样式' }), { button: 0, ctrlKey: false });
  const styled = await screen.findByRole('textbox', { name: '剧本编辑区' });
  expect(styled.textContent).toContain('新文字');
  expect(styled.querySelector('p')?.dataset.id).toBe('target');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '撤销' }).hasAttribute('disabled')).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: '撤销' }));
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: '剧本编辑区' }).textContent).toContain('目标段落'),
  );
});
it('偏好直接打开 Markdown，带段落定位强制样式且不改偏好', async () => {
  setup(undefined, {}, 'markdown');
  await screen.findByRole('textbox', { name: 'Markdown 原文' });
  cleanup();
  setPreferences.mockClear();
  setup('target', {}, 'markdown');
  await screen.findByRole('textbox', { name: '剧本编辑区' });
  expect(screen.queryByRole('textbox', { name: 'Markdown 原文' })).toBeNull();
  expect(setPreferences).not.toHaveBeenCalled();
});
it('Markdown 清空正文后仍可切回并一次撤销', async () => {
  setup();
  await screen.findByRole('textbox', { name: '剧本编辑区' });
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Markdown' }), { button: 0, ctrlKey: false });
  const textarea = await screen.findByRole('textbox', { name: 'Markdown 原文' });
  fireEvent.change(textarea, { target: { value: '' } });
  fireEvent.mouseDown(screen.getByRole('tab', { name: '样式' }), { button: 0, ctrlKey: false });
  await screen.findByRole('textbox', { name: '剧本编辑区' });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '撤销' }).hasAttribute('disabled')).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: '撤销' }));
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: '剧本编辑区' }).textContent).toContain('目标段落'),
  );
});
it('转换时 Markdown 只读，前言按钮定位到开头，元素标记写偏好', async () => {
  const update = setup(undefined, {
    document: {
      schemaVersion: 2,
      preface: '前言内容',
      appendix: '附录内容',
      blocks: [{ id: 'target', type: 'action', text: '动作' }],
    },
  });
  await screen.findByRole('textbox', { name: '剧本编辑区' });
  fireEvent.click(screen.getAllByRole('button', { name: '元素标记' })[0]);
  await waitFor(() =>
    expect(
      screen.getAllByRole('button', { name: '元素标记' })[0].getAttribute('aria-pressed'),
    ).toBe('true'),
  );
  expect(setPreferences).toHaveBeenCalledWith({ scriptMentions: true });
  fireEvent.click(screen.getByText('前言').closest('summary')!);
  fireEvent.click(screen.getAllByRole('button', { name: '在 Markdown 视图中编辑' })[0]);
  const textarea = await screen.findByRole<HTMLTextAreaElement>('textbox', {
    name: 'Markdown 原文',
  });
  expect(textarea.selectionStart).toBe(0);
  update({
    conversion: {
      status: 'running',
      stage: 'classify',
      done: 0,
      total: 1,
      warnings: [],
      error: null,
      result: null,
    },
  });
  await waitFor(() => expect(textarea.readOnly).toBe(true));
});
it('非法 Markdown 阻止保存和切换，离开前完成回写，409 沿用冲突界面', async () => {
  setup(undefined, {}, 'markdown');
  const textarea = await screen.findByRole<HTMLTextAreaElement>('textbox', {
    name: 'Markdown 原文',
  });
  fireEvent.change(textarea, { target: { value: Array(5001).fill('动作').join('\n') } });
  fireEvent.mouseDown(screen.getByRole('tab', { name: '样式' }), { button: 0, ctrlKey: false });
  await screen.findByRole('alert');
  expect(screen.getByRole('textbox', { name: 'Markdown 原文' })).toBeTruthy();
  expect(
    client.request.mock.calls.filter(
      ([, , options]) => (options as { method?: string } | undefined)?.method === 'PUT',
    ),
  ).toHaveLength(0);
  fireEvent.change(textarea, { target: { value: '新动作' } });
  const shouldBlock = (
    blocker.mock.lastCall![0] as {
      shouldBlockFn: (value: {
        current: { pathname: string };
        next: { pathname: string };
      }) => Promise<boolean>;
    }
  ).shouldBlockFn;
  expect(
    await shouldBlock({ current: { pathname: '/script' }, next: { pathname: '/projects' } }),
  ).toBe(false);
  client.request.mockImplementation(
    (path: string, _schema: unknown, options?: { method?: string }) => {
      if (options?.method === 'PUT')
        return Promise.reject(new EngineRequestError(409, 'SCRIPT_REVISION_CONFLICT', '外部冲突'));
      if (path.endsWith('/story')) return { revision: 0, elements: [], ignored: [] };
      return {};
    },
  );
  fireEvent.change(textarea, { target: { value: '另一次编辑' } });
  fireEvent.mouseDown(screen.getByRole('tab', { name: '样式' }), { button: 0, ctrlKey: false });
  expect(await screen.findByText('外部冲突')).toBeTruthy();
  expect(screen.getByRole('button', { name: '重新加载' })).toBeTruthy();
});

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

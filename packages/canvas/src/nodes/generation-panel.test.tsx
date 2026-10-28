import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { type CanvasMediaData } from '@frame-loom/contracts';
import type { CanvasHost } from '../host';
import { CanvasContext, useCanvasState } from '../context';
import { createBuiltinRegistry } from './builtin';
import { GenerationPanel } from './generation-panel';
import { GenerationStatus } from './generation-status';
import { writeGenerationJob } from './generation-writeback';
import { createCanvasStore } from '../store/store';
import { doc, edge, generationJob, generationModelFixture, media, sha } from '../test-utils';

function referenceSource(id: string, hash = 'a') {
  const node = media(id);
  node.data = {
    ...(node.data as CanvasMediaData),
    versions: [
      {
        sha256: sha(hash),
        mime: 'image/png',
        width: 100,
        height: 100,
        createdAt: '2026-10-25T00:00:00.000Z',
      },
    ],
  };
  return node;
}

function caretAtEnd(editor: HTMLElement) {
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

function Panel({ kind = 'image' }: { kind?: 'image' | 'video' }) {
  const data = useCanvasState((state) => state.document.nodes[1].data as CanvasMediaData);
  return (
    <>
      <GenerationPanel nodeId="target" kind={kind} data={data} />
      <GenerationStatus nodeId="target" data={data} />
    </>
  );
}

it('标签往返保存，粘贴只取纯文本，退格整块删除，撤销恢复', async () => {
  const test = setupPanel({ prompt: '参考 @{source}' });
  await act(() =>
    test.store.getState().apply((document) => ({
      ...document,
      nodes: [referenceSource('source'), document.nodes[1]],
      edges: [edge('e', 'source', 'target')],
    })),
  );
  const editor = screen.getByRole('textbox', { name: '生成提示词' });
  expect(editor.querySelector('[contenteditable="false"]')?.textContent).toBe('图1');
  expect(test.data().prompt).toBe('参考 @{source}');
  caretAtEnd(editor);
  fireEvent.paste(editor, {
    clipboardData: {
      getData: (type: string) => (type === 'text/plain' ? '<b>纯文本</b>' : '<b>富文本</b>'),
    },
  });
  expect(test.data().prompt).toBe('参考 @{source}<b>纯文本</b>');
  expect(editor.querySelector('b')).toBeNull();
  act(() => test.store.getState().undo());
  caretAtEnd(editor);
  fireEvent.keyDown(editor, { key: 'Backspace' });
  expect(test.data().prompt).toBe('参考 ');
  fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
  expect(test.data().prompt).toBe('参考 @{source}');
});

it('超长粘贴恢复原文并提示，不保存超出 schema 的提示词', () => {
  const test = setupPanel();
  const editor = screen.getByRole('textbox', { name: '生成提示词' });
  caretAtEnd(editor);
  fireEvent.paste(editor, { clipboardData: { getData: () => '字'.repeat(32001) } });
  expect(test.data().prompt).toBe('暖光');
  expect(editor.textContent).toBe('暖光');
  expect(test.store.getState().notice?.text).toContain('最多 32000 字');
});

it('普通图片输入保留文本节点、光标和选区，组字期间外部更新不重建 DOM', () => {
  const test = setupPanel();
  const editor = screen.getByRole('textbox', { name: '生成提示词' });
  editor.textContent = '暖光照在胶片上';
  caretAtEnd(editor);
  const text = editor.firstChild!;
  fireEvent.input(editor);
  expect(editor.firstChild).toBe(text);
  expect(window.getSelection()?.anchorOffset).toBe(1);
  const range = document.createRange();
  range.setStart(text, 2);
  range.setEnd(text, 4);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent.click(screen.getByRole('button', { name: '展开提示词' }));
  expect(window.getSelection()?.toString()).toBe('照在');
  fireEvent.compositionStart(editor);
  text.textContent = '暖光照在胶片上中文';
  act(() => test.store.getState().notify('其他状态更新'));
  fireEvent.input(editor);
  expect(editor.firstChild).toBe(text);
  expect(test.data().prompt).toBe('暖光照在胶片上');
  caretAtEnd(editor);
  fireEvent.compositionEnd(editor);
  expect(test.data().prompt).toBe('暖光照在胶片上中文');
  expect(editor.firstChild).toBe(text);
});

it('视频组字只在结束后同步文档，保留输入元素并支持外部撤销', () => {
  const test = setupPanel({}, 'video');
  const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '生成提示词' });
  editor.focus();
  fireEvent.compositionStart(editor);
  fireEvent.change(editor, { target: { value: '暖光zhong' } });
  expect(test.data().prompt).toBe('暖光');
  act(() => test.store.getState().notify('其他状态更新'));
  expect(editor.value).toBe('暖光zhong');
  fireEvent.change(editor, { target: { value: '暖光中文' } });
  fireEvent.compositionEnd(editor);
  expect(test.data().prompt).toBe('暖光中文');
  expect(screen.getByRole('textbox')).toBe(editor);
  expect(document.activeElement).toBe(editor);
  act(() => test.store.getState().undo());
  expect(editor.value).toBe('暖光');
});

it('组字不触发菜单或撤销，完成后普通 @ 可用键盘选入', async () => {
  const test = setupPanel();
  await act(() =>
    test.store.getState().apply((document) => ({
      ...document,
      nodes: [referenceSource('source'), document.nodes[1]],
    })),
  );
  const editor = screen.getByRole('textbox', { name: '生成提示词' });
  fireEvent.compositionStart(editor);
  editor.textContent = '暖光@';
  caretAtEnd(editor);
  fireEvent.input(editor);
  fireEvent.keyDown(editor, { key: 'z', ctrlKey: true, isComposing: true });
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(test.data().prompt).toBe('暖光');
  fireEvent.compositionEnd(editor);
  expect(test.data().prompt).toBe('暖光@');
  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.input(editor);
  expect(screen.getByRole('listbox')).toBeDefined();
  fireEvent.keyDown(editor, { key: 'ArrowDown' });
  fireEvent.keyDown(editor, { key: 'Enter' });
  expect(test.data().prompt).toBe('暖光@{source}');
  expect(test.store.getState().document.edges).toHaveLength(1);
  act(() => test.store.getState().undo());
  expect(test.store.getState().document.edges).toHaveLength(0);
  expect(test.data().prompt).toBe('暖光@');
});

it('候选分组并提示模型上限和成环原因', async () => {
  const test = setupPanel();
  await act(() =>
    test.store.getState().apply((document) => ({
      ...document,
      nodes: [referenceSource('source'), document.nodes[1], referenceSource('other')],
      edges: [edge('e', 'source', 'target')],
    })),
  );
  fireEvent.click(screen.getByRole('button', { name: '添加参考' }));
  expect(screen.getByRole('group', { name: '已连入参考' })).toBeDefined();
  expect(screen.getByRole<HTMLButtonElement>('option', { name: /other/ }).disabled).toBe(true);
  expect(screen.getByText('当前模型最多 1 张参考')).toBeDefined();
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
  await act(() =>
    test.store
      .getState()
      .apply((document) => ({ ...document, edges: [edge('reverse', 'target', 'other')] })),
  );
  fireEvent.click(screen.getByRole('button', { name: '添加参考' }));
  expect(screen.getByText('连线会形成循环依赖')).toBeDefined();
});

it('端口不兼容的图片候选置灰并显示原因', async () => {
  const test = setupPanel();
  await act(() =>
    test.store.getState().apply((document) => ({
      ...document,
      nodes: [referenceSource('source'), document.nodes[1]],
    })),
  );
  vi.spyOn(test.registry, 'inputs').mockReturnValue([
    { id: 'reference', label: '参考图', accepts: ['video'], max: 16 },
  ]);
  fireEvent.click(screen.getByRole('button', { name: '添加参考' }));
  expect(screen.getByRole<HTMLButtonElement>('option', { name: /source/ }).disabled).toBe(true);
  expect(screen.getByText('「参考图」不接受图片')).toBeDefined();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const secondModelId = '44444444-4444-4444-8444-444444444444';
function setupPanel(data: Partial<CanvasMediaData> = {}, kind: 'image' | 'video' = 'image') {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const target = media('target', kind);
  target.data = { ...(target.data as CanvasMediaData), prompt: '暖光', ...data };
  const store = createCanvasStore(doc([media('source'), target]));
  const model = generationModelFixture(kind === 'video' ? 'ark-seedance' : 'openai-images');
  if (model.capability.kind === 'image') {
    model.capability.references.max = 1;
    model.capability.count.max = 5;
  }
  model.label = kind === 'video' ? '视频模型' : '图片模型';
  const config = { storageReady: true, models: [model] };
  store.getState().setGenerationConfig(config);
  const api = {
    load: vi.fn(),
    create: vi.fn<NonNullable<CanvasHost['generation']>['create']>(),
    get: vi.fn(),
    cancel: vi.fn(),
    resubmit: vi.fn(),
    subscribe: vi.fn(),
  };
  const registry = createBuiltinRegistry();
  registry.setGenerationModels(config.models);
  const upload = vi.fn<CanvasHost['media']['upload']>();
  render(
    <CanvasContext.Provider
      value={{ store, registry, host: { media: { upload, url: (id) => id }, generation: api } }}
    >
      <Panel kind={kind} />
    </CanvasContext.Provider>,
  );
  return {
    store,
    api,
    registry,
    model,
    config,
    upload,
    data: () => store.getState().document.nodes[1].data as CanvasMediaData,
  };
}

it('排序后的 role 与 order 一致，引用只转哈希而不改写编号', async () => {
  const test = setupPanel({ prompt: '参考 @{source}' });
  const model = structuredClone(test.model);
  if (model.capability.kind !== 'image') throw new Error('图片夹具无效');
  model.capability.references.max = 2;
  act(() => {
    test.store.getState().setGenerationConfig({ ...test.config, models: [model] });
    test.store.getState().apply((document) => ({
      ...document,
      nodes: [referenceSource('source'), document.nodes[1], referenceSource('other', 'b')],
      edges: [edge('e1', 'source', 'target'), edge('e2', 'other', 'target')],
    }));
  });
  fireEvent.keyDown(screen.getByRole('button', { name: '参考 1，Alt 加方向键排序' }), {
    key: 'ArrowRight',
    altKey: true,
  });
  test.api.create.mockResolvedValue(generationJob({ status: 'pending', outputs: [] }));
  fireEvent.click(screen.getByRole('button', { name: '生成图片' }));
  await waitFor(() => expect(test.api.create).toHaveBeenCalledOnce());
  expect(test.api.create.mock.calls[0][0]).toMatchObject({
    prompt: `参考 @{${sha('a')}}`,
    inputs: [
      { role: 'reference', kind: 'image', sha256: sha('b'), order: 0 },
      { role: 'reference', sha256: sha('a'), order: 1 },
    ],
    extras: {},
  });
  expect(test.data().prompt).toBe('参考 @{source}');
});

it('附加参数按声明控件提交，数量由能力卡决定并拆成独立任务', async () => {
  const test = setupPanel({ count: 5 });
  const model = {
    ...test.model,
    extras: [
      {
        key: 'style',
        label: '风格',
        type: 'enum' as const,
        values: ['film', 'plain'],
        default: 'film',
        path: 'style',
      },
    ],
  };
  act(() => test.store.getState().setGenerationConfig({ ...test.config, models: [model] }));
  fireEvent.click(screen.getByRole('button', { name: '生成数量' }));
  expect(screen.getByRole('button', { name: '×5' })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '生成参数' }));
  fireEvent.change(screen.getByLabelText('风格'), { target: { value: 'plain' } });
  expect(test.data().extras).toEqual({ style: 'plain' });
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
  ids.forEach((id) =>
    test.api.create.mockResolvedValueOnce(generationJob({ id, status: 'pending', outputs: [] })),
  );
  fireEvent.click(screen.getByRole('button', { name: '生成图片' }));
  await waitFor(() => expect(test.data().pendingJobIds).toEqual(ids));
  expect(test.api.create).toHaveBeenCalledTimes(5);
  expect(test.api.create.mock.calls[0][0].extras).toEqual({ style: 'plain' });
  expect(test.api.create.mock.calls[0][0].params).not.toHaveProperty('count');
});

it.each(['storage', 'count', 'empty', 'media', 'params'] as const)(
  '共享校验阻止 %s，移除错误后可以生成',
  async (reason) => {
    const test = setupPanel();
    const model = structuredClone(test.model);
    if (model.capability.kind !== 'image') throw new Error('图片夹具无效');
    if (reason === 'storage') model.transport.image = 'url';
    if (reason === 'count') model.capability.references.max = 0;
    if (reason === 'media') model.capability.references.maxBytes = 1;
    act(() => {
      test.store.getState().setGenerationConfig({ storageReady: false, models: [model] });
      test.store.getState().apply((document) => ({
        ...document,
        nodes: [
          reason === 'empty' ? media('source') : referenceSource('source'),
          {
            ...document.nodes[1],
            data: {
              ...test.data(),
              ...(reason === 'params' ? { params: { quality: 'invented' } } : {}),
            },
          },
        ],
        edges: [edge('e', 'source', 'target')],
      }));
      if (reason === 'media')
        test.store.getState().apply((document) => ({
          ...document,
          nodes: document.nodes.map((node) =>
            node.id === 'source'
              ? {
                  ...node,
                  data: {
                    ...(node.data as CanvasMediaData),
                    versions: [{ ...generationJob().outputs[0], bytes: 2 }],
                  },
                }
              : node,
          ),
        }));
    });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '生成图片' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '生成图片' }));
    expect(test.api.create).not.toHaveBeenCalled();
    await act(() =>
      test.store.getState().apply((document) => ({
        ...document,
        edges: [],
        nodes: document.nodes.map((node) =>
          node.id === 'target' ? { ...node, data: { ...test.data(), params: {} } } : node,
        ),
      })),
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '生成图片' }).disabled).toBe(
      false,
    );
  },
);

it('模型切换保留兼容值，将不兼容值挂起并过滤 extras', () => {
  const test = setupPanel({
    params: { quality: 'high', aspectRatio: '1:1' },
    extras: { keep: true, drop: true },
  });
  const model = structuredClone(test.model);
  model.id = secondModelId;
  model.label = '新模型';
  if (model.capability.kind !== 'image') throw new Error('图片夹具无效');
  model.capability.quality = { values: ['low'], default: 'low' };
  model.extras = [{ key: 'keep', label: '保留', type: 'boolean', path: 'keep' }];
  act(() =>
    test.store.getState().setGenerationConfig({ ...test.config, models: [test.model, model] }),
  );
  fireEvent.click(screen.getByRole('button', { name: '生成模型' }));
  fireEvent.click(screen.getByRole('button', { name: /新模型/ }));
  expect(test.data().params?.aspectRatio).toBe('1:1');
  expect(test.data().pendingParams).toEqual({ quality: 'high' });
  expect(test.data().extras).toEqual({ keep: true });
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '生成图片' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '生成参数' }));
  fireEvent.click(screen.getByRole('button', { name: '清除待处理参数' }));
  expect(test.data().pendingParams).toEqual({});
});

it('文生没有素材栏，首尾帧有两个素材槽位且保持组字', () => {
  setupPanel({ mode: 'first_last' }, 'video');
  expect(screen.getByRole('button', { name: '添加首帧' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '添加尾帧' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '生成参数' }).textContent).toBe('比例 · 时长');
});

it('成功任务写回版本，失败单张重试只替换对应任务', async () => {
  const failed = generationJob({ status: 'failed', outputs: [], errorMessage: '失败' });
  const test = setupPanel({ pendingJobIds: [failed.id] });
  act(() => test.store.getState().setGenerationJob(failed));
  const next = generationJob({ id: crypto.randomUUID(), status: 'pending', outputs: [] });
  test.api.resubmit.mockResolvedValueOnce(next);
  fireEvent.click(screen.getByRole('button', { name: '重试任务 1' }));
  await waitFor(() => expect(test.data().pendingJobIds).toEqual([next.id]));
  act(() =>
    test.store.getState().applySystem((document) =>
      writeGenerationJob(document, {
        ...next,
        status: 'succeeded',
        outputs: generationJob().outputs,
      }),
    ),
  );
  expect(test.data().pendingJobIds).toEqual([]);
  expect(test.data().versions[0].jobId).toBe(next.id);
});

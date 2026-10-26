import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GenerationJob, ModelProfile, type CanvasMediaData } from '@frame-loom/contracts';
import type { CanvasHost } from '../host';
import { CanvasContext, useCanvasState } from '../context';
import { createBuiltinRegistry } from './builtin';
import { GenerationPanel } from './generation-panel';
import { GenerationStatus } from './generation-status';
import { createCanvasStore } from '../store/store';
import { doc, edge, generationJob, media, sha } from '../test-utils';
import { writeGenerationJob } from './generation-writeback';
import { deleteElements } from '../commands/commands';

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

function Panel() {
  const data = useCanvasState((state) => state.document.nodes[1].data as CanvasMediaData);
  return (
    <>
      <GenerationPanel nodeId="target" kind="image" data={data} />
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

it('替换后超出字数上限时禁止发送', async () => {
  const test = setupPanel({ prompt: 'x'.repeat(31996) + '@{a}' });
  await act(() =>
    test.store.getState().apply((document) => ({
      ...document,
      nodes: [referenceSource('a'), document.nodes[1]],
      edges: [edge('e', 'a', 'target')],
    })),
  );
  expect(screen.getByText('替换后的提示词最多 32000 字')).toBeDefined();
  expect(screen.getByLabelText('提示词字数').textContent).toBe('32003 字');
  fireEvent.click(screen.getByRole('button', { name: '生成图片' }));
  expect(test.api.create).not.toHaveBeenCalled();
});

it.each([
  ['参考 @{source}', '参考 图2'],
  ['Use @{source}', 'Use Image 2'],
])('排序后标签与实际请求编号一致：%s', async (prompt, expected) => {
  const test = setupPanel({ prompt });
  act(() => {
    test.store.getState().setGenerationConfig({
      storageReady: true,
      models: [
        {
          id: modelId,
          label: '图片模型',
          kind: 'image',
          profile: { ...profile, inputs: [{ ...profile.inputs[0], maxCount: 2 }] },
        },
      ],
    });
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
  expect(test.data().inputOrder).toEqual(['e2', 'e1']);
  expect(screen.getByRole('textbox').querySelector('[data-reference]')?.textContent).toBe('图2');
  expect(screen.getByLabelText('提示词字数').textContent).toBe(`${expected.length} 字`);
  test.api.create.mockResolvedValue(generationJob({ status: 'pending' }));
  fireEvent.click(screen.getByRole('button', { name: '生成图片' }));
  await waitFor(() => expect(test.api.create).toHaveBeenCalled());
  expect(test.api.create.mock.calls[0][0]).toMatchObject({
    prompt: expected,
    inputs: [{ sha256: sha('b') }, { sha256: sha('a') }],
  });
  expect(test.data().prompt).toBe(prompt);
});

it('拖动排序后断开连线，标签失效并阻止提交', async () => {
  const test = setupPanel({ prompt: '参考 @{source}' });
  await act(() =>
    test.store.getState().apply((document) => ({
      ...document,
      nodes: [referenceSource('source'), document.nodes[1], referenceSource('other', 'b')],
      edges: [edge('e1', 'source', 'target'), edge('e2', 'other', 'target')],
    })),
  );
  const dataTransfer = { setData: vi.fn() };
  fireEvent.dragStart(screen.getByRole('button', { name: '参考 1，Alt 加方向键排序' }), {
    dataTransfer,
  });
  fireEvent.drop(screen.getByRole('button', { name: '参考 2，Alt 加方向键排序' }), {
    dataTransfer,
  });
  expect(test.data().inputOrder).toEqual(['e2', 'e1']);
  await act(() =>
    test.store.getState().apply((document) => deleteElements(document, new Set(), new Set(['e1']))),
  );
  expect(screen.getByText('失效参考')).toBeDefined();
  expect(screen.getByText('引用的参考已断开')).toBeDefined();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '生成图片' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '生成图片' }));
  expect(test.api.create).not.toHaveBeenCalled();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const modelId = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';
const date = '2026-10-25T00:00:00.000Z';
const profile = ModelProfile.parse({
  id: 'openai-images-default',
  name: '图片生成',
  kind: 'image',
  protocol: 'openai-images',
  matchIds: ['image-model'],
  generic: false,
  modes: [
    { id: 'text', name: '文生图' },
    { id: 'reference', name: '参考图' },
  ],
  params: [],
  constraints: [],
  inputs: [
    {
      kind: 'image',
      maxCount: 1,
      maxBytes: 1_000_000,
      mimeTypes: ['image/png'],
      transport: 'inline',
    },
  ],
  runtime: {
    concurrency: 1,
    pollInitialMs: 1000,
    pollMaxMs: 5000,
    timeoutMs: 10_000,
    submitTimeoutMs: 1000,
    supportsCancel: false,
  },
});

function setupPanel(data: Partial<CanvasMediaData> = {}) {
  const target = media('target');
  target.data = { ...(target.data as CanvasMediaData), prompt: '暖光', ...data };
  const store = createCanvasStore(doc([media('source'), target]));
  store.getState().setGenerationConfig({
    storageReady: true,
    models: [{ id: modelId, label: '图片模型', kind: 'image', profile }],
  });
  const api = {
    load: vi.fn(),
    create: vi.fn<NonNullable<CanvasHost['generation']>['create']>(),
    get: vi.fn(),
    cancel: vi.fn(),
    resubmit: vi.fn(),
    subscribe: vi.fn(),
  };
  const registry = createBuiltinRegistry();
  render(
    <CanvasContext.Provider
      value={{
        store,
        registry,
        host: { media: { upload: vi.fn(), url: (id) => id }, generation: api },
      }}
    >
      <Panel />
    </CanvasContext.Provider>,
  );
  return {
    store,
    api,
    registry,
    data: () => store.getState().document.nodes[1].data as CanvasMediaData,
  };
}

it('按数量连续创建任务，重复点击不会重复提交，部分创建失败保留已创建项', async () => {
  const test = setupPanel({ count: 3 });
  const first = generationJob({ status: 'pending' });
  const second = generationJob({ id: jobId, status: 'pending' });
  test.api.create
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second)
    .mockRejectedValueOnce(new Error('第三张创建失败'));
  const button = screen.getByRole('button', { name: '生成图片' });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(test.store.getState().notice?.text).toBe('第三张创建失败'));
  expect(test.api.create).toHaveBeenCalledTimes(3);
  expect(test.api.create.mock.calls[0][0].params).not.toHaveProperty('count');
  expect(test.data().pendingJobIds).toEqual([first.id, second.id]);
  expect(test.store.getState().generationSubmitting.size).toBe(0);
});

it('数量三张创建三个独立任务', async () => {
  const test = setupPanel({ count: 3 });
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  for (const id of ids)
    test.api.create.mockResolvedValueOnce(generationJob({ id, status: 'pending' }));
  fireEvent.click(screen.getByRole('button', { name: '生成图片' }));
  await waitFor(() => expect(test.data().pendingJobIds).toEqual(ids));
  expect(test.api.create).toHaveBeenCalledTimes(3);
});

it('数量弹层写入节点，参数按档案隐藏整组、置灰取值，显示摘要、角标和预计像素', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const test = setupPanel();
  act(() =>
    test.store.getState().setGenerationConfig({
      storageReady: true,
      models: [
        {
          id: modelId,
          label: '图片模型',
          kind: 'image',
          profile: {
            ...profile,
            params: [
              {
                key: 'aspectRatio',
                name: '比例',
                type: 'enum',
                values: ['1:1', '3:2', '2:3'],
                default: '1:1',
                mapped: true,
              },
              {
                key: 'quality',
                name: '画质',
                type: 'enum',
                values: ['low', 'medium', 'high'],
                default: 'medium',
                mapped: true,
                notes: { high: '预览' },
              },
              {
                key: 'background',
                name: '背景',
                type: 'enum',
                values: ['auto', 'opaque'],
                default: 'auto',
                mapped: true,
              },
            ],
          },
        },
      ],
    }),
  );
  expect(screen.getByRole('button', { name: '生成参数' }).textContent).toContain(
    '1:1 · 中 · 自适应',
  );
  fireEvent.click(screen.getByRole('button', { name: '生成数量' }));
  fireEvent.click(screen.getByRole('button', { name: '×4' }));
  expect(test.data().count).toBe(4);
  fireEvent.click(screen.getByRole('button', { name: '生成参数' }));
  expect(screen.queryByRole('group', { name: '清晰度' })).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>('radio', { name: '比例 16:9' }).disabled).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>('radio', { name: '背景 透明' }).disabled).toBe(true);
  expect(screen.getByLabelText('预计像素').textContent).toBe('≈ 1024×1024');
  expect(screen.getByText('预览')).toBeDefined();
  fireEvent.click(screen.getByRole('radio', { name: '比例 3:2' }));
  expect(test.data().params?.aspectRatio).toBe('3:2');
  expect(screen.getByLabelText('预计像素').textContent).toBe('≈ 1536×1024');
  fireEvent.keyDown(screen.getByRole('slider', { name: '画质' }), { key: 'End' });
  expect(test.data().params?.quality).toBe('high');
});

it('提示词为空时发送按钮提供可读禁用原因，展开和字数同步', () => {
  const test = setupPanel({ prompt: '' });
  const send = screen.getByRole<HTMLButtonElement>('button', { name: '生成图片' });
  expect(send.disabled).toBe(true);
  expect(document.getElementById(send.getAttribute('aria-describedby')!)?.textContent).toBe(
    '请填写提示词',
  );
  fireEvent.click(screen.getByRole('button', { name: '展开提示词' }));
  expect(screen.getByRole('button', { name: '收起提示词' }).getAttribute('aria-expanded')).toBe(
    'true',
  );
  const editor = screen.getByRole('textbox', { name: '生成提示词' });
  editor.textContent = '暖光';
  fireEvent.input(editor);
  expect(test.data().prompt).toBe('暖光');
  expect(screen.getByLabelText('提示词字数').textContent).toBe('2 字');
  expect(send.disabled).toBe(false);
});

it('Gemini 清晰度分段禁用未声明的档位，不出现画质背景与虚构像素', () => {
  const test = setupPanel();
  act(() =>
    test.store.getState().setGenerationConfig({
      storageReady: true,
      models: [
        {
          id: modelId,
          label: 'Gemini',
          kind: 'image',
          profile: {
            ...profile,
            protocol: 'gemini-image',
            params: [
              {
                key: 'aspectRatio',
                name: '比例',
                type: 'enum',
                values: ['1:1', '16:9'],
                default: '1:1',
                mapped: true,
              },
              {
                key: 'resolution',
                name: '清晰度',
                type: 'enum',
                values: ['2K', '4K'],
                default: '2K',
                mapped: true,
                notes: { '4K': '实验' },
              },
            ],
          },
        },
      ],
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: '生成参数' }));
  expect(screen.getByRole<HTMLButtonElement>('radio', { name: '清晰度 1K' }).disabled).toBe(true);
  expect(screen.queryByRole('group', { name: '画质' })).toBeNull();
  expect(screen.queryByRole('group', { name: '背景' })).toBeNull();
  expect(screen.queryByLabelText('预计像素')).toBeNull();
  expect(screen.getByText('实验')).toBeDefined();
  fireEvent.click(screen.getByRole('radio', { name: '清晰度 4K' }));
  expect(test.data().params?.resolution).toBe('4K');
});

it('失败单张重试只替换对应 id，同步历史；重试失败保留引用，放弃后可再次生成', async () => {
  const failed = generationJob({ status: 'failed', errorMessage: '供应商失败' });
  const pending = generationJob({ id: jobId, status: 'running' });
  const test = setupPanel({ pendingJobIds: [failed.id, pending.id] });
  act(() => {
    test.store.getState().setGenerationJob(failed);
    test.store.getState().setGenerationJob(pending);
  });
  test.api.resubmit.mockRejectedValueOnce(new Error('重试失败'));
  fireEvent.click(screen.getByRole('button', { name: '重试任务 1' }));
  await waitFor(() => expect(test.store.getState().notice?.text).toBe('重试失败'));
  expect(test.data().pendingJobIds).toEqual([failed.id, pending.id]);
  const next = generationJob({ id: crypto.randomUUID(), status: 'pending' });
  test.api.resubmit.mockResolvedValueOnce(next);
  await act(() =>
    test.store.getState().apply((document) => ({
      ...document,
      nodes: document.nodes.map((node) => ({ ...node, title: '新标题' })),
    })),
  );
  fireEvent.click(screen.getByRole('button', { name: '重试任务 1' }));
  await waitFor(() => expect(test.data().pendingJobIds).toEqual([next.id, pending.id]));
  expect(test.api.resubmit).toHaveBeenLastCalledWith(failed.id);
  expect(test.api.create).not.toHaveBeenCalled();
  expect((test.store.getState().past[0].nodes[1].data as CanvasMediaData).pendingJobIds).toEqual([
    next.id,
    pending.id,
  ]);
  act(() => test.store.getState().setGenerationJob({ ...next, status: 'failed' }));
  test.api.cancel.mockResolvedValueOnce({ ...next, status: 'failed' });
  fireEvent.click(screen.getAllByRole('button', { name: '放弃任务' })[0]);
  await waitFor(() => expect(test.data().pendingJobIds).toEqual([pending.id]));
});

it.each([true, false])('切换模型按目标档案是否支持 21:9（%s）保留或回退并提示', (supported) => {
  const test = setupPanel({ params: { aspectRatio: '21:9' } });
  const aspect = (values: string[]) => ({
    key: 'aspectRatio',
    name: '比例',
    type: 'enum' as const,
    values,
    default: '1:1',
    mapped: false,
  });
  const gemini = crypto.randomUUID();
  act(() =>
    test.store.getState().setGenerationConfig({
      storageReady: true,
      models: [
        {
          id: modelId,
          label: 'GPT',
          kind: 'image',
          profile: { ...profile, params: [aspect(['1:1', '21:9', '16:9'])] },
        },
        {
          id: gemini,
          label: 'Gemini 2.5',
          kind: 'image',
          profile: {
            ...profile,
            protocol: 'gemini-image',
            params: [aspect(supported ? ['1:1', '16:9', '21:9'] : ['1:1', '16:9'])],
          },
        },
      ],
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: '生成模型' }));
  fireEvent.click(screen.getByRole('button', { name: /Gemini 2.5/ }));
  expect(test.data().params).toEqual({ aspectRatio: supported ? '21:9' : '16:9' });
  if (supported) expect(test.store.getState().notice).toBeNull();
  else expect(test.store.getState().notice?.text).toContain('21:9 → 16:9');
});

it('提交连线参考并将成功任务写回为新版本', async () => {
  const source = media('source');
  source.data = {
    ...(source.data as CanvasMediaData),
    versions: [{ sha256: sha('a'), mime: 'image/png', width: 100, height: 100, createdAt: date }],
  };
  const target = media('target');
  target.data = { ...(target.data as CanvasMediaData), prompt: '胶片上的暖光' };
  const store = createCanvasStore(doc([source, target], [edge('edge', 'source', 'target')]));
  store.getState().setGenerationConfig({
    storageReady: false,
    models: [{ id: modelId, label: '图片模型', kind: 'image', profile }],
  });
  const pending = GenerationJob.parse({
    id: jobId,
    kind: 'image',
    channelModelId: modelId,
    profileId: profile.id,
    status: 'pending',
    request: {
      modelId,
      mode: 'reference',
      prompt: '胶片上的暖光',
      params: {},
      inputs: [{ kind: 'image', role: 'reference', sha256: sha('a') }],
      source: 'canvas',
    },
    remoteTaskId: null,
    remoteStatus: null,
    attempts: 0,
    nextPollAt: null,
    errorCategory: null,
    errorCode: null,
    errorMessage: null,
    outputs: [],
    createdAt: date,
    updatedAt: date,
    finishedAt: null,
  });
  const create = vi
    .fn<NonNullable<CanvasHost['generation']>['create']>()
    .mockResolvedValue(pending);
  const host: CanvasHost = {
    media: { upload: vi.fn(), url: (hash) => hash },
    generation: {
      load: vi.fn(),
      create,
      get: vi.fn(),
      cancel: vi.fn(),
      resubmit: vi.fn(),
      subscribe: vi.fn(),
    },
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <CanvasContext.Provider value={{ store, registry: createBuiltinRegistry(), host }}>
      {children}
    </CanvasContext.Provider>
  );
  render(<Panel />, {
    wrapper,
  });

  fireEvent.click(screen.getByRole('button', { name: '生成图片' }));
  await waitFor(() => expect(create).toHaveBeenCalledWith(pending.request));
  expect((store.getState().document.nodes[1].data as CanvasMediaData).pendingJobIds).toEqual([
    jobId,
  ]);

  const completed = GenerationJob.parse({
    ...pending,
    status: 'succeeded',
    outputs: [
      {
        sha256: sha('b'),
        mime: 'image/png',
        bytes: 100,
        width: 200,
        height: 100,
        durationMs: null,
        createdAt: date,
      },
    ],
    finishedAt: date,
  });
  act(() => store.getState().applySystem((document) => writeGenerationJob(document, completed)));
  const data = store.getState().document.nodes[1].data as CanvasMediaData;
  expect(data.pendingJobIds).toEqual([]);
  expect(data.versions).toHaveLength(1);
  expect(data.versions[0]).toMatchObject({ sha256: sha('b'), jobId });
});

it.each(['storage', 'count', 'empty'] as const)(
  '第三层校验阻止 %s 参考输入，移除连线后可恢复生成',
  async (reason) => {
    const source = media('source');
    source.data = {
      ...(source.data as CanvasMediaData),
      versions:
        reason === 'empty'
          ? []
          : [{ sha256: sha('a'), mime: 'image/png', width: 100, height: 100, createdAt: date }],
    };
    const target = media('target');
    target.data = { ...(target.data as CanvasMediaData), prompt: '胶片上的暖光' };
    const store = createCanvasStore(doc([source, target], [edge('edge', 'source', 'target')]));
    store.getState().setGenerationConfig({
      storageReady: false,
      models: [
        {
          id: modelId,
          label: '图片模型',
          kind: 'image',
          profile: {
            ...profile,
            inputs: [
              {
                ...profile.inputs[0],
                transport: reason === 'storage' ? 'url' : 'inline',
                maxCount: reason === 'count' ? 0 : 1,
              },
            ],
          },
        },
      ],
    });
    const create = vi.fn();
    const host: CanvasHost = {
      media: { upload: vi.fn(), url: (hash) => hash },
      generation: {
        load: vi.fn(),
        create,
        get: vi.fn(),
        cancel: vi.fn(),
        resubmit: vi.fn(),
        subscribe: vi.fn(),
      },
    };
    render(
      <CanvasContext.Provider value={{ store, registry: createBuiltinRegistry(), host }}>
        <Panel />
      </CanvasContext.Provider>,
    );
    const button = screen.getByRole<HTMLButtonElement>('button', { name: '生成图片' });
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(create).not.toHaveBeenCalled();
    await act(() => store.getState().apply((document) => ({ ...document, edges: [] })));
    await waitFor(() => expect(button.disabled).toBe(false));
  },
);

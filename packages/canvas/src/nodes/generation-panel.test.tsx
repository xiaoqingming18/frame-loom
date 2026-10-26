import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GenerationJob, ModelProfile, type CanvasMediaData } from '@frame-loom/contracts';
import type { CanvasHost } from '../host';
import { CanvasContext, useCanvasState } from '../context';
import { createBuiltinRegistry } from './builtin';
import { GenerationPanel } from './generation-panel';
import { createCanvasStore } from '../store/store';
import { doc, edge, generationJob, media, sha } from '../test-utils';
import { writeGenerationJob } from './generation-writeback';

function Panel() {
  const data = useCanvasState((state) => state.document.nodes[1].data as CanvasMediaData);
  return <GenerationPanel nodeId="target" kind="image" data={data} />;
}

afterEach(cleanup);

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
  render(
    <CanvasContext.Provider
      value={{
        store,
        registry: createBuiltinRegistry(),
        host: { media: { upload: vi.fn(), url: (id) => id }, generation: api },
      }}
    >
      <Panel />
    </CanvasContext.Provider>,
  );
  return { store, api, data: () => store.getState().document.nodes[1].data as CanvasMediaData };
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
  fireEvent.change(screen.getByLabelText('生成模型'), { target: { value: gemini } });
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

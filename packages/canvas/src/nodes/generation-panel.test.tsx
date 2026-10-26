import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GenerationJob, ModelProfile, type CanvasMediaData } from '@frame-loom/contracts';
import type { CanvasHost } from '../host';
import { CanvasContext, useCanvasState } from '../context';
import { createBuiltinRegistry } from './builtin';
import { GenerationPanel } from './generation-panel';
import { createCanvasStore } from '../store/store';
import { doc, edge, media, sha } from '../test-utils';
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
  expect((store.getState().document.nodes[1].data as CanvasMediaData).pendingJobId).toBe(jobId);

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
  expect(data.pendingJobId).toBeUndefined();
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
      generation: { load: vi.fn(), create, get: vi.fn(), cancel: vi.fn(), subscribe: vi.fn() },
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

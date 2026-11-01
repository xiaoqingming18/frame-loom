import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CanvasMediaData } from '@frame-loom/contracts';
import type { CanvasHost } from '../host';
import { CanvasContext } from '../context';
import { createCanvasStore } from '../store/store';
import { doc, generationJob, media } from '../test-utils';
import { createBuiltinRegistry } from './builtin';
import { GenerationStatus } from './generation-status';

vi.mock('./generation-animation', () => ({ GenerationAnimation: () => null }));

afterEach(cleanup);
it.each([
  ['paused', 'none', null],
  ['submit_unknown', 'idempotent_submit', '同键恢复提交 1'],
  ['download_failed', 'download', '重试下载 1'],
  ['paused', 'query', '恢复查询 1'],
] as const)('%s 根据 engine 的 %s 动作恢复原任务', async (status, recoveryAction, label) => {
  const job = generationJob({ status, recoveryAction, outputs: [] });
  const node = media('one');
  const data = { ...(node.data as CanvasMediaData), pendingJobIds: [job.id] };
  node.data = data;
  const store = createCanvasStore(doc([node]));
  store.getState().setGenerationJob(job);
  const resubmit = vi.fn().mockResolvedValue({ ...job, status: 'pending', recoveryAction: 'none' });
  const create = vi.fn();
  const host: CanvasHost = {
    media: { upload: vi.fn(), url: (hash) => hash },
    generation: {
      load: vi.fn(),
      create,
      get: vi.fn(),
      cancel: vi.fn(),
      resubmit,
      subscribe: vi.fn(),
    },
  };
  render(
    <CanvasContext.Provider value={{ store, registry: createBuiltinRegistry(), host }}>
      <GenerationStatus nodeId="one" data={data} />
    </CanvasContext.Provider>,
  );
  expect(screen.queryByText(/生成中/)).toBeNull();
  if (!label) {
    expect(screen.getByText(/当前无法安全恢复/)).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  } else {
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(resubmit).toHaveBeenCalledWith(job.id));
    expect((store.getState().document.nodes[0].data as CanvasMediaData).pendingJobIds).toEqual([
      job.id,
    ]);
    expect(create).not.toHaveBeenCalled();
  }
});

it('远端取消未确认时保留原任务，不调用本地放弃或重新生成', async () => {
  const job = generationJob({ status: 'running', canCancelRemote: true, outputs: [] });
  const node = media('one', 'video');
  const data = { ...(node.data as CanvasMediaData), pendingJobIds: [job.id] };
  node.data = data;
  const store = createCanvasStore(doc([node]));
  store.getState().setGenerationJob(job);
  const cancelRemote = vi.fn().mockResolvedValue({
    ...job,
    status: 'paused',
    canCancelRemote: false,
    cancellation: 'unknown',
    errorMessage: '远端取消结果不明',
  });
  const cancel = vi.fn();
  const create = vi.fn();
  const host: CanvasHost = {
    media: { upload: vi.fn(), url: (hash) => hash },
    generation: {
      load: vi.fn(),
      get: vi.fn(),
      resubmit: vi.fn(),
      subscribe: vi.fn(),
      create,
      cancel,
      cancelRemote,
    },
  };
  render(
    <CanvasContext.Provider value={{ store, registry: createBuiltinRegistry(), host }}>
      <GenerationStatus nodeId="one" data={data} />
    </CanvasContext.Provider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '请求远端取消' }));
  await waitFor(() =>
    expect(store.getState().generationJobs.get(job.id)?.cancellation).toBe('unknown'),
  );
  expect(cancelRemote).toHaveBeenCalledExactlyOnceWith(job.id);
  expect(cancel).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect((store.getState().document.nodes[0].data as CanvasMediaData).pendingJobIds).toEqual([
    job.id,
  ]);
});

function setupActiveJobs({ count = 1, locked = false, submitting = false } = {}) {
  const jobs = Array.from({ length: count }, (_, index) =>
    generationJob({
      id:
        index === 0
          ? '11111111-1111-4111-8111-111111111111'
          : '33333333-3333-4333-8333-333333333333',
      status: 'running',
      outputs: [],
    }),
  );
  const node = media('one', 'image', { locked });
  const data = {
    ...(node.data as CanvasMediaData),
    count,
    pendingJobIds: jobs.map((job) => job.id),
  };
  node.data = data;
  const store = createCanvasStore(doc([node]));
  jobs.forEach((job) => store.getState().setGenerationJob(job));
  store.getState().setGenerationSubmitting(node.id, submitting);
  const cancel = vi.fn().mockImplementation((id: string) =>
    Promise.resolve({
      ...jobs.find((job) => job.id === id)!,
      status: 'failed',
      recoveryAction: 'none',
    }),
  );
  const host: CanvasHost = {
    media: { upload: vi.fn(), url: (hash) => hash },
    generation: {
      load: vi.fn(),
      create: vi.fn(),
      get: vi.fn(),
      cancel,
      resubmit: vi.fn(),
      subscribe: vi.fn(),
    },
  };
  render(
    <CanvasContext.Provider value={{ store, registry: createBuiltinRegistry(), host }}>
      <GenerationStatus nodeId={node.id} data={data} />
    </CanvasContext.Provider>,
  );
  return { jobs, store, cancel };
}

it('单任务只显示生成中，取消按钮保留无障碍名称并调用原任务取消', async () => {
  const { jobs, store, cancel } = setupActiveJobs();
  expect(screen.getByRole('status').textContent).toBe('生成中');
  const button = screen.getByRole('button', { name: '放弃任务' });
  expect(button.textContent).toBe('取消');
  fireEvent.click(button);
  await waitFor(() => {
    expect(cancel).toHaveBeenCalledExactlyOnceWith(jobs[0].id);
    expect((store.getState().document.nodes[0].data as CanvasMediaData).pendingJobIds).toEqual([]);
    expect(store.getState().generationSubmitting.has('one')).toBe(false);
  });
});

it.each([
  { locked: true, submitting: false },
  { locked: false, submitting: true },
])('锁定或正在提交时禁用取消：%j', (options) => {
  const { cancel } = setupActiveJobs(options);
  const button = screen.getByRole<HTMLButtonElement>('button', { name: '放弃任务' });
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(cancel).not.toHaveBeenCalled();
});

it('多任务显示进度，取消第二项只移除对应任务', async () => {
  const { jobs, store, cancel } = setupActiveJobs({ count: 2 });
  expect(screen.getByRole('status').textContent).toMatch(/生成中\s*1\/2/);
  expect(screen.queryByText('取消')).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: '放弃任务' })[1]);
  await waitFor(() => {
    expect(cancel).toHaveBeenCalledExactlyOnceWith(jobs[1].id);
    expect((store.getState().document.nodes[0].data as CanvasMediaData).pendingJobIds).toEqual([
      jobs[0].id,
    ]);
  });
  expect(store.getState().generationJobs.get(jobs[0].id)?.status).toBe('running');
});

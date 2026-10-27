import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CanvasMediaData } from '@frame-loom/contracts';
import type { CanvasHost } from '../host';
import { CanvasContext } from '../context';
import { createCanvasStore } from '../store/store';
import { doc, generationJob, media } from '../test-utils';
import { createBuiltinRegistry } from './builtin';
import { GenerationStatus } from './generation-status';

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

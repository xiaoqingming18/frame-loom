import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CanvasMediaData } from '@frame-loom/contracts';
import type { CanvasHost } from '../host';
import { CanvasContext } from '../context';
import { createCanvasStore } from '../store/store';
import { doc, generationJob, media } from '../test-utils';
import { createBuiltinRegistry } from './builtin';
import { GenerationRuntime } from './generation-runtime';

afterEach(cleanup);

it('失效任务不阻塞其他历史任务恢复，重新打开补写结果，卸载终止订阅', async () => {
  const job = generationJob();
  const failed = generationJob({
    id: '33333333-3333-4333-8333-333333333333',
    status: 'failed',
    errorMessage: '失败项保留',
  });
  const node = media('one');
  node.data = { ...(node.data as CanvasMediaData), pendingJobIds: [job.id, failed.id] };
  const invalid = media('invalid');
  invalid.data = { ...(invalid.data as CanvasMediaData), pendingJobIds: ['missing'] };
  const store = createCanvasStore(doc([invalid, node]));
  store.getState().apply(() => doc([]));
  const get = vi.fn((id: string) =>
    id === 'missing'
      ? Promise.reject(new Error('任务不存在'))
      : Promise.resolve(id === failed.id ? failed : job),
  );
  const subscribe = vi.fn();
  const host: CanvasHost = {
    media: { upload: vi.fn(), url: (hash) => hash },
    generation: {
      load: vi.fn().mockResolvedValue({ storageReady: false, models: [] }),
      create: vi.fn(),
      get,
      cancel: vi.fn(),
      resubmit: vi.fn(),
      subscribe,
    },
  };
  const view = render(
    <CanvasContext.Provider value={{ store, registry: createBuiltinRegistry(), host }}>
      <GenerationRuntime />
    </CanvasContext.Provider>,
  );
  await waitFor(() =>
    expect((store.getState().past[0].nodes[1].data as CanvasMediaData).pendingJobIds).toEqual([
      failed.id,
    ]),
  );
  act(() => store.getState().undo());
  await waitFor(() =>
    expect(store.getState().generationJobs.get(failed.id)?.status).toBe('failed'),
  );
  expect((store.getState().document.nodes[1].data as CanvasMediaData).versions[0].jobId).toBe(
    job.id,
  );
  expect(subscribe).toHaveBeenCalledOnce();
  const signal = subscribe.mock.calls[0][1] as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
});

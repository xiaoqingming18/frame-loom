import { expect, it, vi } from 'vitest';
import type { AssetEntry } from '@frame-loom/contracts';
import { createUploadQueue } from './upload-queue';

const entry: AssetEntry = {
  name: '最终名称.png',
  path: '最终名称.png',
  type: 'file',
  bytes: 1,
  updatedAt: '2026-10-27T00:00:00Z',
  mediaKind: 'image',
};
it('上传最多两路；取消等待项不发送，取消在途项后等待结束再重试，保留最终名称', async () => {
  const pending: { resolve: (value: AssetEntry) => void; signal: AbortSignal }[] = [];
  let active = 0;
  let maximum = 0;
  const upload = vi.fn((_task, signal: AbortSignal, progress: (value: number) => void) => {
    active++;
    maximum = Math.max(maximum, active);
    progress(42);
    return new Promise<AssetEntry>((resolve) => pending.push({ resolve, signal })).finally(
      () => active--,
    );
  });
  const changed = vi.fn();
  const queue = createUploadQueue(upload, changed);
  queue.add([new File(['a'], 'a.png'), new File(['b'], 'b.png'), new File(['c'], 'c.png')], '目录');
  expect(upload).toHaveBeenCalledTimes(2);
  expect(queue.getSnapshot()[0].progress).toBe(42);
  queue.cancel(3);
  queue.cancel(1);
  queue.retry(1);
  expect(pending[0].signal.aborted).toBe(true);
  expect(upload).toHaveBeenCalledTimes(2);
  pending[0].resolve(entry);
  await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(3));
  pending[1].resolve(entry);
  pending[2].resolve(entry);
  await vi.waitFor(() => expect(queue.pending()).toBe(false));
  expect(maximum).toBe(2);
  expect(queue.getSnapshot().map((task) => task.status)).toEqual(['done', 'done', 'cancelled']);
  expect(queue.getSnapshot()[0].name).toBe('最终名称.png');
  queue.dispose();
});

it('失败可重试，销毁中止全部请求且不再启动排队项', async () => {
  const upload = vi
    .fn()
    .mockRejectedValueOnce(new Error('空间不足'))
    .mockImplementation(
      (_task, signal: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('取消'))),
        ),
    );
  const queue = createUploadQueue(upload, vi.fn());
  queue.add([new File(['a'], 'a.png')], '');
  await vi.waitFor(() => expect(queue.getSnapshot()[0].error).toBe('空间不足'));
  queue.retry(1);
  queue.add([new File(['b'], 'b.png'), new File(['c'], 'c.png')], '');
  expect(upload).toHaveBeenCalledTimes(3);
  queue.dispose();
  await Promise.resolve();
  await Promise.resolve();
  expect(upload).toHaveBeenCalledTimes(3);
});

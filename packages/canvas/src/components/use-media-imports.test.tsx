import type { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { MediaFile } from '@frame-loom/contracts';
import { CanvasContext } from '../context';
import { createBuiltinRegistry } from '../nodes/builtin';
import { createCanvasStore } from '../store/store';
import type { CanvasHost } from '../host';
import { useMediaImports } from './use-media-imports';

afterEach(cleanup);
const asset: MediaFile = {
  sha256: 'a'.repeat(64),
  mime: 'image/png',
  width: 100,
  height: 50,
  durationMs: null,
  bytes: 100,
  createdAt: '2026-10-25T00:00:00Z',
};
function fixture(upload: CanvasHost['media']['upload']) {
  const store = createCanvasStore();
  const registry = createBuiltinRegistry();
  const host = { media: { upload, url: (hash: string) => hash } };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <CanvasContext.Provider value={{ store, registry, host }}>{children}</CanvasContext.Provider>
  );
  return { ...renderHook(useMediaImports, { wrapper }), store };
}

it('上传失败保留可重试占位；成功仅提交一次文档历史', async () => {
  const upload = vi.fn().mockRejectedValueOnce(new Error('网络断开')).mockResolvedValue(asset);
  const { result, store } = fixture(upload);
  act(() =>
    result.current.start([new File(['image'], '图片.png', { type: 'image/png' })], {
      x: 200,
      y: 200,
    }),
  );
  expect(store.getState().document.nodes).toEqual([]);
  await waitFor(() => expect(result.current.tasks[0].error).toBe('网络断开'));
  expect(store.getState().past).toEqual([]);
  act(() => result.current.retry(result.current.tasks[0].node.id));
  await waitFor(() => expect(result.current.tasks).toEqual([]));
  expect(store.getState().document.nodes[0].data).toMatchObject({
    versions: [{ sha256: asset.sha256 }],
  });
  expect(store.getState().past).toHaveLength(1);
  act(() => store.getState().undo());
  expect(store.getState().document.nodes).toEqual([]);
});

it('取消和卸载中止请求，迟到响应不再建节点', async () => {
  let resolve: (value: MediaFile) => void = () => {};
  const upload = vi.fn<CanvasHost['media']['upload']>().mockImplementation(
    () =>
      new Promise<MediaFile>((done) => {
        resolve = done;
      }),
  );
  const { result, store, unmount } = fixture(upload);
  act(() => result.current.start([new Blob(['image'], { type: 'image/png' })], { x: 0, y: 0 }));
  const signal = upload.mock.calls[0][1]!;
  act(() => result.current.cancel(result.current.tasks[0].node.id));
  expect(signal.aborted).toBe(true);
  await act(() => {
    resolve(asset);
    return Promise.resolve();
  });
  expect(store.getState().document.nodes).toEqual([]);
  act(() => result.current.start([new Blob(['image'], { type: 'image/png' })], { x: 0, y: 0 }));
  unmount();
  expect(upload.mock.calls[1][1]!.aborted).toBe(true);
  await act(() => {
    resolve(asset);
    return Promise.resolve();
  });
  expect(store.getState().past).toEqual([]);
});

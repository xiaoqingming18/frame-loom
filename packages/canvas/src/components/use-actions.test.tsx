import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasContext } from '../context';
import type { CanvasHost } from '../host';
import { createCanvasStore } from '../store/store';
import { createBuiltinRegistry } from '../nodes/builtin';
import { doc, generationJob, media } from '../test-utils';
import { useCanvasActions } from './use-actions';
import { serialize } from '../interaction/clipboard';
import { toVersion } from '../interaction/media-import';

vi.mock('@xyflow/react', () => ({ useReactFlow: () => ({}) }));
vi.mock('./use-media-imports', () => ({ useMediaImports: () => ({ tasks: [] }) }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('粘贴和导入先等待 adopt，缺失媒体保留数据；补齐失败不覆盖现有文档', async () => {
  const versions = [toVersion(generationJob().outputs[0])];
  const node = media('one', 'image', {
    data: { versions, activeVersion: 0, prompt: '', inputOrder: [] },
  });
  const store = createCanvasStore();
  const adopt = vi.fn().mockResolvedValue({ missing: [] });
  const host: CanvasHost = { media: { upload: vi.fn(), url: (hash) => hash, adopt } };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <CanvasContext.Provider value={{ store, registry: createBuiltinRegistry(), host }}>
      {children}
    </CanvasContext.Provider>
  );
  const { result } = renderHook(useCanvasActions, { wrapper });
  await act(async () => {
    expect(result.current.paste(serialize({ nodes: [node], edges: [] }), { x: 0, y: 0 })).toBe(
      true,
    );
    await Promise.resolve();
  });
  expect(adopt).toHaveBeenCalledOnce();
  expect(store.getState().document.nodes).toHaveLength(1);
  adopt.mockResolvedValueOnce({ missing: ['a'.repeat(64)] });
  const json = { size: 1, text: () => Promise.resolve(JSON.stringify(doc([node]))) } as File;
  await act(() => result.current.importDocument(json));
  expect(adopt).toHaveBeenCalledTimes(2);
  expect(store.getState().document.nodes[0].data).toMatchObject({ versions });
  expect(store.getState().notice?.text).toContain('素材缺失');
  const before = store.getState().document;
  adopt.mockRejectedValueOnce(new Error('补齐失败'));
  await act(() => result.current.importDocument(json));
  expect(store.getState().document).toBe(before);
});

it.each([true, false])(
  '删除与剪切共用入口，只有确认 %s 时放弃任务，锁定节点不取消',
  (confirmed) => {
    const job = generationJob();
    const node = media('one');
    const ids = [job.id, '33333333-3333-4333-8333-333333333333'];
    node.data = { ...(node.data as object), pendingJobIds: ids };
    const store = createCanvasStore(doc([node]));
    const cancel = vi.fn().mockResolvedValue({ ...job, status: 'cancelled' });
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
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(confirmed);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CanvasContext.Provider value={{ store, registry: createBuiltinRegistry(), host }}>
        {children}
      </CanvasContext.Provider>
    );
    const { result } = renderHook(useCanvasActions, { wrapper });
    store.getState().select(['one']);
    act(() => result.current.deleteSelection());
    expect(store.getState().document.nodes).toEqual([]);
    expect(confirm).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledTimes(confirmed ? 2 : 0);
    if (confirmed) for (const id of ids) expect(cancel).toHaveBeenCalledWith(id);
    cancel.mockClear();
    confirm.mockClear();
    act(() => {
      store.getState().undo();
      store.getState().apply((document) => ({
        ...document,
        nodes: document.nodes.map((item) => ({ ...item, locked: true })),
      }));
      store.getState().select(['one']);
    });
    act(() => result.current.deleteSelection());
    expect(confirm).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(store.getState().document.nodes).toHaveLength(1);
  },
);

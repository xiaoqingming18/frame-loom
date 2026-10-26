import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasContext } from '../context';
import type { CanvasHost } from '../host';
import { createCanvasStore } from '../store/store';
import { createBuiltinRegistry } from '../nodes/builtin';
import { doc, generationJob, media } from '../test-utils';
import { useCanvasActions } from './use-actions';

vi.mock('@xyflow/react', () => ({ useReactFlow: () => ({}) }));
vi.mock('./use-media-imports', () => ({ useMediaImports: () => ({ tasks: [] }) }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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

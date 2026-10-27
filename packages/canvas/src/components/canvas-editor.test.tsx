import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BUILTIN_TAGS } from '@frame-loom/contracts';
import { CanvasEditor } from './canvas-editor';
import type { CanvasHost } from '../host';
import { createCanvasStore } from '../store/store';
import { doc, group, media } from '../test-utils';

vi.mock('@xyflow/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
  ReactFlow: ({
    children,
    nodes,
    onNodeContextMenu,
  }: ComponentProps<typeof import('@xyflow/react').ReactFlow>) => (
    <div>
      <button onContextMenu={(event) => onNodeContextMenu?.(event, nodes![0])}>测试节点</button>
      {children}
    </div>
  ),
  Background: () => null,
  MiniMap: () => null,
  useReactFlow: () => ({ screenToFlowPosition: (point: unknown) => point }),
  useStore: (selector: (state: { transform: number[] }) => unknown) =>
    selector({ transform: [0, 0, 1] }),
}));
vi.mock('../nodes/generation-runtime', () => ({ GenerationRuntime: () => null }));
vi.mock('./chrome', () =>
  Object.fromEntries(
    [
      'AddNodeItems',
      'ArrangeItems',
      'BottomDock',
      'EmptyHint',
      'HelpDialog',
      'Notice',
      'TopRightBar',
    ].map((key) => [key, () => null]),
  ),
);
vi.mock('./use-actions', () => ({
  useCanvasActions: () => ({ uploads: [] }),
  ZOOM_LIMITS: { min: 0.1, max: 4 },
}));
beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function host() {
  return {
    media: { upload: vi.fn(), url: (hash) => hash },
    tags: {
      list: vi.fn<NonNullable<CanvasHost['tags']>['list']>().mockResolvedValue(BUILTIN_TAGS),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    },
  } satisfies CanvasHost;
}

it('挂载加载标签，菜单进入卡片后可打标签并关闭', async () => {
  const api = host();
  const store = createCanvasStore(doc([media('a')]));
  await act(async () => {
    await Promise.resolve();
    render(<CanvasEditor host={api} store={store} />);
  });
  expect(api.tags.list).toHaveBeenCalledWith(expect.any(AbortSignal));
  expect(store.getState().tags).toEqual(BUILTIN_TAGS);
  fireEvent.contextMenu(screen.getByRole('button', { name: '测试节点' }), {
    clientX: 10,
    clientY: 20,
  });
  fireEvent.click(screen.getByRole('menuitem', { name: '标签' }));
  expect(screen.getByRole('dialog', { name: '画布标签' })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: '道具' }));
  expect(store.getState().document.nodes[0].tagId).toBe('builtin-prop');
  expect(screen.queryByRole('dialog', { name: '画布标签' })).toBeNull();
});

it.each([media('a', 'image', { locked: true }), group('g')])(
  '不可编辑节点的标签菜单置灰：$id',
  async (node) => {
    await act(async () => {
      await Promise.resolve();
      render(<CanvasEditor host={host()} initialDocument={doc([node])} />);
    });
    fireEvent.contextMenu(screen.getByRole('button', { name: '测试节点' }));
    expect(screen.getByRole('menuitem', { name: '标签' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  },
);

it('无宿主能力时隐藏标签入口，加载失败提示错误，卸载取消加载', async () => {
  const api = host();
  const store = createCanvasStore(doc([media('a')]));
  const { tags, ...withoutTags } = api;
  const { rerender, unmount } = render(<CanvasEditor host={withoutTags} store={store} />);
  fireEvent.contextMenu(screen.getByRole('button', { name: '测试节点' }));
  expect(screen.queryByRole('menuitem', { name: '标签' })).toBeNull();
  vi.mocked(tags.list).mockRejectedValueOnce(new Error('加载失败'));
  await act(async () => {
    await Promise.resolve();
    rerender(<CanvasEditor host={api} store={store} />);
  });
  expect(store.getState().notice?.text).toBe('加载失败');
  const signal = vi.mocked(tags.list).mock.calls[0][0];
  unmount();
  expect(signal.aborted).toBe(true);
});

import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TooltipProvider } from '@frame-loom/ui/components/tooltip';
import { CanvasContext } from '../context';
import { createCanvasStore } from '../store/store';
import { createBuiltinRegistry } from '../nodes/builtin';
import { media, doc } from '../test-utils';
import { BottomDock, TopRightBar } from './chrome';
import type { CanvasActionsApi } from './use-actions';

vi.mock('@xyflow/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  useViewport: () => ({ x: 0, y: 0, zoom: 0.75 }),
}));

beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fixture(children: (actions: CanvasActionsApi) => ReactNode) {
  const store = createCanvasStore();
  const callbacks = {
    undo: vi.fn(),
    redo: vi.fn(),
    zoomTo: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    fitView: vi.fn(),
    arrange: vi.fn(),
    arrangeOrder: 'created',
    setArrangeOrder: vi.fn(),
    addNode: vi.fn(),
  };
  const actions = callbacks as unknown as CanvasActionsApi;
  render(
    <CanvasContext.Provider
      value={{
        store,
        registry: createBuiltinRegistry(),
        host: {
          media: { upload: () => Promise.reject(new Error('本测试不上传')), url: (hash) => hash },
        },
      }}
    >
      <TooltipProvider>{children(actions)}</TooltipProvider>
    </CanvasContext.Provider>,
  );
  return { store, callbacks };
}

it('底部栏包含已确认的工具，工具切换与撤销状态跟随独立 store', () => {
  const help = vi.fn();
  const { store, callbacks } = fixture((actions) => (
    <BottomDock actions={actions} addOpen={false} onAddOpenChange={vi.fn()} onHelp={help} />
  ));
  expect(screen.getByRole('button', { name: '指针' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '框选' }));
  expect(store.getState().tool).toBe('select');
  fireEvent.click(screen.getByRole('button', { name: '抓手' }));
  expect(store.getState().tool).toBe('hand');
  const undo = screen.getByRole<HTMLButtonElement>('button', { name: '撤销' });
  expect(undo.disabled).toBe(true);
  act(() => {
    store.getState().apply(() => doc([media('a')]));
  });
  expect(undo.disabled).toBe(false);
  fireEvent.click(undo);
  expect(callbacks.undo).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '快捷键帮助' }));
  expect(help).toHaveBeenCalledOnce();
});

it('右上工具组显示视口缩放并切换小地图偏好', () => {
  const { store, callbacks } = fixture((actions) => (
    <TopRightBar actions={actions} compact={false} />
  ));
  expect(screen.getByRole('button', { name: '缩放比例' }).textContent).toBe('75%');
  fireEvent.click(screen.getByRole('button', { name: '隐藏小地图' }));
  expect(store.getState().view.minimap).toBe(false);
  expect(screen.getByRole('button', { name: '显示小地图' }).getAttribute('aria-pressed')).toBe(
    'false',
  );
  fireEvent.click(screen.getByRole('button', { name: '按类型整理全部节点' }));
  expect(callbacks.arrange).toHaveBeenCalledExactlyOnceWith('type');
});

it('窄画布自动收起小地图但保留用户开关偏好', () => {
  const { store } = fixture((actions) => <TopRightBar actions={actions} compact />);
  const minimap = screen.getByRole<HTMLButtonElement>('button', { name: '隐藏小地图' });
  expect(minimap.disabled).toBe(true);
  expect(minimap.getAttribute('aria-pressed')).toBe('false');
  expect(store.getState().view.minimap).toBe(true);
});

it('选中单个分组时整理选区，布局和排序入口调用同一动作集', () => {
  const { store, callbacks } = fixture((actions) => (
    <TopRightBar actions={actions} compact={false} />
  ));
  act(() => store.getState().select(['group']));
  fireEvent.pointerDown(screen.getByRole('button', { name: '按布局整理选中节点' }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(screen.getByRole('menuitemradio', { name: '标题顺序' }));
  expect(callbacks.setArrangeOrder).toHaveBeenCalledExactlyOnceWith('title');
  for (const [label, mode] of [
    ['宫格', 'grid'],
    ['水平', 'horizontal'],
    ['垂直', 'vertical'],
    ['按类型', 'type'],
  ]) {
    fireEvent.pointerDown(screen.getByRole('button', { name: '按布局整理选中节点' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: label }));
    expect(callbacks.arrange).toHaveBeenLastCalledWith(mode);
  }
});

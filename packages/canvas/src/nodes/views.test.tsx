import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CanvasMediaData, ModelProfile } from '@frame-loom/contracts';
import { CanvasContext } from '../context';
import { createCanvasStore } from '../store/store';
import { doc, media } from '../test-utils';
import { createBuiltinRegistry } from './builtin';
import { VideoNodeView } from './views';

const zoom = vi.hoisted(() => ({ value: 1 }));

vi.mock('@xyflow/react', () => ({
  Handle: ({ id, isConnectable }: { id: string; isConnectable?: boolean }) => (
    <button aria-label={id} disabled={isConnectable === false} />
  ),
  NodeResizer: () => null,
  Position: { Left: 'left', Right: 'right' },
  useConnection: () => null,
  useStore: (selector: (state: { transform: number[] }) => unknown) =>
    selector({ transform: [0, 0, zoom.value] }),
  useUpdateNodeInternals: () => vi.fn(),
}));

afterEach(() => {
  cleanup();
  zoom.value = 1;
});

it('低缩放省略未选中节点的表单，选中后仍可编辑', () => {
  const node = media('video', 'video');
  const store = createCanvasStore(doc([node]));
  const view = (selected: boolean) => (
    <CanvasContext.Provider
      value={{
        store,
        registry: createBuiltinRegistry(),
        host: {
          media: { upload: vi.fn(), url: (hash) => hash },
          generation: {
            Panel: () => <textarea aria-label="测试生成表单" />,
            load: vi.fn(),
            create: vi.fn(),
            get: vi.fn(),
            cancel: vi.fn(),
            resubmit: vi.fn(),
            subscribe: vi.fn(),
          },
        },
      }}
    >
      <VideoNodeView node={{ ...node, data: node.data as CanvasMediaData }} selected={selected} />
    </CanvasContext.Provider>
  );
  zoom.value = 0.1;
  const { rerender } = render(view(false));
  expect(screen.queryByRole('textbox', { name: '测试生成表单' })).toBeNull();
  rerender(view(true));
  expect(screen.getByRole('textbox', { name: '测试生成表单' })).toBeDefined();
  zoom.value = 1;
  rerender(view(false));
  expect(screen.getByRole('textbox', { name: '测试生成表单' })).toBeDefined();
});

it('视频档案隐藏不支持的方式并禁用尾帧，未加载档案时保留通用端口', () => {
  const node = media('video', 'video');
  node.data = { ...(node.data as CanvasMediaData), mode: 'frames' };
  const store = createCanvasStore(doc([node]));
  const profile = {
    modes: [{ id: 'text' }, { id: 'frames' }],
    constraints: [{ when: {}, forbidRoles: ['last_frame'] }],
  } as ModelProfile;
  store.getState().setGenerationConfig({
    storageReady: false,
    models: [{ id: 'sora', label: 'Sora', kind: 'video', profile }],
  });
  render(
    <CanvasContext.Provider
      value={{
        store,
        registry: createBuiltinRegistry(),
        host: { media: { upload: vi.fn(), url: (hash) => hash } },
      }}
    >
      <VideoNodeView node={{ ...node, data: node.data as CanvasMediaData }} selected />
    </CanvasContext.Provider>,
  );
  expect(screen.queryByRole('radio', { name: '参考生视频' })).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'last_frame' }).disabled).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'first_frame' }).disabled).toBe(
    false,
  );
  act(() => store.getState().setGenerationConfig({ storageReady: false, models: [] }));
  expect(screen.getByRole('radio', { name: '参考生视频' })).toBeDefined();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'last_frame' }).disabled).toBe(
    false,
  );
});

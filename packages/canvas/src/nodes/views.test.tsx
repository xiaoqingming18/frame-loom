import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CanvasMediaData, ModelProfile } from '@frame-loom/contracts';
import { CanvasContext, NodeActionsContext, useCanvasState } from '../context';
import { createCanvasStore } from '../store/store';
import { doc, media, sha, generationJob } from '../test-utils';
import { createBuiltinRegistry } from './builtin';
import { ImageNodeView, VideoNodeView } from './views';

const zoom = vi.hoisted(() => ({ value: 1 }));

vi.mock('@xyflow/react', () => ({
  Handle: ({ id, isConnectable }: { id: string; isConnectable?: boolean }) => (
    <button aria-label={id} disabled={isConnectable === false} />
  ),
  NodeResizer: () => null,
  NodeToolbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Position: { Left: 'left', Right: 'right', Bottom: 'bottom' },
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
  act(() => store.getState().select([node.id, 'another']));
  expect(screen.queryByRole('textbox', { name: '测试生成表单' })).toBeNull();
  act(() => store.getState().select([node.id]));
  zoom.value = 1;
  rerender(view(false));
  expect(screen.queryByRole('textbox', { name: '测试生成表单' })).toBeNull();
});

it('图片节点空态可上传、添加并连接，生成进度叠在已有版本上且版本可切换', () => {
  const node = media('image');
  const store = createCanvasStore(doc([node]));
  const addConnected = vi.fn();
  const api = {
    load: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    cancel: vi.fn(),
    resubmit: vi.fn(),
    subscribe: vi.fn(),
  };
  function View() {
    const current = useCanvasState((state) => state.document.nodes[0]);
    return <ImageNodeView node={{ ...current, data: current.data as CanvasMediaData }} selected />;
  }
  render(
    <CanvasContext.Provider
      value={{
        store,
        registry: createBuiltinRegistry(),
        host: { media: { upload: vi.fn(), url: (hash) => hash }, generation: api },
      }}
    >
      <NodeActionsContext.Provider value={{ addConnected }}>
        <View />
      </NodeActionsContext.Provider>
    </CanvasContext.Provider>,
  );
  expect(screen.getByText('拖入或粘贴图片')).toBeDefined();
  expect(screen.getByRole('button', { name: '上传图片' })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: '添加并连接' }), {
    clientX: 100,
    clientY: 200,
  });
  expect(addConnected).toHaveBeenCalledWith(node.id, { x: 124, y: 200 });
  void act(() =>
    store.getState().apply((document) => ({
      ...document,
      nodes: document.nodes.map((item) => ({
        ...item,
        data: {
          ...(item.data as CanvasMediaData),
          count: 3,
          versions: ['a', 'b'].map((key) => ({
            sha256: sha(key),
            mime: 'image/png',
            width: 100,
            height: 100,
            createdAt: '2026-10-26T00:00:00.000Z',
          })),
        },
      })),
    })),
  );
  fireEvent.click(screen.getByRole('button', { name: '下一版本' }));
  expect((store.getState().document.nodes[0].data as CanvasMediaData).activeVersion).toBe(1);
  expect(screen.getByLabelText('当前版本').textContent).toBe('2/2');
  expect(screen.queryByRole('button', { name: '上传图片' })).toBeNull();
  const job = generationJob({ status: 'running' });
  act(() => {
    store.getState().setGenerationJob(job);
    store.getState().apply((document) => ({
      ...document,
      nodes: document.nodes.map((item) => ({
        ...item,
        data: { ...(item.data as CanvasMediaData), pendingJobIds: [job.id] },
      })),
    }));
  });
  expect(screen.getByRole('img', { name: 'image' })).toBeDefined();
  expect(screen.getByText('生成中 3/3')).toBeDefined();
  expect(screen.getByRole('button', { name: '放弃任务' })).toBeDefined();
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

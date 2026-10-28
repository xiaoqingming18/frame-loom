import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CanvasMediaData } from '@frame-loom/contracts';
import { CanvasContext, NodeActionsContext, useCanvasState } from '../context';
import { createCanvasStore } from '../store/store';
import { doc, edge, media, sha, generationJob, generationModelFixture } from '../test-utils';
import { createBuiltinRegistry } from './builtin';
import { ImageNodeView, VideoNodeView, NodeHeader } from './views';
import { AudioNodeView } from './audio-view';

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
it('音频空状态、播放控件、标签与版本切换复用媒体视图', async () => {
  const node = media('audio', 'audio', { tagId: 'tag' });
  const store = createCanvasStore(doc([node]));
  const registry = createBuiltinRegistry();
  expect(registry.inputs(node)).toEqual([]);
  expect(registry.outputs(node)).toEqual([{ id: 'out', label: '音频', dataType: 'audio' }]);
  store.getState().setTags([{ id: 'tag', name: '配音', color: 'orange', builtin: false }]);
  function View() {
    const current = useCanvasState((state) => state.document.nodes[0]);
    return (
      <AudioNodeView
        node={{ ...current, data: current.data as CanvasMediaData }}
        selected={false}
      />
    );
  }
  const host = {
    media: { upload: vi.fn(), url: (hash: string) => hash },
    tags: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  };
  render(
    <CanvasContext.Provider value={{ store, registry, host }}>
      <View />
    </CanvasContext.Provider>,
  );
  expect(screen.getByText('填写文本，生成语音')).toBeDefined();
  expect(screen.getByText('配音')).toBeDefined();
  const version = { ...generationJob().outputs[0], mime: 'audio/wav', durationMs: 1000 };
  await act(() =>
    store.getState().apply((document) => ({
      ...document,
      nodes: [
        {
          ...document.nodes[0],
          data: {
            versions: [version, { ...version, sha256: sha('b'), durationMs: 2000 }],
            activeVersion: 1,
            prompt: '',
            inputOrder: [],
          },
        },
      ],
    })),
  );
  expect(screen.getByText('2.0 秒')).toBeDefined();
  expect(document.querySelector('audio')?.controls).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '上一版本' }));
  expect(screen.getByText('1.0 秒')).toBeDefined();
  expect(document.querySelector('audio')?.getAttribute('src')).toBe(sha('a'));
});
it('媒体加载失败显示缺失占位且保留原始版本', () => {
  const node = media('missing', 'image', {
    data: { versions: generationJob().outputs, activeVersion: 0, prompt: '', inputOrder: [] },
  });
  const store = createCanvasStore(doc([node]));
  render(
    <CanvasContext.Provider
      value={{
        store,
        registry: createBuiltinRegistry(),
        host: { media: { upload: vi.fn(), url: (hash) => hash } },
      }}
    >
      <ImageNodeView node={{ ...node, data: node.data as CanvasMediaData }} selected={false} />
    </CanvasContext.Provider>,
  );
  fireEvent.error(screen.getByRole('img'));
  expect(screen.getByText('素材缺失')).toBeDefined();
  expect(store.getState().document.nodes[0].data).toMatchObject({
    versions: generationJob().outputs,
  });
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

it('视频只显示能力卡方式，非当前方式连线端口保留但禁用', () => {
  const node = media('video', 'video');
  node.data = { ...(node.data as CanvasMediaData), mode: 'first' };
  const store = createCanvasStore(doc([node], []));
  const model = generationModelFixture('ark-seedance');
  if (model.capability.kind !== 'video') throw new Error('视频夹具无效');
  model.capability.modes = [{ id: 't2v' }, { id: 'first' }];
  store.getState().setGenerationConfig({ storageReady: false, models: [model] });
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
  expect(screen.queryByRole('radio', { name: '首尾帧' })).toBeNull();
  expect(screen.queryByRole('radio', { name: '全模态参考' })).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'first_frame' }).disabled).toBe(
    false,
  );
  expect(screen.queryByRole('button', { name: 'last_frame' })).toBeNull();
});

it('模式切换保留首尾帧连线和提示词，文生模式保留端口但不能新连线', () => {
  const node = media('video', 'video');
  node.data = { ...(node.data as CanvasMediaData), mode: 'first_last', prompt: '保留创作内容' };
  const document = doc(
    [media('source'), node],
    [{ ...edge('first', 'source', 'video'), targetHandle: 'first_frame' }],
  );
  const store = createCanvasStore(document);
  store
    .getState()
    .setGenerationConfig({ storageReady: false, models: [generationModelFixture('ark-seedance')] });
  function View() {
    const current = useCanvasState((state) => state.document.nodes[1]);
    return <VideoNodeView node={{ ...current, data: current.data as CanvasMediaData }} selected />;
  }
  render(
    <CanvasContext.Provider
      value={{
        store,
        registry: createBuiltinRegistry(),
        host: { media: { upload: vi.fn(), url: (hash) => hash } },
      }}
    >
      <View />
    </CanvasContext.Provider>,
  );
  fireEvent.click(screen.getByRole('radio', { name: '文生视频' }));
  expect(store.getState().document.edges).toEqual(document.edges);
  expect(store.getState().document.nodes[1].data).toMatchObject({
    mode: 't2v',
    prompt: '保留创作内容',
  });
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'first_frame' }).disabled).toBe(
    true,
  );
});

it('公共头部显示标签并先截断标题；悬空 id 和未注入宿主时隐藏徽标', () => {
  const node = media('a', 'image', { tagId: 'tag', title: '很长的节点标题' });
  const store = createCanvasStore(doc([node]));
  store.getState().setTags([{ id: 'tag', name: '场景', color: 'orange', builtin: false }]);
  const api = { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() };
  const view = (tags = true, current = node) => (
    <CanvasContext.Provider
      value={{
        store,
        registry: createBuiltinRegistry(),
        host: { media: { upload: vi.fn(), url: (hash) => hash }, ...(tags ? { tags: api } : {}) },
      }}
    >
      <NodeHeader node={current} icon={null} />
    </CanvasContext.Provider>
  );
  const { rerender } = render(view());
  expect(screen.getByText('场景').className).toContain('canvas-tag-orange');
  expect(screen.getByText('很长的节点标题').className).toContain('truncate');
  expect(screen.getByText('场景').className).toContain('shrink-0');
  rerender(view(true, { ...node, tagId: 'missing' }));
  expect(screen.queryByText('场景')).toBeNull();
  rerender(view(false));
  expect(screen.queryByText('场景')).toBeNull();
});

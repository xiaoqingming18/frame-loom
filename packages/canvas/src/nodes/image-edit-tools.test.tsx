import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { type CanvasMediaData, type ImageCap, type SemanticRequest } from '@frame-loom/contracts';
import { CanvasContext } from '../context';
import { createCanvasStore } from '../store/store';
import { doc, generationJob, generationModelFixture, media, sha } from '../test-utils';
import { createBuiltinRegistry } from './builtin';
import { ImageEditTools } from './image-edit-tools';
import { detectFaces } from './face-detection';

vi.mock('./face-detection', () => ({ detectFaces: vi.fn() }));
vi.mock('./emotion-head-preview', () => ({ EmotionHeadPreview: () => <div>头部预览替身</div> }));
vi.mock('./image-edit-previews', () => ({ AnglePreview: () => null, LightingPreview: () => null }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function setup(overrides: Partial<ImageCap> = {}, dimensions = { width: 256, height: 256 }) {
  const job = generationJob();
  job.outputs[0] = { ...job.outputs[0], ...dimensions };
  const data: CanvasMediaData = {
    versions: job.outputs,
    activeVersion: 0,
    prompt: '',
    inputOrder: [],
  };
  const store = createCanvasStore(doc([media('source', 'image', { data })]));
  const model = generationModelFixture();
  if (model.capability.kind !== 'image') throw new Error('图片夹具无效');
  model.capability = { ...model.capability, ...overrides };
  store.getState().setGenerationConfig({ storageReady: true, models: [model] });
  const create = vi.fn().mockResolvedValue(job);
  const host = {
    media: { upload: vi.fn(), url: (hash: string) => hash },
    generation: {
      load: vi.fn(),
      create,
      get: vi.fn(),
      cancel: vi.fn(),
      resubmit: vi.fn(),
      subscribe: vi.fn(),
    },
  };
  const view = render(
    <CanvasContext.Provider value={{ store, registry: createBuiltinRegistry(), host }}>
      <ImageEditTools nodeId="source" data={data} />
    </CanvasContext.Provider>,
  );
  return { ...view, store, create, job };
}

it('单一模型仍要求显式选择，角度只提交一次并保留源图', async () => {
  const { store, create, job } = setup();
  fireEvent.click(screen.getByRole('button', { name: '多角度编辑' }));
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '确认' }).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('编辑模型'), { target: { value: job.modelId } });
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(create.mock.calls[0][0]).toMatchObject({
    imageEdit: { operation: 'angle', source: { sha256: sha('a') } },
  });
  expect(store.getState().document.nodes).toHaveLength(2);
  expect((store.getState().document.nodes[0].data as CanvasMediaData).versions).toEqual(
    job.outputs,
  );
});

it('竖图角度请求与打光子节点均预填同比例尺寸', async () => {
  const { store, create, job } = setup({}, { width: 250, height: 357 });
  fireEvent.click(screen.getByRole('button', { name: '多角度编辑' }));
  fireEvent.change(screen.getByLabelText('编辑模型'), { target: { value: job.modelId } });
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  const params = (create.mock.calls[0][0] as SemanticRequest).params;
  expect(Math.abs(params.width! / params.height! / (250 / 357) - 1)).toBeLessThan(0.01);
  fireEvent.click(screen.getByRole('button', { name: '重打光编辑' }));
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  expect((store.getState().document.nodes[2].data as CanvasMediaData).params).toEqual(params);
  expect(create).toHaveBeenCalledOnce();
});

it('全部标准比例禁用时表情预检显示原因并禁止提交', async () => {
  vi.mocked(detectFaces).mockResolvedValue({
    imageWidth: 256,
    imageHeight: 256,
    faces: [{ id: 'face', x: 50, y: 40, width: 60, height: 70, source: 'detected' }],
  });
  const { create, job } = setup({
    size: {
      wire: 'tier',
      tiers: [{ name: '1K', enabled: false, ratios: [{ ratio: '3:4' }] }],
      default: { tier: '1K', ratio: '3:4' },
    },
  });
  fireEvent.click(screen.getByRole('button', { name: '表情编辑' }));
  fireEvent.change(screen.getByLabelText('表情模型'), { target: { value: job.modelId } });
  fireEvent.click(await screen.findByRole('radio', { name: '角色1' }));
  expect(screen.getByText(/没有已启用的有效比例/)).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '生成表情' }).disabled).toBe(true);
  expect(create).not.toHaveBeenCalled();
});

it('参考图不足时表情禁用并说明原因，单参考角度仍可用', async () => {
  vi.mocked(detectFaces).mockResolvedValue({ faces: [], imageWidth: 256, imageHeight: 256 });
  const { create, job } = setup({ references: { max: 1, formats: ['image/png'] } });
  fireEvent.click(screen.getByRole('button', { name: '多角度编辑' }));
  fireEvent.change(screen.getByLabelText('编辑模型'), { target: { value: job.modelId } });
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: '表情编辑' }));
  fireEvent.change(screen.getByLabelText('表情模型'), { target: { value: job.modelId } });
  expect(screen.getByText('需要编辑接口与至少两个参考图')).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '生成表情' }).disabled).toBe(true);
});

it('打光模板关闭编辑仍即时生效，关闭面板后重开恢复默认且不提交任务', () => {
  const { create, store, job } = setup();
  fireEvent.click(screen.getByRole('button', { name: '重打光编辑' }));
  fireEvent.change(screen.getByLabelText('编辑模型'), { target: { value: job.modelId } });
  fireEvent.click(screen.getByRole('button', { name: '设置提示词模板' }));
  fireEvent.change(screen.getByLabelText('打光提示词模板'), {
    target: { value: '会话专用，{{brightnessPrompt}}' },
  });
  fireEvent.click(screen.getByRole('button', { name: '设置提示词模板' }));
  fireEvent.click(screen.getByRole('button', { name: '确认' }));
  expect((store.getState().document.nodes[1].data as CanvasMediaData).prompt).toContain('会话专用');
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重打光编辑' }));
  fireEvent.click(screen.getByRole('button', { name: '设置提示词模板' }));
  expect(screen.getByLabelText<HTMLTextAreaElement>('打光提示词模板').value).not.toContain(
    '会话专用',
  );
});

it('关闭检测与重复检测均中止旧请求，过期结果不回写工作区', async () => {
  const signals: AbortSignal[] = [];
  vi.mocked(detectFaces).mockImplementation((_url, signal) => {
    signals.push(signal);
    return new Promise(() => {});
  });
  setup();
  fireEvent.click(screen.getByRole('button', { name: '表情编辑' }));
  await waitFor(() => expect(signals).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: '重新检测' }));
  await waitFor(() => expect(signals).toHaveLength(2));
  expect(signals[0].aborted).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '关闭表情编辑' }));
  expect(signals[1].aborted).toBe(true);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('表情选中角色后源版本改变会阻止提交，边缘情绪坐标可以选择', async () => {
  vi.mocked(detectFaces).mockResolvedValue({
    imageWidth: 256,
    imageHeight: 256,
    faces: [{ id: 'face', x: 50, y: 40, width: 60, height: 70, source: 'detected' }],
  });
  const { store, create, job } = setup();
  fireEvent.click(screen.getByRole('button', { name: '表情编辑' }));
  fireEvent.change(screen.getByLabelText('表情模型'), { target: { value: job.modelId } });
  fireEvent.click(await screen.findByRole('radio', { name: '角色1' }));
  fireEvent.click(screen.getAllByRole('gridcell')[0]);
  act(() => {
    store.getState().apply((document) => ({
      ...document,
      nodes: document.nodes.map((node) => ({
        ...node,
        data: {
          ...(node.data as CanvasMediaData),
          versions: [{ ...job.outputs[0], sha256: sha('b') }],
        },
      })),
    }));
  });
  fireEvent.click(screen.getByRole('button', { name: '生成表情' }));
  expect(await screen.findByText('源图片版本已变化，请重新选择')).toBeDefined();
  expect(create).not.toHaveBeenCalled();
});

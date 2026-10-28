import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  checkMedia,
  type CanvasMediaData,
  type TtsCap,
  type VideoCap,
  type SemanticRequest,
  type GenerationJob,
} from '@frame-loom/contracts';
import { TooltipProvider } from '@frame-loom/ui/components/tooltip';
import { CanvasContext, useCanvasState } from '../context';
import { createCanvasStore } from '../store/store';
import type { CanvasHost } from '../host';
import { doc, edge, generationJob, generationModelFixture, media } from '../test-utils';
import { createBuiltinRegistry } from './builtin';
import { GenerationPanel } from './generation-panel';
import { generationSources } from './generation-inputs';
import { writeGenerationJob } from './generation-writeback';
import { checkConnection } from '../registry/connections';
import { TtsParams } from './params/tts-params';

afterEach(cleanup);
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

function setup(long = false) {
  const model = generationModelFixture('openai-speech');
  const cap = model.capability as TtsCap;
  cap.maxChars = 10;
  cap.voices.sources = ['preset', 'manual', 'remote'];
  cap.voices.presets = [{ id: 'local', name: '内置音色' }];
  cap.voices.default = 'local';
  cap.instructions = true;
  cap.speed = { min: 0.5, max: 2, default: 1 };
  cap.pitch = { min: -1, max: 1, default: 0 };
  cap.volume = { min: 0, max: 1, default: 1 };
  model.protocol.operations.voices = { method: 'GET', path: '/voices', encoding: 'json' };
  Object.assign(model.protocol.ceiling.tts!, {
    voiceSources: ['preset', 'manual', 'remote'],
    pitch: true,
    volume: true,
  });
  const node = media('audio', 'audio', {
    data: {
      versions: [],
      activeVersion: 0,
      inputOrder: [],
      prompt: long ? '超过十个字符的文本不能提交合成' : '你好',
    },
  });
  const store = createCanvasStore(doc([node]));
  store.getState().setGenerationConfig({ models: [model], storageReady: true });
  const api = {
    load: vi.fn(),
    create: vi
      .fn<(request: SemanticRequest) => Promise<GenerationJob>>()
      .mockResolvedValue(generationJob({ status: 'pending', kind: 'tts', outputs: [] })),
    get: vi.fn(),
    cancel: vi.fn(),
    resubmit: vi.fn(),
    subscribe: vi.fn(),
    voices: vi.fn().mockResolvedValue({
      param: 'voice',
      canFetch: true,
      canManual: true,
      voices: [{ voiceId: 'saved', name: '手填已保存', source: 'saved' }],
    }),
    fetchVoices: vi.fn().mockRejectedValue(new Error('远端不可用')),
    saveVoice: vi.fn().mockResolvedValue({
      param: 'voice',
      canFetch: true,
      canManual: true,
      voices: [{ voiceId: 'custom', name: '我的音色', source: 'saved' }],
    }),
  } satisfies NonNullable<CanvasHost['generation']>;
  function Panel() {
    const data = useCanvasState((state) => state.document.nodes[0].data as CanvasMediaData);
    return <GenerationPanel kind="audio" nodeId="audio" data={data} />;
  }
  render(
    <CanvasContext.Provider
      value={{
        store,
        registry: createBuiltinRegistry(),
        host: { media: { url: (hash) => hash, upload: vi.fn() }, generation: api },
      }}
    >
      <TooltipProvider>
        <Panel />
      </TooltipProvider>
    </CanvasContext.Provider>,
  );
  return { api, store, model };
}

it('TTS 按能力渲染参数，音色拉取失败保留手填并提交一个语义任务', async () => {
  const { api } = setup();
  fireEvent.click(screen.getByRole('button', { name: '生成参数' }));
  await screen.findByRole('option', { name: '手填已保存' });
  for (const name of ['语速', '音调', '音量'])
    expect(screen.getByRole('slider', { name })).toBeDefined();
  fireEvent.change(screen.getByLabelText('音色 ID'), { target: { value: 'custom' } });
  fireEvent.click(screen.getByRole('button', { name: '从接口拉取' }));
  await screen.findByText('远端不可用');
  expect(screen.getByLabelText<HTMLInputElement>('音色 ID').value).toBe('custom');
  fireEvent.change(screen.getByLabelText('指令文本'), { target: { value: '轻柔' } });
  fireEvent.change(screen.getByLabelText('音色名称'), { target: { value: '我的音色' } });
  fireEvent.click(screen.getByRole('button', { name: '保存音色' }));
  await waitFor(() =>
    expect(api.saveVoice).toHaveBeenCalledWith(expect.any(String), {
      voiceId: 'custom',
      name: '我的音色',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: '生成音频' }));
  await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
  expect(api.create).toHaveBeenCalledTimes(1);
  expect(api.create.mock.calls[0][0]).toMatchObject({
    prompt: '你好',
    inputs: [],
    params: { voice: 'custom', instructions: '轻柔', speed: 1, pitch: 0, volume: 1 },
    source: 'canvas',
  });
});

it('已保存的超长 TTS 文本由共享校验阻止提交', () => {
  const { api } = setup(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '生成音频' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '生成音频' }));
  expect(api.create).not.toHaveBeenCalled();
});

it('TTS 未声明的指令、滑块与音色入口不显示，预览无需画布宿主', () => {
  const model = generationModelFixture('gemini-generate');
  const cap = structuredClone(model.protocol.templates.tts!);
  cap.instructions = false;
  cap.voices.sources = ['preset'];
  render(
    <TtsParams
      capability={cap}
      protocol={model.protocol}
      params={{}}
      inputs={[]}
      disabled={false}
      onChange={vi.fn()}
      readOnly
    />,
  );
  expect(screen.queryByLabelText('指令文本')).toBeNull();
  expect(screen.queryAllByRole('slider')).toHaveLength(0);
  expect(screen.queryByLabelText('音色 ID')).toBeNull();
  expect(screen.queryByText('从接口拉取')).toBeNull();
});

it('音频写回保留元数据，参考音频连接由能力卡限制并参与总时长校验', () => {
  const audio = media('audio', 'audio', {
    data: {
      versions: [],
      activeVersion: 0,
      prompt: '',
      inputOrder: [],
      pendingJobIds: [generationJob().id],
    },
  });
  const video = media('video', 'video', {
    data: { versions: [], activeVersion: 0, prompt: '视频', inputOrder: [], mode: 'reference' },
  });
  const output = {
    ...generationJob().outputs[0],
    mime: 'audio/wav',
    width: null,
    height: null,
    durationMs: 3000,
    sampleRate: 24000,
    channels: 1,
    codec: 'pcm_s16le',
  };
  const document = writeGenerationJob(
    doc([audio, video]),
    generationJob({ kind: 'tts', outputs: [output] }),
  );
  expect((document.nodes[0].data as CanvasMediaData).versions[0]).toMatchObject(output);
  const registry = createBuiltinRegistry();
  const model = generationModelFixture('ark-seedance');
  registry.setGenerationModels([model]);
  const connection = {
    source: 'audio',
    sourceHandle: 'out',
    target: 'video',
    targetHandle: 'reference',
  };
  expect(checkConnection(registry, document, connection).ok).toBe(true);
  const sources = generationSources(
    { ...document, edges: [edge('audio-ref', 'audio', 'video')] },
    'video',
  );
  expect(sources[0]).toMatchObject({
    input: { kind: 'audio', role: 'reference' },
    media: { durationMs: 3000 },
  });
  const cap = model.capability as VideoCap;
  cap.references.audio = { maxTotalSec: 2 };
  expect(checkMedia(sources, cap)).toContainEqual(
    expect.objectContaining({ message: '同类素材总时长超过限制' }),
  );
  cap.modes.find((mode) => mode.id === 'reference')!.reference!.accept = ['image'];
  expect(checkConnection(registry, document, connection).ok).toBe(false);
  cap.modes.find((mode) => mode.id === 'reference')!.reference!.accept = ['audio'];
  const store = createCanvasStore({ ...document, edges: [edge('audio-ref', 'audio', 'video')] });
  store.getState().setGenerationConfig({ models: [model], storageReady: true });
  const create = vi.fn();
  render(
    <CanvasContext.Provider
      value={{
        store,
        registry,
        host: {
          media: { url: (hash) => hash, upload: vi.fn() },
          generation: {
            load: vi.fn(),
            create,
            get: vi.fn(),
            cancel: vi.fn(),
            resubmit: vi.fn(),
            subscribe: vi.fn(),
          },
        },
      }}
    >
      <TooltipProvider>
        <GenerationPanel nodeId="video" kind="video" data={video.data as CanvasMediaData} />
      </TooltipProvider>
    </CanvasContext.Provider>,
  );
  expect(screen.getByText('同类素材总时长超过限制')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: '生成视频' }));
  expect(create).not.toHaveBeenCalled();
});

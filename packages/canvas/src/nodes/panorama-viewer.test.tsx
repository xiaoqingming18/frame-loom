import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasContext } from '../context';
import { createCanvasStore } from '../store/store';
import { doc } from '../test-utils';
import { createBuiltinRegistry } from './builtin';
import { PanoramaViewer } from './panorama-viewer';

const spies = vi.hoisted(() => ({
  dispose: vi.fn(),
  loss: vi.fn(),
  textureDispose: vi.fn(),
  lookAt: vi.fn(),
  render: vi.fn(),
  close: vi.fn(),
}));
vi.mock('three', () => ({
  WebGLRenderer: class {
    capabilities = { maxTextureSize: 4096 };
    domElement = document.createElement('canvas');
    setSize = vi.fn();
    render = spies.render;
    dispose = spies.dispose;
    forceContextLoss = spies.loss;
  },
  CanvasTexture: class {
    dispose = spies.textureDispose;
  },
  Scene: class {},
  PerspectiveCamera: class {
    lookAt = spies.lookAt;
    updateProjectionMatrix = vi.fn();
  },
  EquirectangularReflectionMapping: 303,
  SRGBColorSpace: 'srgb',
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('打开才加载、键盘环顾、滚轮与重置、关闭释放上下文与纹理', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob()) }),
  );
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn().mockResolvedValue({ width: 8000, height: 4000, close: spies.close }),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  const view = render(
    <CanvasContext.Provider
      value={{
        store: createCanvasStore(doc([])),
        registry: createBuiltinRegistry(),
        host: { media: { url: () => 'frame-media://hash', upload: vi.fn() } },
      }}
    >
      <PanoramaViewer nodeId="source" hash={'a'.repeat(64)} width={8000} onClose={vi.fn()} />
    </CanvasContext.Provider>,
  );
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '截取当前视角' }).disabled).toBe(
      false,
    ),
  );
  expect(createImageBitmap).toHaveBeenCalledTimes(2);
  const surface = screen.getByRole('application', { name: '全景视角' });
  fireEvent.keyDown(surface, { key: 'ArrowRight' });
  expect(spies.lookAt.mock.lastCall?.[2]).toBeGreaterThan(0);
  fireEvent.wheel(surface, { deltaY: 10000 });
  expect(screen.getByRole('status').textContent).toContain('110°');
  fireEvent.click(screen.getByRole('button', { name: '重置视角' }));
  expect(screen.getByRole('status').textContent).toContain('75°');
  view.unmount();
  expect(spies.dispose).toHaveBeenCalledOnce();
  expect(spies.loss).toHaveBeenCalledOnce();
  expect(spies.textureDispose).toHaveBeenCalledOnce();
  expect(spies.close).toHaveBeenCalledTimes(2);
});

it('加载失败显示可读错误，禁止截图', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('纹理不可用')));
  render(
    <CanvasContext.Provider
      value={{
        store: createCanvasStore(doc([])),
        registry: createBuiltinRegistry(),
        host: { media: { url: () => 'frame-media://hash', upload: vi.fn() } },
      }}
    >
      <PanoramaViewer nodeId="source" hash={'a'.repeat(64)} width={2880} onClose={vi.fn()} />
    </CanvasContext.Provider>,
  );
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('纹理不可用'));
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '截取当前视角' }).disabled).toBe(
    true,
  );
});

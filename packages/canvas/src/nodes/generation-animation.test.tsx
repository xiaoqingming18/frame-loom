import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GenerationAnimation } from './generation-animation';

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');

afterEach(() => {
  cleanup();
  if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
  else delete (Element.prototype as Partial<Element>).animate;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockAnimationEnvironment() {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const requestFrame = vi.fn((callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  const cancelFrame = vi.fn((id: number) => frames.delete(id));
  vi.stubGlobal('requestAnimationFrame', requestFrame);
  vi.stubGlobal('cancelAnimationFrame', cancelFrame);
  let resize = () => {};
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(180);
  return {
    width,
    observe,
    disconnect,
    cancelFrame,
    frames,
    resize: () => resize(),
    tick(now = 1000) {
      const [id, callback] = frames.entries().next().value!;
      frames.delete(id);
      callback(now);
    },
  };
}

it('视频创建 72 条错峰循环动画，仅尺寸改变时重建，卸载取消全部动画', () => {
  const env = mockAnimationEnvironment();
  const animations: { cancel: ReturnType<typeof vi.fn> }[] = [];
  const animate = vi.fn<(frames: Keyframe[], options: KeyframeAnimationOptions) => Animation>(
    () => {
      const animation = { cancel: vi.fn() };
      animations.push(animation);
      return animation as unknown as Animation;
    },
  );
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
  const { container, unmount } = render(<GenerationAnimation kind="video" />);
  const host = container.querySelector('.canvas-generation-tunnel')!;
  env.tick();
  expect(host.children).toHaveLength(72);
  expect(animate).toHaveBeenCalledTimes(72);
  for (const [keyframes, options] of animate.mock.calls) {
    expect(keyframes.map((frame) => frame.opacity)).toEqual([0, 1, 0]);
    expect(options.duration).toBeGreaterThanOrEqual(1800);
    expect(options.duration).toBeLessThanOrEqual(3400);
    expect(options.delay).toBeGreaterThanOrEqual(-Number(options.duration));
    expect(options.delay).toBeLessThanOrEqual(0);
    expect(options.iterations).toBe(Infinity);
  }
  env.resize();
  expect(animate).toHaveBeenCalledTimes(72);
  expect(animations.every((animation) => animation.cancel.mock.calls.length === 0)).toBe(true);
  env.width.mockReturnValue(640);
  env.resize();
  expect(animate).toHaveBeenCalledTimes(144);
  expect(
    animations.slice(0, 72).every((animation) => animation.cancel.mock.calls.length === 1),
  ).toBe(true);
  expect(host.children).toHaveLength(72);
  unmount();
  expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
  expect(host.children).toHaveLength(0);
  expect(env.disconnect).toHaveBeenCalledOnce();
  expect(env.cancelFrame).toHaveBeenCalledOnce();
});

it('音频实际绘制粒子，卸载取消下一帧并移除观察器和主题监听', () => {
  const env = mockAnimationEnvironment();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillStyle: '',
    globalCompositeOperation: 'source-over',
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  const visibilityObserve = vi.fn();
  const visibilityDisconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = visibilityObserve;
      disconnect = visibilityDisconnect;
    },
  );
  const theme = {
    matches: false,
    addEventListener: vi.fn<(type: string, listener: EventListener) => void>(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => theme),
  );
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: () => '42, 80, 130',
  } as unknown as CSSStyleDeclaration);
  const { container, unmount } = render(<GenerationAnimation kind="audio" />);
  const canvas = container.querySelector('canvas')!;
  expect(env.observe).toHaveBeenCalledWith(canvas.parentElement);
  expect(visibilityObserve).toHaveBeenCalledWith(canvas.parentElement);
  env.tick();
  expect(context.clearRect).toHaveBeenCalledWith(0, 0, 320, 180);
  expect(context.arc).toHaveBeenCalled();
  expect(context.fill).toHaveBeenCalled();
  expect(context.fillStyle).toContain('42, 80, 130');
  const [pendingFrame] = env.frames.keys();
  expect(env.frames.size).toBe(1);
  const themeListener = theme.addEventListener.mock.calls[0][1];
  unmount();
  expect(env.cancelFrame).toHaveBeenCalledExactlyOnceWith(pendingFrame);
  expect(env.frames.size).toBe(0);
  expect(env.disconnect).toHaveBeenCalledOnce();
  expect(visibilityDisconnect).toHaveBeenCalledOnce();
  expect(theme.removeEventListener).toHaveBeenCalledExactlyOnceWith('change', themeListener);
});

it('图像生成 15 列，雨滴时序在设计范围内，卸载清理列', () => {
  vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(0.999);
  const { container, unmount } = render(<GenerationAnimation kind="image" />);
  const host = container.querySelector('.canvas-generation-rain')!;
  expect(host.children).toHaveLength(15);
  const drops = host.querySelectorAll<HTMLElement>('.canvas-generation-drop');
  expect(drops).toHaveLength(15);
  for (const drop of drops) {
    expect(parseFloat(drop.style.animationDelay)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(drop.style.animationDelay)).toBeLessThanOrEqual(2);
    expect(parseFloat(drop.style.animationDuration)).toBeGreaterThanOrEqual(2);
    expect(parseFloat(drop.style.animationDuration)).toBeLessThanOrEqual(3.5);
  }
  unmount();
  expect(host.children).toHaveLength(0);
});

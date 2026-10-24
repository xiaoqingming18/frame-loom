import { expect, it, vi } from 'vitest';
import type { ThemeSource, WindowCommand } from '@frame-loom/contracts';

const mocks = vi.hoisted(() => ({
  expose: vi.fn(),
  invoke: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  removeListener: vi.fn(),
}));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.expose },
  ipcRenderer: { invoke: mocks.invoke, on: mocks.on, removeListener: mocks.removeListener },
}));
import './index.js';

it('只暴露固定频道的桌面桥接方法', async () => {
  const [name, api] = mocks.expose.mock.calls[0] as [
    string,
    {
      getEngineConnection(): Promise<unknown>;
      theme: { get(): Promise<unknown>; set(source: ThemeSource): Promise<unknown> };
      window: {
        command(name: WindowCommand): Promise<void>;
        isMaximized(): Promise<unknown>;
        onMaximizedChanged(callback: (value: unknown) => void): () => void;
      };
    },
  ];
  expect(name).toBe('frameLoom');
  expect(Object.keys(api)).toEqual(['getEngineConnection', 'theme', 'window']);
  await api.getEngineConnection();
  await api.theme.get();
  await api.theme.set('dark');
  await api.window.command('quit');
  await api.window.isMaximized();
  expect(mocks.invoke.mock.calls).toEqual([
    ['engine:connection'],
    ['theme:get'],
    ['theme:set', 'dark'],
    ['window:command', 'quit'],
    ['window:is-maximized'],
  ]);
  const callback = vi.fn();
  const unsubscribe = api.window.onMaximizedChanged(callback);
  const [channel, listener] = mocks.on.mock.calls[0] as [
    string,
    (event: unknown, value: unknown) => void,
  ];
  expect(channel).toBe('window:maximized');
  listener({ sender: '不应泄露' }, true);
  expect(callback).toHaveBeenCalledExactlyOnceWith(true);
  unsubscribe();
  expect(mocks.removeListener).toHaveBeenCalledWith('window:maximized', listener);
});

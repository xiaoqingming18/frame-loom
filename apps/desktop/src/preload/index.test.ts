import { expect, it, vi } from 'vitest';
import type { ThemeSource, WindowCommand } from '@frame-loom/contracts';

const mocks = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.expose },
  ipcRenderer: { invoke: mocks.invoke },
}));
import './index.js';

it('只暴露固定频道的桌面桥接方法', async () => {
  const [name, api] = mocks.expose.mock.calls[0] as [
    string,
    {
      getEngineConnection(): Promise<unknown>;
      theme: { get(): Promise<unknown>; set(source: ThemeSource): Promise<unknown> };
      window: { command(name: WindowCommand): Promise<void> };
    },
  ];
  expect(name).toBe('frameLoom');
  expect(Object.keys(api)).toEqual(['getEngineConnection', 'theme', 'window']);
  await api.getEngineConnection();
  await api.theme.get();
  await api.theme.set('dark');
  await api.window.command('quit');
  expect(mocks.invoke.mock.calls).toEqual([
    ['engine:connection'],
    ['theme:get'],
    ['theme:set', 'dark'],
    ['window:command', 'quit'],
  ]);
});

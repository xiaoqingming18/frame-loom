import { expect, it, vi } from 'vitest';
import type {
  DesktopPreferencesUpdate,
  PickDirectoryRequest,
  ProjectRevealRequest,
  ThemeSource,
  WindowCommand,
} from '@frame-loom/contracts';

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
      preferences: {
        get(): Promise<unknown>;
        set(value: DesktopPreferencesUpdate): Promise<unknown>;
      };
      pickDirectory(value: PickDirectoryRequest): Promise<unknown>;
      project: {
        reveal(value: ProjectRevealRequest): Promise<void>;
        trash(value: ProjectRevealRequest): Promise<void>;
      };
      getEngineConnection(): Promise<unknown>;
      onEngineExited(callback: (value: unknown) => void): () => void;
      theme: { get(): Promise<unknown>; set(source: ThemeSource): Promise<unknown> };
      window: {
        command(name: WindowCommand): Promise<void>;
        isMaximized(): Promise<unknown>;
        onMaximizedChanged(callback: (value: unknown) => void): () => void;
      };
    },
  ];
  expect(name).toBe('frameLoom');
  expect(Object.keys(api)).toEqual([
    'preferences',
    'pickDirectory',
    'project',
    'getEngineConnection',
    'onEngineExited',
    'theme',
    'window',
  ]);
  await api.getEngineConnection();
  await api.theme.get();
  await api.theme.set('dark');
  await api.window.command('quit');
  await api.window.isMaximized();
  await api.preferences.get();
  await api.preferences.set({ projectSort: 'name' });
  await api.pickDirectory({});
  const target = { projectId: '00000000-0000-4000-8000-000000000001' };
  await api.project.reveal(target);
  await api.project.trash(target);
  expect(mocks.invoke.mock.calls).toEqual([
    ['engine:connection'],
    ['theme:get'],
    ['theme:set', 'dark'],
    ['window:command', 'quit'],
    ['window:is-maximized'],
    ['preferences:get'],
    ['preferences:set', { projectSort: 'name' }],
    ['dialog:pick-directory', {}],
    ['project:reveal', target],
    ['project:trash', target],
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
  const exited = vi.fn();
  const stop = api.onEngineExited(exited);
  const [exitChannel, exitListener] = mocks.on.mock.calls[1] as [
    string,
    (event: unknown, value: unknown) => void,
  ];
  expect(exitChannel).toBe('engine:exited');
  exitListener({ sender: '不应泄露' }, 1);
  expect(exited).toHaveBeenCalledExactlyOnceWith(1);
  stop();
  expect(mocks.removeListener).toHaveBeenCalledWith('engine:exited', exitListener);
});

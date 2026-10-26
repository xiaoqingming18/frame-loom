import { afterEach, expect, it, vi } from 'vitest';
import {
  getEngineConnection,
  getTheme,
  setTheme,
  commandWindow,
  getWindowMaximized,
  onWindowMaximizedChanged,
  onEngineExited,
  getPreferences,
  setPreferences,
  pickDirectory,
  revealProject,
  trashProject,
} from './desktop-bridge';

afterEach(() => vi.unstubAllGlobals());

it('偏好、目录和项目操作按契约校验，拒绝空资产路径', async () => {
  const value = { version: 1, theme: 'dark', projectSort: 'name' };
  const get = vi.fn().mockResolvedValue(value);
  const set = vi.fn().mockResolvedValue(value);
  const pick = vi.fn().mockResolvedValue(null);
  const reveal = vi.fn().mockResolvedValue(undefined);
  const trash = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('frameLoom', {
    preferences: { get, set },
    pickDirectory: pick,
    project: { reveal, trash },
  });
  await expect(getPreferences()).resolves.toEqual(value);
  await expect(setPreferences({ projectSort: 'name' })).resolves.toEqual(value);
  await expect(pickDirectory()).resolves.toBeNull();
  pick.mockResolvedValue('D:\\Projects');
  await expect(pickDirectory({ defaultPath: 'D:\\Projects' })).resolves.toBe('D:\\Projects');
  const projectId = '00000000-0000-4000-8000-000000000001';
  await revealProject({ projectId });
  await trashProject({ projectId, path: 'asset.png' });
  expect(reveal).toHaveBeenCalledWith({ projectId });
  expect(trash).toHaveBeenCalledWith({ projectId, path: 'asset.png' });
  expect(() => trashProject({ projectId, path: '' })).toThrow();
  expect(trash).toHaveBeenCalledOnce();
  get.mockResolvedValue({ theme: 'invalid' });
  await expect(getPreferences()).rejects.toThrow();
});

it('通过 preload 读取连接，不在 renderer 保存全局连接副本', async () => {
  const connection = { baseUrl: 'http://127.0.0.1:45678', token: 'secret' };
  const getConnection = vi.fn().mockResolvedValue(connection);
  vi.stubGlobal('frameLoom', { getEngineConnection: getConnection });
  await expect(getEngineConnection()).resolves.toEqual(connection);
  expect(getConnection).toHaveBeenCalledOnce();
});

it('窗口状态只接受布尔值，并转交订阅清理函数', async () => {
  const isMaximized = vi.fn().mockResolvedValue(true);
  let listener!: (value: unknown) => void;
  const unsubscribe = vi.fn();
  vi.stubGlobal('frameLoom', {
    window: {
      isMaximized,
      onMaximizedChanged: (callback: typeof listener) => {
        listener = callback;
        return unsubscribe;
      },
    },
  });
  await expect(getWindowMaximized()).resolves.toBe(true);
  isMaximized.mockResolvedValue('true');
  await expect(getWindowMaximized()).rejects.toThrow();
  const callback = vi.fn();
  const cleanup = onWindowMaximizedChanged(callback);
  listener(false);
  expect(callback).toHaveBeenCalledExactlyOnceWith(false);
  expect(() => listener({ maximized: true })).toThrow();
  cleanup();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

it('engine 退出事件只接受整数或 null 退出码，并转交清理函数', () => {
  let listener!: (value: unknown) => void;
  const unsubscribe = vi.fn();
  vi.stubGlobal('frameLoom', {
    onEngineExited: (callback: typeof listener) => {
      listener = callback;
      return unsubscribe;
    },
  });
  const callback = vi.fn();
  const cleanup = onEngineExited(callback);
  listener(1);
  listener(null);
  expect(callback.mock.calls).toEqual([[1], [null]]);
  expect(() => listener('1')).toThrow();
  cleanup();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

it('通过固定方法读取与设置主题，校验返回值并转发窗口命令', async () => {
  const get = vi.fn().mockResolvedValue('system');
  const set = vi.fn().mockResolvedValue('dark');
  const command = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('frameLoom', { theme: { get, set }, window: { command } });
  await expect(getTheme()).resolves.toBe('system');
  await expect(setTheme('dark')).resolves.toBe('dark');
  expect(set).toHaveBeenCalledWith('dark');
  await commandWindow('minimize');
  expect(command).toHaveBeenCalledWith('minimize');
  get.mockResolvedValue('invalid');
  set.mockResolvedValue(null);
  await expect(getTheme()).rejects.toThrow();
  await expect(setTheme('dark')).rejects.toThrow();
});

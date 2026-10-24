import { afterEach, expect, it, vi } from 'vitest';
import { getEngineConnection, getTheme, setTheme, commandWindow } from './desktop-bridge';

afterEach(() => vi.unstubAllGlobals());

it('通过 preload 读取连接，不在 renderer 保存全局连接副本', async () => {
  const connection = { baseUrl: 'http://127.0.0.1:45678', token: 'secret' };
  const getConnection = vi.fn().mockResolvedValue(connection);
  vi.stubGlobal('frameLoom', { getEngineConnection: getConnection });
  await expect(getEngineConnection()).resolves.toEqual(connection);
  expect(getConnection).toHaveBeenCalledOnce();
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

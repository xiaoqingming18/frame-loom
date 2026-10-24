import { afterEach, expect, it, vi } from 'vitest';
import { getEngineConnection } from './desktop-bridge';

afterEach(() => vi.unstubAllGlobals());

it('通过 preload 读取连接，不在 renderer 保存全局连接副本', async () => {
  const connection = { baseUrl: 'http://127.0.0.1:45678', token: 'secret' };
  const getConnection = vi.fn().mockResolvedValue(connection);
  vi.stubGlobal('frameLoom', { getEngineConnection: getConnection });
  await expect(getEngineConnection()).resolves.toEqual(connection);
  expect(getConnection).toHaveBeenCalledOnce();
});

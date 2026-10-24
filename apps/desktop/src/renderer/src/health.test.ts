import { afterEach, expect, it, vi } from 'vitest';
import { fetchHealth } from './health';

afterEach(() => vi.unstubAllGlobals());

function setup(connection: unknown = { baseUrl: 'http://127.0.0.1:45678', token: 'secret' }) {
  vi.stubGlobal('window', {
    frameLoom: { getEngineConnection: vi.fn().mockResolvedValue(connection) },
  });
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

it('使用 Bearer 请求健康接口并校验响应', async () => {
  const fetch = setup();
  const health = {
    status: 'ok',
    engineVersion: '0.1.0',
    schemaVersion: '1',
    startedAt: '2026-10-24T00:00:00Z',
  };
  fetch.mockResolvedValue(Response.json(health));
  await expect(fetchHealth(new AbortController().signal)).resolves.toEqual(health);
  expect(fetch).toHaveBeenCalledWith(
    'http://127.0.0.1:45678/health',
    expect.objectContaining({ headers: { Authorization: 'Bearer secret' } }),
  );
});

it('连接无效时不发送带令牌的请求', async () => {
  const fetch = setup({ baseUrl: 'https://example.com', token: 'secret' });
  await expect(fetchHealth(new AbortController().signal)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

it('HTTP 错误和不符合契约的响应不会显示为健康', async () => {
  const fetch = setup();
  fetch.mockResolvedValue(new Response(null, { status: 401 }));
  await expect(fetchHealth(new AbortController().signal)).rejects.toThrow('HTTP 401');
  fetch.mockResolvedValue(Response.json({ status: 'ok' }));
  await expect(fetchHealth(new AbortController().signal)).rejects.toThrow();
});

it('健康请求使用调用者的取消信号', async () => {
  const fetch = setup();
  const controller = new AbortController();
  fetch.mockImplementation((_url, options: RequestInit) => {
    expect(options.signal?.aborted).toBe(true);
    return Promise.reject(new Error('请求已取消'));
  });
  controller.abort();
  await expect(fetchHealth(controller.signal)).rejects.toThrow('请求已取消');
});

import { afterEach, expect, it, vi } from 'vitest';
import { HealthResponse } from '@frame-loom/contracts';
import { createEngineClient, EngineRequestError } from './engine-client';

const connection = { baseUrl: 'http://127.0.0.1:45678', token: 'secret' };
const health = {
  status: 'ok',
  engineVersion: '0.1.0',
  schemaVersion: '1',
  startedAt: '2026-10-24T00:00:00Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup() {
  const getConnection = vi.fn<() => Promise<unknown>>().mockResolvedValue(connection);
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(() => Promise.resolve(Response.json(health)));
  vi.stubGlobal('fetch', fetch);
  return { getConnection, fetch, client: createEngineClient(getConnection) };
}

it('并发和后续请求共用连接，保留请求头并校验成功响应', async () => {
  const { client, getConnection, fetch } = setup();
  await expect(
    Promise.all([
      client.request('/health', HealthResponse),
      client.request('/health', HealthResponse, { headers: { Accept: 'application/json' } }),
    ]),
  ).resolves.toEqual([health, health]);
  await client.request('/health', HealthResponse);
  expect(getConnection).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[1];
  expect(url).toBe(`${connection.baseUrl}/health`);
  expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer secret');
  expect(new Headers(init?.headers).get('Accept')).toBe('application/json');
  expect(init?.redirect).toBe('error');
});

it('获取连接失败后下一次请求重新获取', async () => {
  const { client, getConnection, fetch } = setup();
  getConnection.mockRejectedValueOnce(new Error('IPC 已断开'));
  await expect(client.request('/health', HealthResponse)).rejects.toMatchObject({
    code: 'CONNECTION_FAILED',
    message: '无法连接本地引擎，请重新启动应用',
  });
  expect(fetch).not.toHaveBeenCalled();
  await expect(client.request('/health', HealthResponse)).resolves.toEqual(health);
  expect(getConnection).toHaveBeenCalledTimes(2);
});

it('非法连接不能携带令牌发出请求，修正后重新获取', async () => {
  const { client, getConnection, fetch } = setup();
  getConnection.mockResolvedValueOnce({ ...connection, baseUrl: 'https://example.com' });
  await expect(client.request('/health', HealthResponse)).rejects.toBeInstanceOf(
    EngineRequestError,
  );
  expect(fetch).not.toHaveBeenCalled();
  await expect(client.request('/health', HealthResponse)).resolves.toEqual(health);
});

it('拒绝向其他源和带用户信息的地址发送令牌', async () => {
  const { client, fetch } = setup();
  for (const path of [
    'https://example.com/health',
    '//example.com/health',
    'http://user@127.0.0.1:45678/health',
  ]) {
    await expect(client.request(path, HealthResponse)).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
  }
  expect(fetch).not.toHaveBeenCalled();
});

it('错误响应转换为有状态码、业务码和中文消息的 EngineRequestError', async () => {
  const { client, fetch, getConnection } = setup();
  fetch.mockResolvedValueOnce(
    Response.json({ code: 'HTTP_401', message: '访问令牌无效' }, { status: 401 }),
  );
  await expect(client.request('/health', HealthResponse)).rejects.toMatchObject({
    name: 'EngineRequestError',
    status: 401,
    code: 'HTTP_401',
    message: '访问令牌无效',
  });
  await client.request('/health', HealthResponse);
  expect(getConnection).toHaveBeenCalledTimes(2);
});

it('非法错误体回退到中文 HTTP 提示', async () => {
  const { client, fetch } = setup();
  for (const response of [
    new Response('Internal Server Error', { status: 500 }),
    Response.json({ message: '缺少 code' }, { status: 500 }),
  ]) {
    fetch.mockResolvedValueOnce(response);
    await expect(client.request('/health', HealthResponse)).rejects.toMatchObject({
      status: 500,
      code: 'HTTP_500',
      message: '本地服务请求失败（HTTP 500）',
    });
  }
});

it('成功响应也必须是合法 JSON 且符合 schema', async () => {
  const { client, fetch } = setup();
  for (const response of [new Response('invalid'), Response.json({ status: 'ok' })]) {
    fetch.mockResolvedValueOnce(response);
    await expect(client.request('/health', HealthResponse)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: '本地服务返回的数据无效',
    });
  }
});

it('网络失败后清除连接缓存', async () => {
  const { client, fetch, getConnection } = setup();
  fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await expect(client.request('/health', HealthResponse)).rejects.toMatchObject({
    code: 'CONNECTION_FAILED',
  });
  await expect(client.request('/health', HealthResponse)).resolves.toEqual(health);
  expect(getConnection).toHaveBeenCalledTimes(2);
});

it('默认使用五秒超时并返回中文错误', async () => {
  const { client, fetch } = setup();
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  fetch.mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener(
          'abort',
          () => reject(new DOMException('Timeout', 'TimeoutError')),
          { once: true },
        );
        controller.abort(new DOMException('Timeout', 'TimeoutError'));
      }),
  );
  await expect(client.request('/health', HealthResponse)).rejects.toMatchObject({
    code: 'REQUEST_TIMEOUT',
    message: '本地服务请求超时，请重试',
  });
  expect(timeout).toHaveBeenCalledWith(5_000);
});

it('等待首次连接期间不启动 HTTP 超时，避免误报冷启动失败', async () => {
  const { client, getConnection } = setup();
  let resolveConnection!: (value: unknown) => void;
  getConnection.mockReturnValue(
    new Promise((resolve) => {
      resolveConnection = resolve;
    }),
  );
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  const response = client.request('/health', HealthResponse);
  await vi.waitFor(() => expect(getConnection).toHaveBeenCalledOnce());
  expect(timeout).not.toHaveBeenCalled();
  resolveConnection(connection);
  await expect(response).resolves.toEqual(health);
  expect(timeout).toHaveBeenCalledWith(5_000);
});

it('保留调用者取消信号，已取消的请求不发出', async () => {
  const { client, fetch } = setup();
  const controller = new AbortController();
  controller.abort();
  await expect(
    client.request('/health', HealthResponse, { signal: controller.signal }),
  ).rejects.toMatchObject({
    code: 'REQUEST_ABORTED',
    message: '本地服务请求已取消',
  });
  expect(fetch).not.toHaveBeenCalled();
});

import { afterEach, expect, it, vi } from 'vitest';
import { EngineEvent, HealthResponse } from '@frame-loom/contracts';
import { createEngineClient, EngineRequestError } from './engine-client';

const connection = { baseUrl: 'http://127.0.0.1:45678', token: 'secret' };
const health = {
  status: 'ok',
  engineVersion: '0.1.0',
  schemaVersion: '1',
  startedAt: '2026-10-24T00:00:00Z',
};
it('带进度上传使用可信连接与鉴权，透传进度、服务端错误及取消', async () => {
  const requests: UploadRequest[] = [];
  class UploadRequest {
    status = 200;
    responseText = JSON.stringify(health);
    headers = new Headers();
    upload = {
      onprogress:
        vi.fn<(event: { lengthComputable: boolean; loaded: number; total: number }) => void>(),
    };
    onload = () => {};
    onerror = () => {};
    onabort = () => {};
    onloadend = () => {};
    open = vi.fn();
    setRequestHeader(name: string, value: string) {
      this.headers.set(name, value);
    }
    getResponseHeader() {
      return 'application/json';
    }
    send = vi.fn(() => requests.push(this));
    abort() {
      this.onabort();
      this.onloadend();
    }
  }
  vi.stubGlobal('XMLHttpRequest', UploadRequest);
  const { client, fetch } = setup();
  const progress = vi.fn();
  const controller = new AbortController();
  const pending = client.request('/projects/id/assets/files', HealthResponse, {
    method: 'POST',
    body: new Blob(['x']),
    onUploadProgress: progress,
    signal: controller.signal,
  });
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  const xhr = requests[0];
  expect(xhr.open).toHaveBeenCalledWith('POST', `${connection.baseUrl}/projects/id/assets/files`);
  expect(xhr.headers.get('Authorization')).toBe('Bearer secret');
  expect(xhr.headers.get('Content-Type')).toBe('application/octet-stream');
  xhr.upload.onprogress({ lengthComputable: true, loaded: 1, total: 2 });
  expect(progress).toHaveBeenCalledWith(50);
  xhr.onload();
  xhr.onloadend();
  await expect(pending).resolves.toEqual(health);
  expect(fetch).not.toHaveBeenCalled();
  const failed = client.request('/upload', HealthResponse, {
    method: 'POST',
    body: new Blob(['x']),
    onUploadProgress: progress,
  });
  const assertion = expect(failed).rejects.toMatchObject({
    code: 'ASSET_NAME_CONFLICT',
    message: '同名文件',
  });
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  requests[1].status = 409;
  requests[1].responseText = JSON.stringify({ code: 'ASSET_NAME_CONFLICT', message: '同名文件' });
  requests[1].onload();
  requests[1].onloadend();
  await assertion;
  const cancelled = client.request('/upload', HealthResponse, {
    method: 'POST',
    body: new Blob(['x']),
    onUploadProgress: progress,
    signal: controller.signal,
  });
  const cancellation = expect(cancelled).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
  await vi.waitFor(() => expect(requests).toHaveLength(3));
  controller.abort();
  await cancellation;
});

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

it.each(['POST', 'PATCH', 'PUT', 'DELETE'])('%s 支持 JSON 请求体且保留鉴权', async (method) => {
  const { client, fetch } = setup();
  await client.request('/resource', HealthResponse, {
    method,
    body: { name: '中文', enabled: true },
  });
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe(`${connection.baseUrl}/resource`);
  expect(init?.method).toBe(method);
  expect(init?.body).toBe(JSON.stringify({ name: '中文', enabled: true }));
  expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
  expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer secret');
});

function eventResponse(chunks: Uint8Array[], cancel = vi.fn()) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
      cancel,
    }),
    { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } },
  );
}

it('事件流解析多行 data、注释、CRLF 与跨块中文，并与普通请求共用连接', async () => {
  const { client, fetch, getConnection } = setup();
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  const event = { type: 'generation.job.updated', jobId: '中文任务' };
  const bytes = new TextEncoder().encode(
    `: keepalive\r\nevent: message\r\ndata: {"type":"generation.job.updated",\r\ndata: "jobId":"中文任务"}\r\n\r\ndata: ${JSON.stringify(health)}\n`,
  );
  fetch.mockResolvedValueOnce(eventResponse(Array.from(bytes, (byte) => Uint8Array.of(byte))));
  const events: unknown[] = [];
  for await (const value of client.stream('/events', EngineEvent)) events.push(value);
  expect(events).toEqual([event]);
  expect(timeout).not.toHaveBeenCalled();
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe(`${connection.baseUrl}/events`);
  expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer secret');
  expect(new Headers(init?.headers).get('Accept')).toBe('text/event-stream');
  expect(init?.redirect).toBe('error');
  await client.request('/health', HealthResponse);
  expect(getConnection).toHaveBeenCalledOnce();
});

it.each(['not-json', '{"type":"unknown"}', '{"type":"generation.job.updated"}'])(
  '非法事件立即报错，不自动重连：%s',
  async (data) => {
    const { client, fetch, getConnection } = setup();
    fetch.mockResolvedValueOnce(eventResponse([new TextEncoder().encode(`data: ${data}\n\n`)]));
    const iterator = client.stream('/events', EngineEvent);
    await expect(iterator.next()).rejects.toMatchObject({ code: 'INVALID_EVENT' });
    expect(fetch).toHaveBeenCalledOnce();
    await client.request('/health', HealthResponse);
    expect(getConnection).toHaveBeenCalledTimes(2);
  },
);

it.each(['\n', '\r\n', '\r'])(
  '按 SSE 规范支持换行符 %j，完整事件在 EOF 前派发',
  async (newline) => {
    const { client, fetch } = setup();
    const event = { type: 'generation.job.updated', jobId: 'one' };
    fetch.mockResolvedValueOnce(
      eventResponse([
        new TextEncoder().encode(`data: ${JSON.stringify(event)}${newline}${newline}`),
      ]),
    );
    const events = [];
    for await (const value of client.stream('/events', EngineEvent)) events.push(value);
    expect(events).toEqual([event]);
  },
);

it('错误 HTTP 响应、错误内容类型和读流断线保留统一错误处理', async () => {
  const { client, fetch } = setup();
  fetch.mockResolvedValueOnce(
    Response.json({ code: 'HTTP_401', message: '访问令牌无效' }, { status: 401 }),
  );
  await expect(client.stream('/events', EngineEvent).next()).rejects.toMatchObject({
    status: 401,
    code: 'HTTP_401',
  });
  fetch.mockResolvedValueOnce(Response.json({}));
  await expect(client.stream('/events', EngineEvent).next()).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
  });
  fetch.mockResolvedValueOnce(
    new Response(
      new ReadableStream({ start: (controller) => controller.error(new Error('断线')) }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    ),
  );
  await expect(client.stream('/events', EngineEvent).next()).rejects.toMatchObject({
    code: 'CONNECTION_FAILED',
  });
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('流地址同样不能向其他源发送 token', async () => {
  const { client, fetch } = setup();
  await expect(
    client.stream('https://evil.example/events', EngineEvent).next(),
  ).rejects.toMatchObject({
    code: 'INVALID_PATH',
  });
  expect(fetch).not.toHaveBeenCalled();
});

it('取消事件流会中止正在等待的读取，提前结束迭代也会断开连接', async () => {
  const { client, fetch } = setup();
  const controller = new AbortController();
  controller.abort();
  await expect(
    client.stream('/events', EngineEvent, { signal: controller.signal }).next(),
  ).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
  expect(fetch).not.toHaveBeenCalled();

  const active = new AbortController();
  fetch.mockImplementationOnce((_url, init) => {
    return Promise.resolve(
      new Response(
        new ReadableStream({
          start(stream) {
            init!.signal!.addEventListener('abort', () => stream.error(init!.signal!.reason), {
              once: true,
            });
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
  });
  const iterator = client.stream('/events', EngineEvent, { signal: active.signal });
  const next = iterator.next();
  const rejected = expect(next).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  active.abort();
  await rejected;

  const cancel = vi.fn();
  fetch.mockResolvedValueOnce(
    new Response(
      new ReadableStream({
        start(stream) {
          stream.enqueue(
            new TextEncoder().encode('data: {"type":"generation.job.updated","jobId":"one"}\n\n'),
          );
        },
        cancel,
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    ),
  );
  for await (const event of client.stream('/events', EngineEvent)) {
    expect(event).toEqual({ type: 'generation.job.updated', jobId: 'one' });
    break;
  }
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[1][1]?.signal?.aborted).toBe(true);
});

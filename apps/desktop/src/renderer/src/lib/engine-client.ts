import { EngineConnection, ErrorResponse } from '@frame-loom/contracts';

type EngineRequestInit = Omit<RequestInit, 'body'> & { body?: unknown; timeoutMs?: number };

export class EngineRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EngineRequestError';
  }
}

export function createEngineClient(getConnection: () => Promise<unknown>) {
  let connection: Promise<EngineConnection> | undefined;

  const connect = () =>
    (connection ??= Promise.resolve().then(async () =>
      EngineConnection.parse(await getConnection()),
    ));

  async function send(
    path: string,
    { baseUrl, token }: EngineConnection,
    init: EngineRequestInit,
    signal: AbortSignal,
  ): Promise<Response> {
    signal.throwIfAborted();
    const url = new URL(path, baseUrl);
    if (url.origin !== baseUrl || url.username || url.password) {
      throw new EngineRequestError(0, 'INVALID_PATH', '本地服务请求地址无效');
    }
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (init.body !== undefined) headers.set('Content-Type', 'application/json');
    const requestInit = Object.fromEntries(
      Object.entries(init).filter(([key]) => key !== 'timeoutMs'),
    ) as RequestInit;
    const response = await fetch(url.href, {
      ...requestInit,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      headers,
      signal,
      redirect: 'error',
    });
    if (!response.ok) {
      const error = ErrorResponse.safeParse(await response.json().catch(() => null));
      throw new EngineRequestError(
        response.status,
        error.success ? error.data.code : `HTTP_${response.status}`,
        error.success ? error.data.message : `本地服务请求失败（HTTP ${response.status}）`,
      );
    }
    return response;
  }

  function requestError(
    error: unknown,
    pending: Promise<EngineConnection>,
    signal?: AbortSignal,
  ): EngineRequestError {
    if (connection === pending) connection = undefined;
    if (error instanceof EngineRequestError) return error;
    if (signal?.aborted) {
      if (signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError') {
        return new EngineRequestError(0, 'REQUEST_TIMEOUT', '本地服务请求超时，请重试');
      }
      return new EngineRequestError(0, 'REQUEST_ABORTED', '本地服务请求已取消');
    }
    return new EngineRequestError(0, 'CONNECTION_FAILED', '无法连接本地引擎，请重新启动应用');
  }

  return {
    async request<T>(
      path: string,
      schema: { parse(value: unknown): T },
      init: EngineRequestInit = {},
    ): Promise<T> {
      const pending = connect();
      let signal: AbortSignal | undefined;
      try {
        const current = await pending;
        // 冷启动由主进程的 ready 超时约束，五秒仅限制 HTTP 请求。
        signal = AbortSignal.any([
          ...(init.signal ? [init.signal] : []),
          AbortSignal.timeout(init.timeoutMs ?? 5_000),
        ]);
        const response = await send(path, current, init, signal);
        try {
          return schema.parse(await response.json());
        } catch (error) {
          if (signal.aborted) throw error;
          throw new EngineRequestError(
            response.status,
            'INVALID_RESPONSE',
            '本地服务返回的数据无效',
          );
        }
      } catch (error) {
        throw requestError(error, pending, signal);
      }
    },

    async *stream<T>(
      path: string,
      schema: { parse(value: unknown): T },
      init: EngineRequestInit = {},
    ): AsyncGenerator<T> {
      const pending = connect();
      const controller = new AbortController();
      const signal = init.signal
        ? AbortSignal.any([init.signal, controller.signal])
        : controller.signal;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const headers = new Headers(init.headers);
        headers.set('Accept', 'text/event-stream');
        // 长连接不套用普通请求的五秒超时；取消和重连由调用方决定。
        const response = await send(path, await pending, { ...init, headers }, signal);
        if (
          response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !==
            'text/event-stream' ||
          !response.body
        ) {
          throw new EngineRequestError(response.status, 'INVALID_RESPONSE', '本地服务未返回事件流');
        }
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let data: string[] = [];
        while (true) {
          signal.throwIfAborted();
          const { value, done } = await reader.read();
          signal.throwIfAborted();
          buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
          if (done && buffer.endsWith('\r')) buffer += '\n';
          let separator: RegExpExecArray | null;
          // 尾部的 CR 留到下一块，避免跨块 CRLF 被误判为空行。
          while ((separator = /\r\n|\n|\r(?!$)/.exec(buffer))) {
            const line = buffer.slice(0, separator.index);
            buffer = buffer.slice(separator.index + separator[0].length);
            if (line === '') {
              if (data.length) {
                let event: T;
                try {
                  event = schema.parse(JSON.parse(data.join('\n')));
                } catch {
                  throw new EngineRequestError(200, 'INVALID_EVENT', '本地服务返回的事件无效');
                }
                data = [];
                yield event;
              }
            } else if (line === 'data' || line.startsWith('data:')) {
              data.push(line === 'data' ? '' : line.slice(5).replace(/^ /, ''));
            }
          }
          if (done) break;
        }
      } catch (error) {
        throw requestError(error, pending, signal);
      } finally {
        controller.abort();
        if (reader) {
          try {
            await reader.cancel();
          } catch {
            // 连接已断开时仍需释放读取锁。
          }
          reader.releaseLock();
        }
      }
    },
  };
}

export type EngineClient = ReturnType<typeof createEngineClient>;

import { EngineConnection, ErrorResponse } from '@frame-loom/contracts';

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

  return {
    async request<T>(
      path: string,
      schema: { parse(value: unknown): T },
      init: RequestInit = {},
    ): Promise<T> {
      const pending = (connection ??= Promise.resolve().then(async () =>
        EngineConnection.parse(await getConnection()),
      ));
      let signal: AbortSignal | undefined;
      try {
        const { baseUrl, token } = await pending;
        // 冷启动由主进程的 ready 超时约束，五秒仅限制 HTTP 请求。
        signal = AbortSignal.any([
          ...(init.signal ? [init.signal] : []),
          AbortSignal.timeout(5_000),
        ]);
        signal.throwIfAborted();
        const url = new URL(path, baseUrl);
        if (url.origin !== baseUrl || url.username || url.password) {
          throw new EngineRequestError(0, 'INVALID_PATH', '本地服务请求地址无效');
        }
        const headers = new Headers(init.headers);
        headers.set('Authorization', `Bearer ${token}`);
        const response = await fetch(url.href, { ...init, headers, signal, redirect: 'error' });
        if (!response.ok) {
          const error = ErrorResponse.safeParse(await response.json().catch(() => null));
          throw new EngineRequestError(
            response.status,
            error.success ? error.data.code : `HTTP_${response.status}`,
            error.success ? error.data.message : `本地服务请求失败（HTTP ${response.status}）`,
          );
        }
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
        if (connection === pending) connection = undefined;
        if (error instanceof EngineRequestError) throw error;
        if (signal?.aborted) {
          if (signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError') {
            throw new EngineRequestError(0, 'REQUEST_TIMEOUT', '本地服务请求超时，请重试');
          }
          throw new EngineRequestError(0, 'REQUEST_ABORTED', '本地服务请求已取消');
        }
        throw new EngineRequestError(0, 'CONNECTION_FAILED', '无法连接本地引擎，请重新启动应用');
      }
    },
  };
}

export type EngineClient = ReturnType<typeof createEngineClient>;

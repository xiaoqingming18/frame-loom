import type { AuthDriver, GenerationErrorCategory } from '@frame-loom/contracts';
import { DomainError } from '../../../core/http/domain-error.js';
import type { AdapterContext, Credentials, HttpCall, HttpResult } from './types.js';

export class GenerationFailure extends Error {
  constructor(
    readonly category: GenerationErrorCategory,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export function providerError(status: number): DomainError {
  if (status === 401 || status === 403)
    return new DomainError('AUTH_FAILED', 422, '鉴权失败，请检查密钥与权限');
  if (status === 429) return new DomainError('RATE_LIMITED', 422, '上游限流，请稍后重试');
  return new DomainError('UPSTREAM_ERROR', 422, `上游请求失败（HTTP ${status}）`);
}
export function connectionError(error: unknown, signal?: AbortSignal): DomainError {
  if (error instanceof DomainError) return error;
  if (signal?.aborted)
    return new DomainError(
      signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
        ? 'REQUEST_TIMEOUT'
        : 'REQUEST_ABORTED',
      422,
      '请求超时或已取消',
    );
  return new DomainError('CONNECTION_FAILED', 422, '无法连接，请检查地址和网络');
}
export function classifyHttpError(status: number) {
  return new GenerationFailure(
    status === 401 || status === 403
      ? 'auth'
      : status === 429
        ? 'rate_limit'
        : status >= 500
          ? 'upstream'
          : 'invalid_params',
    `HTTP_${status}`,
    providerError(status).message,
  );
}
export function authHeaders(
  driver: AuthDriver,
  credentials: Credentials,
  fixedHeaders: Record<string, string> = {},
): Record<string, string> {
  const headers = { ...credentials.headers, ...fixedHeaders };
  if (driver === 'bearer') headers.Authorization = `Bearer ${credentials.apiKey}`;
  else
    headers[driver === 'token' ? 'Authorization' : driver] =
      driver === 'token' ? `Token ${credentials.apiKey}` : credentials.apiKey;
  return headers;
}
export function writePath(body: Record<string, unknown>, path: string, value: unknown) {
  const segments = path.split('.');
  if (
    !/^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*){0,7}$/.test(path) ||
    segments.some((key) => ['__proto__', 'prototype', 'constructor'].includes(key))
  )
    throw new GenerationFailure('invalid_params', 'INVALID_FIELD_PATH', '附加字段路径不安全');
  let target = body;
  for (const key of segments.slice(0, -1)) {
    if (target[key] === undefined) target[key] = {};
    if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key]))
      throw new GenerationFailure(
        'invalid_params',
        'FIELD_PATH_CONFLICT',
        '附加字段路径与请求内容冲突',
      );
    target = target[key] as Record<string, unknown>;
  }
  target[segments.at(-1)!] = value;
}
export function applyExtras(
  body: Record<string, unknown>,
  extras: AdapterContext['snapshot']['extras'],
  fixedFields: AdapterContext['snapshot']['fixedFields'],
  values: Record<string, string | number | boolean>,
) {
  for (const param of extras) {
    const value = values[param.key] ?? param.default;
    if (value !== undefined) writePath(body, param.path, value);
  }
  for (const field of fixedFields) writePath(body, field.path, field.value);
}
export async function prepareCall(call: HttpCall): Promise<HttpCall> {
  // 先编码 multipart，边界与文件一并计入上限，实际发送复用同一份字节。
  let body = call.body;
  let headers = call.headers;
  if (body instanceof FormData) {
    const encoded = new Response(body);
    const minimum = [...body.values()].reduce(
      (total, value) => total + (typeof value === 'string' ? Buffer.byteLength(value) : value.size),
      0,
    );
    if (minimum > 64 * 1024 * 1024)
      throw new GenerationFailure('invalid_params', 'REQUEST_TOO_LARGE', '请求体超过 64MB');
    body = new Uint8Array(await encoded.arrayBuffer());
    headers = { ...headers, 'Content-Type': encoded.headers.get('content-type')! };
  }
  const bytes =
    typeof body === 'string'
      ? new TextEncoder().encode(body).length
      : body instanceof Uint8Array
        ? body.byteLength
        : 0;
  if (bytes > 64 * 1024 * 1024)
    throw new GenerationFailure('invalid_params', 'REQUEST_TOO_LARGE', '请求体超过 64MB');
  return { ...call, body, headers };
}
export async function send(
  call: HttpCall,
  ctx: Pick<AdapterContext, 'signal' | 'diagnose'> & Partial<Pick<AdapterContext, 'credentials'>>,
  timeoutMs = 60_000,
): Promise<HttpResult> {
  const { body, headers } = await prepareCall(call);
  const url = new URL(call.url);
  const secrets = ctx.credentials
    ? [ctx.credentials.apiKey, ctx.credentials.secretKey, ...Object.values(ctx.credentials.headers)]
    : [];
  const redact = (value: string) =>
    secrets.filter(Boolean).reduce((text, secret) => text.split(secret).join('[已隐藏]'), value);
  const diagnostic = {
    stage:
      call.operation === 'query'
        ? ('query' as const)
        : call.operation === 'content'
          ? ('download' as const)
          : call.operation === 'cancel'
            ? ('cancel' as const)
            : ('submit' as const),
    method: call.method,
    route: redact(url.pathname),
  };
  ctx.diagnose(diagnostic);
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(call.url, {
      method: call.method,
      headers,
      body: body as BodyInit | undefined,
      redirect: 'error',
      signal: AbortSignal.any([ctx.signal, timeout]),
    });
    const requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id');
    ctx.diagnose({
      ...diagnostic,
      httpStatus: response.status,
      ...(requestId
        ? {
            requestId: redact(requestId)
              .replace(/[^\x20-\x7e\u4e00-\u9fff]/g, '')
              .slice(0, 128),
          }
        : {}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw classifyHttpError(response.status);
    }
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength > 64 * 1024 * 1024)
      throw new GenerationFailure('upstream', 'RESPONSE_TOO_LARGE', '上游响应超过 64MB');
    return {
      status: response.status,
      headers: response.headers,
      bytes: data,
      responseAudio: call.responseAudio,
    };
  } catch (error) {
    if (timeout.aborted && !ctx.signal.aborted)
      throw new GenerationFailure(
        'timeout',
        'RESPONSE_TIMEOUT',
        call.operation === 'submit' || call.operation === 'edit'
          ? '等待上游生成结果超时，远端可能已受理并计费，请勿直接重试'
          : '等待上游响应超时',
      );
    throw error;
  }
}

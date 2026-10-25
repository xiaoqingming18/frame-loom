import { DomainError } from '../../core/http/domain-error.js';

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

import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { EngineConfig } from '../config/config.js';
import { EngineGuard } from './engine.guard.js';

const token = 'ab'.repeat(32);
const guard = new EngineGuard(new EngineConfig(token, '/', ['app://frame-loom']));
const context = (authorization?: string) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
  }) as ExecutionContext;
const request = (host?: string, origin?: string) =>
  ({
    headers: { host, origin },
    socket: { localPort: 45678 },
  }) as Request;

describe('令牌守卫', () => {
  it.each([
    undefined,
    '',
    'Basic abc',
    `bearer ${token}`,
    `Bearer ${'0'.repeat(64)}`,
    `Bearer ${'a'.repeat(63)}`,
    `Bearer ${'中'.repeat(64)}`,
  ])('拒绝无效认证头', (authorization) => {
    expect(() => guard.canActivate(context(authorization))).toThrow(UnauthorizedException);
  });

  it('接受完全匹配的 Bearer 令牌', () => {
    expect(guard.canActivate(context(`Bearer ${token}`))).toBe(true);
  });
});

describe('Host 与来源边界', () => {
  it.each([
    undefined,
    'localhost:45678',
    'evil.example:45678',
    '127.0.0.1:45679',
    '127.0.0.1',
    '127.0.0.1:045678',
  ])('拒绝错误 Host（%s）', (host) => {
    expect(() => guard.checkBoundary(request(host))).toThrow(ForbiddenException);
  });

  it.each(['null', 'https://evil.example', 'app://other'])('拒绝未授权源（%s）', (origin) => {
    expect(() => guard.checkBoundary(request('127.0.0.1:45678', origin))).toThrow(
      ForbiddenException,
    );
  });

  it.each([undefined, 'app://frame-loom'])('接受允许源或 Node 调试请求', (origin) => {
    expect(() => guard.checkBoundary(request('127.0.0.1:45678', origin))).not.toThrow();
  });
});

import { ErrorResponse, HealthResponse } from '@frame-loom/contracts';
import { Logger, type INestApplication } from '@nestjs/common';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEngine } from './application.js';
import { EngineConfig } from './core/config/config.js';
import { SecretCipher } from './core/crypto/secret-cipher.js';
import { EngineLogger } from './core/logging/engine-logger.js';

const token = 'a'.repeat(64);
let app: INestApplication<Server>;
let port: number;
let directory: string;
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'frame-loom-http-'));
  app = await createEngine(
    new EngineConfig(
      token,
      directory,
      ['http://localhost:5173', 'app://frame-loom'],
      'cd'.repeat(32),
    ),
  );
  await app.listen(0, '127.0.0.1');
  port = (app.getHttpServer().address() as AddressInfo).port;
});
afterAll(async () => {
  await app?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

function call(headers: Record<string, string> = {}, method = 'GET') {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>(
    (resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/health', method, headers }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      });
      req.on('error', reject);
      req.end();
    },
  );
}

describe('真实 HTTP 边界', () => {
  it('字段加密登记的明文也被 Nest 与注入的日志实例屏蔽', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      app.get(SecretCipher).encrypt('runtime-provider-secret', 'channels', 'one');
      new Logger('Integration').error('第三方错误 runtime-provider-secret');
      app.get(EngineLogger).warn('runtime-provider-secret');
      const output = stderr.mock.calls.flat().join('');
      expect(output).toContain('[REDACTED]');
      expect(output).not.toContain('runtime-provider-secret');
    } finally {
      stderr.mockRestore();
    }
  });

  it.each<Record<string, string>>([{}, { Authorization: `Bearer ${'b'.repeat(64)}` }])(
    '缺失或错误令牌返回 401',
    async (headers) => {
      const response = await call(headers);
      expect(response.status).toBe(401);
      expect(ErrorResponse.parse(JSON.parse(response.body))).toEqual({
        code: 'HTTP_401',
        message: '访问令牌无效',
      });
    },
  );

  it('持有正确令牌仍不能使用错误 Host', async () => {
    const response = await call({ Authorization: `Bearer ${token}`, Host: `evil.example:${port}` });
    expect(response.status).toBe(403);
    expect(ErrorResponse.parse(JSON.parse(response.body)).code).toBe('HTTP_403');
  });

  it('正确请求返回符合共享契约的健康响应', async () => {
    const response = await call({ Authorization: `Bearer ${token}` });
    expect(response.status).toBe(200);
    expect(HealthResponse.parse(JSON.parse(response.body))).toMatchObject({
      engineVersion: '0.1.0',
      schemaVersion: '1',
    });
  });

  it.each(['http://localhost:5173', 'app://frame-loom'])('允许 renderer 源 %s', async (Origin) => {
    const response = await call({ Authorization: `Bearer ${token}`, Origin });
    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(Origin);
  });

  it.each(['null', 'https://evil.example', 'http://localhost:5174'])(
    '主动拒绝外部源 %s',
    async (Origin) => {
      const response = await call({ Authorization: `Bearer ${token}`, Origin });
      expect(response.status).toBe(403);
      expect(ErrorResponse.parse(JSON.parse(response.body)).code).toBe('HTTP_403');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    },
  );

  it('可信预检无需 Bearer，但后续实际请求仍须鉴权', async () => {
    const response = await call(
      {
        Origin: 'app://frame-loom',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
      'OPTIONS',
    );
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('app://frame-loom');
    expect(response.headers['access-control-allow-headers']).toBe('Authorization,Content-Type');
    expect(response.headers['access-control-allow-methods']).toBe('GET,POST,PATCH,PUT,DELETE');
    const unauthorized = await call({ Origin: 'app://frame-loom' });
    expect(unauthorized.status).toBe(401);
    expect(ErrorResponse.parse(JSON.parse(unauthorized.body)).code).toBe('HTTP_401');
  });

  it('预检也检查 Host 和 Origin', async () => {
    const requests: Record<string, string>[] = [
      {},
      { Origin: 'https://evil.example' },
      { Origin: 'app://frame-loom', Host: 'evil.example' },
    ];
    for (const headers of requests) {
      const response = await call(
        {
          ...headers,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type',
        },
        'OPTIONS',
      );
      expect(response.status).toBe(403);
      expect(ErrorResponse.parse(JSON.parse(response.body)).code).toBe('HTTP_403');
    }
  });
});

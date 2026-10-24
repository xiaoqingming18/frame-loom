import { ErrorResponse } from '@frame-loom/contracts';
import { Controller, Get, HttpException, Query, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppModule } from '../../app.module.js';
import { EngineConfig } from '../config/config.js';
import { EngineLogger } from '../logging/engine-logger.js';
import { DomainError } from './domain-error.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const token = 'cd'.repeat(32);
const querySchema = z.object({ name: z.string().min(1, '名称不能为空') });

@Controller('test-errors')
class ErrorController {
  @Get('domain')
  domain(): never {
    throw new DomainError('PROJECT_CONFLICT', 409, '项目已存在');
  }

  @Get('validation')
  validation(@Query(new ZodValidationPipe(querySchema)) query: z.infer<typeof querySchema>) {
    return query;
  }

  @Get('http')
  http(): never {
    throw new HttpException('不应直接返回的第三方错误详情', 418);
  }

  @Get('unknown')
  unknown(): never {
    throw new Error(`数据库内部路径；Authorization: Bearer ${token}`);
  }

  @Get('non-error')
  nonError(): never {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- 模拟第三方抛出非 Error 值。
    throw '非 Error 异常';
  }
}

let app: INestApplication<Server>;
let baseUrl: string;
let directory: string;
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'frame-loom-errors-'));
  const logger = new EngineLogger(token);
  const module = await Test.createTestingModule({
    imports: [AppModule.register(new EngineConfig(token, directory, []), logger)],
    controllers: [ErrorController],
  }).compile();
  app = module.createNestApplication({ logger });
  await app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(async () => {
  await app?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

async function call(path: string) {
  const response = await fetch(`${baseUrl}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body: unknown = await response.json();
  const parsed = ErrorResponse.parse(body);
  expect(body).toEqual(parsed);
  return { status: response.status, body: parsed };
}

it('领域异常使用自身的状态码、code 和中文消息', async () => {
  expect(await call('test-errors/domain')).toEqual({
    status: 409,
    body: { code: 'PROJECT_CONFLICT', message: '项目已存在' },
  });
});

it('按参数使用的 pipe 把 ZodError 映射为 400 与 issues', async () => {
  expect(await call('test-errors/validation?name=')).toEqual({
    status: 400,
    body: {
      code: 'VALIDATION_FAILED',
      message: '请求参数无效',
      issues: [{ path: 'name', message: '名称不能为空' }],
    },
  });
});

it('其他 HTTP 异常保留状态码，使用中文消息', async () => {
  expect(await call('test-errors/http')).toEqual({
    status: 418,
    body: { code: 'HTTP_418', message: '请求失败' },
  });
});

it('未匹配路由也使用错误契约和中文消息', async () => {
  expect(await call('missing')).toEqual({
    status: 404,
    body: { code: 'HTTP_404', message: '请求的接口不存在' },
  });
});

it.each(['unknown', 'non-error'])('未知异常 %s 只把脱敏详情写入日志', async (path) => {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    expect(await call(`test-errors/${path}`)).toEqual({
      status: 500,
      body: { code: 'INTERNAL', message: '本地服务内部错误' },
    });
    const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('未处理的 engine 异常');
    expect(output).not.toContain(token);
    if (path === 'unknown') {
      expect(output).toContain('数据库内部路径');
      expect(output).toContain('ErrorController.unknown');
    } else {
      expect(output).toContain('非 Error 异常');
    }
  } finally {
    stderr.mockRestore();
  }
});

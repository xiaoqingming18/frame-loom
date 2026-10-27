import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ErrorResponse } from '@frame-loom/contracts';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { DomainError } from './domain-error.js';

const httpMessages: Record<number, string> = {
  400: '请求参数无效',
  401: '访问令牌无效',
  403: '请求不被允许',
  404: '请求的接口不存在',
  500: '本地服务内部错误',
};

@Catch()
export class EngineExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(EngineExceptionFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    let status = 500;
    let body: ErrorResponse = { code: 'INTERNAL', message: '本地服务内部错误' };
    if (error instanceof DomainError) {
      status = error.status;
      body = {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      };
    } else if (error instanceof ZodError) {
      status = 400;
      body = {
        code: 'VALIDATION_FAILED',
        message: '请求参数无效',
        issues: error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      };
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      body = { code: `HTTP_${status}`, message: httpMessages[status] ?? '请求失败' };
    } else {
      this.logger.error('未处理的 engine 异常', error instanceof Error ? error.stack : error);
    }
    host.switchToHttp().getResponse<Response>().status(status).json(body);
  }
}

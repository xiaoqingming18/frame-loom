import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { EngineConfig } from '../config/config.js';

@Injectable()
export class EngineGuard implements CanActivate {
  private readonly authorization: Buffer;

  constructor(private readonly config: EngineConfig) {
    this.authorization = Buffer.from(`Bearer ${config.token}`);
  }

  checkBoundary(request: Request): void {
    if (request.headers.host !== `127.0.0.1:${request.socket.localPort}`) {
      throw new ForbiddenException('请求 Host 不受信任');
    }
    const origin = request.headers.origin;
    if (
      (request.method === 'OPTIONS' && origin === undefined) ||
      (origin !== undefined && !this.config.allowedOrigins.includes(origin))
    ) {
      throw new ForbiddenException('请求来源不受信任');
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = Buffer.from(request.headers.authorization ?? '');
    if (
      provided.length !== this.authorization.length ||
      !timingSafeEqual(provided, this.authorization)
    ) {
      throw new UnauthorizedException('访问令牌无效');
    }
    return true;
  }
}

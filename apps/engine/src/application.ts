import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Server } from 'node:http';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module.js';
import { EngineConfig } from './core/config/config.js';
import { EngineGuard } from './core/security/engine.guard.js';
import { EngineLogger } from './core/logging/engine-logger.js';
import type { NestExpressApplication } from '@nestjs/platform-express';

export async function createEngine(
  config: EngineConfig,
  logger = new EngineLogger(config.token, config.secretKey),
): Promise<INestApplication<Server>> {
  const app = await NestFactory.create<NestExpressApplication<Server>>(
    AppModule.register(config, logger),
    {
      logger,
      abortOnError: false,
    },
  );
  const guard = app.get(EngineGuard);
  // 内联参考图受 contracts 与档案双重限制；默认 100 KiB 无法承载图片。
  app.useBodyParser('json', { limit: '32mb' });
  app.use((request: Request, _response: Response, next: NextFunction) => {
    try {
      guard.checkBoundary(request);
      next();
    } catch (error) {
      next(error);
    }
  });
  app.enableCors({
    origin: config.allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });
  return app;
}

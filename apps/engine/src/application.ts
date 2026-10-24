import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Server } from 'node:http';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module.js';
import { EngineConfig } from './core/config/config.js';
import { EngineGuard } from './core/security/engine.guard.js';
import { EngineLogger } from './core/logging/engine-logger.js';

export async function createEngine(
  config: EngineConfig,
  logger = new EngineLogger(config.token, config.secretKey),
): Promise<INestApplication<Server>> {
  const app = await NestFactory.create<INestApplication<Server>>(
    AppModule.register(config, logger),
    {
      logger,
      abortOnError: false,
    },
  );
  const guard = app.get(EngineGuard);
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

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module.js';
import { EngineConfig } from './config.js';
import { EngineGuard } from './engine.guard.js';

export async function createEngine(config: EngineConfig) {
  const app = await NestFactory.create(AppModule.register(config), {
    logger: false,
    abortOnError: false,
  });
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
    methods: ['GET'],
    allowedHeaders: ['Authorization'],
  });
  return app;
}

import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Server } from 'node:http';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module.js';
import { EngineConfig } from './config.js';
import { EngineGuard } from './engine.guard.js';

export async function createEngine(config: EngineConfig): Promise<INestApplication<Server>> {
  const app = await NestFactory.create<INestApplication<Server>>(AppModule.register(config), {
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

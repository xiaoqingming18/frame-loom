import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EngineConfig } from './config.js';
import { DatabaseService } from './database.service.js';
import { EngineGuard } from './engine.guard.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({
  controllers: [HealthController],
  providers: [DatabaseService, HealthService, EngineGuard, { provide: APP_GUARD, useExisting: EngineGuard }],
})
export class AppModule {
  static register(config: EngineConfig): DynamicModule {
    return { module: AppModule, providers: [{ provide: EngineConfig, useValue: config }] };
  }
}

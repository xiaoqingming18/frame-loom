import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EngineConfig } from './config/config.js';
import { DatabaseService } from './database/database.service.js';
import { EngineGuard } from './security/engine.guard.js';

@Global()
@Module({
  providers: [DatabaseService, EngineGuard, { provide: APP_GUARD, useExisting: EngineGuard }],
  exports: [EngineConfig, DatabaseService, EngineGuard],
})
export class CoreModule {
  static register(config: EngineConfig): DynamicModule {
    return { module: CoreModule, providers: [{ provide: EngineConfig, useValue: config }] };
  }
}

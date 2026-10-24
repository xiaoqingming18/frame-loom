import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { EngineConfig } from './config/config.js';
import { DatabaseService } from './database/database.service.js';
import { EngineGuard } from './security/engine.guard.js';
import { EngineExceptionFilter } from './http/engine-exception.filter.js';

@Global()
@Module({
  providers: [
    DatabaseService,
    EngineGuard,
    { provide: APP_GUARD, useExisting: EngineGuard },
    { provide: APP_FILTER, useClass: EngineExceptionFilter },
  ],
  exports: [EngineConfig, DatabaseService, EngineGuard],
})
export class CoreModule {
  static register(config: EngineConfig): DynamicModule {
    return { module: CoreModule, providers: [{ provide: EngineConfig, useValue: config }] };
  }
}

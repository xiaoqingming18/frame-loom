import { Module, type DynamicModule } from '@nestjs/common';
import { EngineConfig } from './core/config/config.js';
import { CoreModule } from './core/core.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { EngineLogger } from './core/logging/engine-logger.js';

@Module({})
export class AppModule {
  static register(config: EngineConfig, logger: EngineLogger): DynamicModule {
    return { module: AppModule, imports: [CoreModule.register(config, logger), HealthModule] };
  }
}

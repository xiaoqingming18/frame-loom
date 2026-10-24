import { Module, type DynamicModule } from '@nestjs/common';
import { EngineConfig } from './core/config/config.js';
import { CoreModule } from './core/core.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({})
export class AppModule {
  static register(config: EngineConfig): DynamicModule {
    return { module: AppModule, imports: [CoreModule.register(config), HealthModule] };
  }
}

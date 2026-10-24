import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { EngineConfig } from './config/config.js';
import { DatabaseService } from './database/database.service.js';
import { EngineGuard } from './security/engine.guard.js';
import { EngineExceptionFilter } from './http/engine-exception.filter.js';
import { EngineLogger } from './logging/engine-logger.js';
import { SecretCipher } from './crypto/secret-cipher.js';
import { EventBus } from './events/event-bus.js';
import { EventsController } from './events/events.controller.js';

@Global()
@Module({
  controllers: [EventsController],
  providers: [
    SecretCipher,
    EventBus,
    DatabaseService,
    EngineGuard,
    { provide: APP_GUARD, useExisting: EngineGuard },
    { provide: APP_FILTER, useClass: EngineExceptionFilter },
  ],
  exports: [EngineConfig, DatabaseService, EngineGuard, EngineLogger, SecretCipher, EventBus],
})
export class CoreModule {
  static register(config: EngineConfig, logger: EngineLogger): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: EngineConfig, useValue: config },
        { provide: EngineLogger, useValue: logger },
      ],
    };
  }
}

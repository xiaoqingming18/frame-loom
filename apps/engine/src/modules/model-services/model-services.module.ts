import { Module } from '@nestjs/common';
import { ModelServicesRepository } from './model-services.repository.js';
import { ModelServicesService } from './model-services.service.js';
import { ModelServicesController } from './model-services.controller.js';
import { CatalogService } from './catalog.service.js';
import { VoicesService } from './voices.service.js';
import { ProtocolRegistry } from '../generation/protocols/registry.js';
import { LlmService } from '../llm/llm.service.js';

@Module({
  controllers: [ModelServicesController],
  providers: [
    ModelServicesRepository,
    ModelServicesService,
    CatalogService,
    VoicesService,
    ProtocolRegistry,
    LlmService,
  ],
  exports: [ModelServicesRepository, ProtocolRegistry],
})
export class ModelServicesModule {}

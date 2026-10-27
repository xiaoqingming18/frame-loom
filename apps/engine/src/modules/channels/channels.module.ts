import { Module } from '@nestjs/common';
import { ChannelsController } from './channels.controller.js';
import { ChannelsRepository } from './channels.repository.js';
import { ChannelsService } from './channels.service.js';
import { LlmService } from '../llm/llm.service.js';
import { ModelCatalogService } from './model-catalog.service.js';
import { VoicesService } from './voices.service.js';

@Module({
  controllers: [ChannelsController],
  providers: [ChannelsRepository, ChannelsService, LlmService, ModelCatalogService, VoicesService],
  exports: [ChannelsRepository, ModelCatalogService],
})
export class ChannelsModule {}

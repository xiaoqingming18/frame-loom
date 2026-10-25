import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module.js';
import { GenerationController } from './generation.controller.js';
import { GenerationAdapters, GenerationService } from './generation.service.js';
import { MediaService } from './media.service.js';

@Module({
  imports: [ChannelsModule],
  controllers: [GenerationController],
  providers: [GenerationAdapters, GenerationService, MediaService],
})
export class GenerationModule {}

import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module.js';
import { GenerationController } from './generation.controller.js';
import { GenerationAdapters, GenerationService } from './generation.service.js';
import { MediaService } from './media.service.js';
import { ObjectStorageModule } from '../object-storage/object-storage.module.js';

@Module({
  imports: [ChannelsModule, ObjectStorageModule],
  controllers: [GenerationController],
  providers: [GenerationAdapters, GenerationService, MediaService],
})
export class GenerationModule {}

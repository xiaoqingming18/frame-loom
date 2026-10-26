import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module.js';
import { GenerationController } from './generation.controller.js';
import { GenerationAdapters, GenerationService } from './generation.service.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ObjectStorageModule } from '../object-storage/object-storage.module.js';

@Module({
  imports: [ChannelsModule, ObjectStorageModule, ProjectsModule],
  controllers: [GenerationController],
  providers: [GenerationAdapters, GenerationService],
})
export class GenerationModule {}

import { Module } from '@nestjs/common';
import { ModelServicesModule } from '../model-services/model-services.module.js';
import { GenerationController } from './generation.controller.js';
import { GenerationService } from './generation.service.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ObjectStorageModule } from '../object-storage/object-storage.module.js';

@Module({
  imports: [ModelServicesModule, ObjectStorageModule, ProjectsModule],
  controllers: [GenerationController],
  providers: [GenerationService],
})
export class GenerationModule {}

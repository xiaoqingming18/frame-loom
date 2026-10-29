import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { EpisodesController } from './episodes.controller.js';
import { EpisodesService } from './episodes.service.js';
import { StoryService } from './story.service.js';
import { StoryController } from './story.controller.js';
import { ModelServicesModule } from '../model-services/model-services.module.js';
import { ConversionService } from './conversion.service.js';
import { ConversionController } from './conversion.controller.js';

@Module({
  imports: [ProjectsModule, ModelServicesModule],
  controllers: [EpisodesController, StoryController, ConversionController],
  providers: [EpisodesService, StoryService, ConversionService],
})
export class ScriptsModule {}

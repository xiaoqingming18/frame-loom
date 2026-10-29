import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { EpisodesController } from './episodes.controller.js';
import { EpisodesService } from './episodes.service.js';
import { StoryService } from './story.service.js';
import { StoryController } from './story.controller.js';

@Module({
  imports: [ProjectsModule],
  controllers: [EpisodesController, StoryController],
  providers: [EpisodesService, StoryService],
})
export class ScriptsModule {}

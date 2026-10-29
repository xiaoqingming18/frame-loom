import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { EpisodesController } from './episodes.controller.js';
import { EpisodesService } from './episodes.service.js';

@Module({
  imports: [ProjectsModule],
  controllers: [EpisodesController],
  providers: [EpisodesService],
})
export class ScriptsModule {}

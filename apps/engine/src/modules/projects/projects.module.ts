import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { ProjectStore } from './project-store.js';
import { LocalProjectStore } from './local-project-store.js';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, { provide: ProjectStore, useClass: LocalProjectStore }],
  exports: [ProjectStore, ProjectsService],
})
export class ProjectsModule {}

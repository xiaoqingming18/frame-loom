import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { ProjectStore } from './project-store.js';
import { LocalProjectStore } from './local-project-store.js';
import { ProjectFilesService } from './project-files.service.js';
import { ProjectMediaService } from './project-media.service.js';
import { ProjectAssetsService } from './project-assets.service.js';
import { ProjectContentController } from './project-content.controller.js';
import { ProjectTagsController } from './project-tags.controller.js';
import { ProjectTagsService } from './project-tags.service.js';
import { MediaService } from '../generation/media.service.js';
import { ProjectScriptDatabase } from './project-script-database.js';

@Module({
  controllers: [ProjectsController, ProjectContentController, ProjectTagsController],
  providers: [
    ProjectScriptDatabase,
    ProjectsService,
    ProjectTagsService,
    ProjectFilesService,
    MediaService,
    ProjectMediaService,
    ProjectAssetsService,
    { provide: ProjectStore, useClass: LocalProjectStore },
  ],
  exports: [
    ProjectStore,
    ProjectScriptDatabase,
    ProjectsService,
    ProjectFilesService,
    MediaService,
    ProjectMediaService,
  ],
})
export class ProjectsModule {}

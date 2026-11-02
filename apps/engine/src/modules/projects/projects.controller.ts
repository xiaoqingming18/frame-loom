import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import {
  ProjectId,
  ProjectPageId,
  ProjectCreateRequest,
  ProjectOpenRequest,
  ProjectRelocateRequest,
  ProjectRenameRequest,
  ProjectPageCreateRequest,
  ProjectPageRenameRequest,
  ProjectPageSaveRequest,
  ProjectProfile,
  CanvasView,
} from '@frame-loom/contracts';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { ProjectsService } from './projects.service.js';

const idPipe = new ZodValidationPipe(ProjectId);
const pagePipe = new ZodValidationPipe(ProjectPageId);

@Controller('projects')
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}
  @Get() list() {
    return this.service.list();
  }
  @Post() create(@Body(new ZodValidationPipe(ProjectCreateRequest)) input: ProjectCreateRequest) {
    return this.service.create(input);
  }
  @Post('open') open(@Body(new ZodValidationPipe(ProjectOpenRequest)) input: ProjectOpenRequest) {
    return this.service.open(input);
  }
  @Post(':id/relocate') relocate(
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ProjectRelocateRequest)) input: ProjectRelocateRequest,
  ) {
    return this.service.relocate(id, input.rootPath);
  }
  @Get(':id') manifest(@Param('id', idPipe) id: string) {
    return this.service.manifest(id);
  }
  @Patch(':id') rename(
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ProjectRenameRequest)) input: ProjectRenameRequest,
  ) {
    return this.service.rename(id, input.name);
  }
  @Delete(':id') remove(@Param('id', idPipe) id: string) {
    return this.service.remove(id);
  }
  @Post(':id/release') release(@Param('id', idPipe) id: string) {
    return this.service.release(id);
  }
  @Post(':id/pages') createPage(
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ProjectPageCreateRequest)) input: ProjectPageCreateRequest,
  ) {
    return this.service.createPage(id, input);
  }
  @Patch(':id/pages/:pageId') renamePage(
    @Param('id', idPipe) id: string,
    @Param('pageId', pagePipe) pageId: string,
    @Body(new ZodValidationPipe(ProjectPageRenameRequest)) input: ProjectPageRenameRequest,
  ) {
    return this.service.renamePage(id, pageId, input);
  }
  @Delete(':id/pages/:pageId') deletePage(
    @Param('id', idPipe) id: string,
    @Param('pageId', pagePipe) pageId: string,
  ) {
    return this.service.deletePage(id, pageId);
  }
  @Put(':id/profile') saveProfile(
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ProjectProfile)) profile: ProjectProfile,
  ) {
    return this.service.saveProfile(id, profile);
  }
  @Get(':id/pages/:pageId') loadPage(
    @Param('id', idPipe) id: string,
    @Param('pageId', pagePipe) pageId: string,
  ) {
    return this.service.loadPage(id, pageId);
  }
  @Put(':id/pages/:pageId') savePage(
    @Param('id', idPipe) id: string,
    @Param('pageId', pagePipe) pageId: string,
    @Body(new ZodValidationPipe(ProjectPageSaveRequest)) input: ProjectPageSaveRequest,
  ) {
    return this.service.savePage(id, pageId, input);
  }
  @Put(':id/pages/:pageId/view') saveView(
    @Param('id', idPipe) id: string,
    @Param('pageId', pagePipe) pageId: string,
    @Body(new ZodValidationPipe(CanvasView)) view: CanvasView,
  ) {
    return this.service.saveView(id, pageId, view);
  }
}

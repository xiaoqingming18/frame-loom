import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  ProjectId,
  ProjectTagCreateRequest,
  ProjectTagDeleteRequest,
  ProjectTagUpdateRequest,
  TagId,
} from '@frame-loom/contracts';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { ProjectTagsService } from './project-tags.service.js';

const idPipe = new ZodValidationPipe(ProjectId);
const tagPipe = new ZodValidationPipe(TagId);

@Controller('projects/:id/tags')
export class ProjectTagsController {
  constructor(private readonly tags: ProjectTagsService) {}

  @Get() list(@Param('id', idPipe) id: string) {
    return this.tags.list(id);
  }

  @Post() create(
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ProjectTagCreateRequest)) input: ProjectTagCreateRequest,
  ) {
    return this.tags.create(id, input);
  }

  @Patch(':tagId') update(
    @Param('id', idPipe) id: string,
    @Param('tagId', tagPipe) tagId: string,
    @Body(new ZodValidationPipe(ProjectTagUpdateRequest)) input: ProjectTagUpdateRequest,
  ) {
    return this.tags.update(id, tagId, input);
  }

  @Get(':tagId/usages') usages(
    @Param('id', idPipe) id: string,
    @Param('tagId', tagPipe) tagId: string,
  ) {
    return this.tags.findUsages(id, tagId);
  }

  @Post(':tagId/delete') remove(
    @Param('id', idPipe) id: string,
    @Param('tagId', tagPipe) tagId: string,
    @Body(new ZodValidationPipe(ProjectTagDeleteRequest)) input: ProjectTagDeleteRequest,
  ) {
    return this.tags.remove(id, tagId, input);
  }
}

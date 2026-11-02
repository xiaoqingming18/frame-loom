import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  ProjectId,
  StoryBatchRequest,
  StoryElementCreateRequest,
  StoryElementMergeRequest,
  StoryElementUpdateRequest,
  StoryRestoreRequest,
} from '@frame-loom/contracts';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { StoryService } from './story.service.js';

const idPipe = new ZodValidationPipe(ProjectId);
@Controller('projects/:id/story')
export class StoryController {
  constructor(private readonly service: StoryService) {}
  @Get() list(@Param('id', idPipe) id: string) {
    return this.service.list(id);
  }
  @Post('elements') create(
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(StoryElementCreateRequest)) input: StoryElementCreateRequest,
  ) {
    return this.service.create(id, input);
  }
  @Patch('elements/:elementId') update(
    @Param('id', idPipe) id: string,
    @Param('elementId', idPipe) elementId: string,
    @Body(new ZodValidationPipe(StoryElementUpdateRequest)) input: StoryElementUpdateRequest,
  ) {
    return this.service.update(id, elementId, input);
  }
  @Post('elements/:elementId/merge') merge(
    @Param('id', idPipe) id: string,
    @Param('elementId', idPipe) elementId: string,
    @Body(new ZodValidationPipe(StoryElementMergeRequest)) input: StoryElementMergeRequest,
  ) {
    return this.service.merge(id, elementId, input);
  }
  @Delete('elements/:elementId') remove(
    @Param('id', idPipe) id: string,
    @Param('elementId', idPipe) elementId: string,
  ) {
    return this.service.remove(id, elementId);
  }
  @Get('elements/:elementId/occurrences') occurrences(
    @Param('id', idPipe) id: string,
    @Param('elementId', idPipe) elementId: string,
  ) {
    return this.service.findOccurrences(id, elementId);
  }
  @Post('ignored/restore') restore(
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(StoryRestoreRequest)) input: StoryRestoreRequest,
  ) {
    return this.service.restore(id, input.kind, input.name);
  }
  @Post('batch') batch(
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(StoryBatchRequest)) input: StoryBatchRequest,
  ) {
    return this.service.batch(id, input.ids, input.action);
  }
}

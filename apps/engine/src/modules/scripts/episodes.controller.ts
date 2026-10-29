import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import {
  EpisodeCreateRequest,
  EpisodeUpdateRequest,
  ProjectId,
  ScriptSaveRequest,
} from '@frame-loom/contracts';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { EpisodesService } from './episodes.service.js';

const idPipe = new ZodValidationPipe(ProjectId);

@Controller('projects/:id/episodes')
export class EpisodesController {
  constructor(private readonly service: EpisodesService) {}
  @Get() list(@Param('id', idPipe) id: string) {
    return this.service.list(id);
  }
  @Post() create(
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(EpisodeCreateRequest)) input: EpisodeCreateRequest,
  ) {
    return this.service.create(id, input);
  }
  @Patch(':episodeId') update(
    @Param('id', idPipe) id: string,
    @Param('episodeId', idPipe) episodeId: string,
    @Body(new ZodValidationPipe(EpisodeUpdateRequest)) input: EpisodeUpdateRequest,
  ) {
    return this.service.update(id, episodeId, input);
  }
  @Delete(':episodeId') delete(
    @Param('id', idPipe) id: string,
    @Param('episodeId', idPipe) episodeId: string,
  ) {
    return this.service.delete(id, episodeId);
  }
  @Get(':episodeId/script') read(
    @Param('id', idPipe) id: string,
    @Param('episodeId', idPipe) episodeId: string,
  ) {
    return this.service.read(id, episodeId);
  }
  @Put(':episodeId/script') save(
    @Param('id', idPipe) id: string,
    @Param('episodeId', idPipe) episodeId: string,
    @Body(new ZodValidationPipe(ScriptSaveRequest)) input: ScriptSaveRequest,
  ) {
    return this.service.save(id, episodeId, input);
  }
}

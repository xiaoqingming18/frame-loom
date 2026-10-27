import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { GenerationRequest } from '@frame-loom/contracts';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { GenerationService } from './generation.service.js';
import { mediaProfiles } from './profiles/media-profiles.js';
import { MediaService } from './media.service.js';
import { DomainError } from '../../core/http/domain-error.js';
import { retiredVideoIds } from '../channels/video-retirement.js';

@Controller()
export class GenerationController {
  constructor(
    private readonly generation: GenerationService,
    private readonly media: MediaService,
  ) {}
  @Get('model-profiles') profiles() {
    return mediaProfiles.filter(
      (profile) =>
        profile.kind !== 'video' || !profile.matchIds.some((id) => retiredVideoIds.includes(id)),
    );
  }
  @Post('media') upload(@Req() request: Request) {
    if (request.headers['content-type'] !== 'application/octet-stream')
      throw new DomainError('INVALID_MEDIA_UPLOAD', 415, '请使用二进制媒体上传');
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      request.destroy();
    }, 120_000);
    request.once('aborted', () => controller.abort());
    return this.media.saveStream(request, controller.signal).finally(() => clearTimeout(timer));
  }
  @Get('generation-jobs') jobs() {
    return this.generation.list();
  }
  @Get('generation-jobs/:id') job(@Param('id') id: string) {
    return this.generation.get(id);
  }
  @Post('generation-jobs') create(
    @Body(new ZodValidationPipe(GenerationRequest)) input: GenerationRequest,
  ) {
    return this.generation.create(input);
  }
  @Post('generation-jobs/:id/cancel') cancel(@Param('id') id: string) {
    return this.generation.cancel(id);
  }
  @Delete('generation-jobs/:id') remove(@Param('id') id: string) {
    return this.generation.remove(id);
  }
  @Post('generation-jobs/:id/cancel-remote') cancelRemote(@Param('id') id: string) {
    return this.generation.cancelRemote(id);
  }
  @Post('generation-jobs/:id/resubmit') resubmit(@Param('id') id: string) {
    return this.generation.resubmit(id);
  }
  @Post('generation-jobs/:id/requery') requery(@Param('id') id: string) {
    return this.generation.requery(id);
  }
}

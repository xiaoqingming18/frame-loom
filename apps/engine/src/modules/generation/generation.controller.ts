import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { GenerationRequest } from '@frame-loom/contracts';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { GenerationService } from './generation.service.js';
import { imageProfiles } from './profiles/image-profiles.js';

@Controller()
export class GenerationController {
  constructor(private readonly generation: GenerationService) {}
  @Get('model-profiles') profiles() {
    return imageProfiles;
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
  @Post('generation-jobs/:id/resubmit') resubmit(@Param('id') id: string) {
    return this.generation.resubmit(id);
  }
  @Post('generation-jobs/:id/requery') requery(@Param('id') id: string) {
    return this.generation.requery(id);
  }
}

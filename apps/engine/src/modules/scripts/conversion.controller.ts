import { Body, Controller, Delete, HttpCode, Param, Post } from '@nestjs/common';
import { ProjectId, ScriptImportRequest } from '@frame-loom/contracts';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { ConversionService } from './conversion.service.js';

const idPipe = new ZodValidationPipe(ProjectId);
@Controller('projects/:id/episodes/:episodeId/script/import')
export class ConversionController {
  constructor(private readonly service: ConversionService) {}
  @Post()
  @HttpCode(202)
  import(
    @Param('id', idPipe) id: string,
    @Param('episodeId', idPipe) episodeId: string,
    @Body(new ZodValidationPipe(ScriptImportRequest)) input: ScriptImportRequest,
  ) {
    return this.service.import(id, episodeId, input);
  }
  @Post('cancel') cancel(
    @Param('id', idPipe) id: string,
    @Param('episodeId', idPipe) episodeId: string,
  ) {
    return this.service.cancel(id, episodeId);
  }
  @Delete() discard(
    @Param('id', idPipe) id: string,
    @Param('episodeId', idPipe) episodeId: string,
  ) {
    return this.service.discard(id, episodeId);
  }
}

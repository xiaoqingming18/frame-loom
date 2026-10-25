import { Body, Controller, Get, Param, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CanvasId, CanvasSaveRequest, CanvasView } from '@frame-loom/contracts';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { CanvasRepository } from './canvas.repository.js';

@Controller('canvases')
export class CanvasController {
  constructor(private readonly repository: CanvasRepository) {}

  @Get(':id')
  load(@Param('id', new ZodValidationPipe(CanvasId)) id: string, @Res() response: Response) {
    return response.json(this.repository.load(id));
  }

  @Put(':id')
  save(
    @Param('id', new ZodValidationPipe(CanvasId)) id: string,
    @Body(new ZodValidationPipe(CanvasSaveRequest)) input: CanvasSaveRequest,
  ) {
    return this.repository.save(id, input);
  }

  @Put(':id/view')
  saveView(
    @Param('id', new ZodValidationPipe(CanvasId)) id: string,
    @Body(new ZodValidationPipe(CanvasView)) view: CanvasView,
  ) {
    return this.repository.saveView(id, view);
  }
}

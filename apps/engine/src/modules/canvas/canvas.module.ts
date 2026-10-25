import { Module } from '@nestjs/common';
import { CanvasController } from './canvas.controller.js';
import { CanvasRepository } from './canvas.repository.js';

@Module({ controllers: [CanvasController], providers: [CanvasRepository] })
export class CanvasModule {}

import { Body, Controller, Delete, Get, Module, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ObjectStorageWrite } from '@frame-loom/contracts';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { ObjectStorageService } from './object-storage.service.js';

@Controller('object-storage')
class ObjectStorageController {
  constructor(private readonly storage: ObjectStorageService) {}
  @Get() get(@Res() response: Response) {
    response.json(this.storage.get());
  }
  @Put() save(@Body(new ZodValidationPipe(ObjectStorageWrite)) body: ObjectStorageWrite) {
    return this.storage.save(body);
  }
  @Delete() remove(@Res() response: Response) {
    response.json(this.storage.remove());
  }
  @Post('test') test() {
    return this.storage.test();
  }
}
@Module({
  controllers: [ObjectStorageController],
  providers: [ObjectStorageService],
  exports: [ObjectStorageService],
})
export class ObjectStorageModule {}

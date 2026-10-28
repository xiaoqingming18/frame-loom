import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Res } from '@nestjs/common';
import { z } from 'zod';
import { once } from 'node:events';
import type { Response } from 'express';
import { PROTOCOLS, TestChatRequest, VoiceWrite } from '@frame-loom/contracts';
import {
  ChannelWrite,
  ChannelPatch,
  CatalogRequest,
  ModelWrite,
  ModelExport,
  ModelDefaultsPatch,
  type ModelDefaults,
} from '@frame-loom/contracts/model-service';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { ModelServicesRepository } from './model-services.repository.js';
import { ModelServicesService } from './model-services.service.js';
import { CatalogService } from './catalog.service.js';
import { VoicesService } from './voices.service.js';
import { LlmService } from '../llm/llm.service.js';

@Controller()
export class ModelServicesController {
  constructor(
    private readonly repository: ModelServicesRepository,
    private readonly services: ModelServicesService,
    private readonly catalog: CatalogService,
    private readonly voices: VoicesService,
    private readonly llm: LlmService,
  ) {}
  @Get('channels') channels() {
    return this.repository.listChannels();
  }
  @Get('channels/:id') channel(@Param('id') id: string) {
    return this.repository.getChannel(id);
  }
  @Post('channels') createChannel(@Body(new ZodValidationPipe(ChannelWrite)) input: ChannelWrite) {
    return this.repository.saveChannel(input);
  }
  @Patch('channels/:id') updateChannel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChannelPatch)) input: Partial<ChannelWrite>,
  ) {
    return this.repository.saveChannel(input, id);
  }
  @Delete('channels/:id') deleteChannel(@Param('id') id: string) {
    return this.repository.deleteChannel(id);
  }
  @Post('channels/catalog') readCatalog(
    @Body(new ZodValidationPipe(CatalogRequest)) input: CatalogRequest,
  ) {
    return this.catalog.read(input);
  }
  @Get('models') models() {
    return this.repository.listModels();
  }
  @Get('channels/:id/models') channelModels(@Param('id') id: string) {
    return this.repository.listModels(id);
  }
  @Get('models/:id') model(@Param('id') id: string) {
    return this.repository.getModel(id);
  }
  @Post('channels/:id/models') createModels(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.array(ModelWrite).min(1).max(200))) input: ModelWrite[],
  ) {
    return this.repository.saveModels(id, input);
  }
  @Put('models/:id') updateModel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ModelWrite)) input: ModelWrite,
  ) {
    return this.repository.updateModel(id, input);
  }
  @Delete('models/:id') deleteModel(@Param('id') id: string) {
    return this.repository.deleteModel(id);
  }
  @Post('models/:id/check') check(@Param('id') id: string) {
    return this.llm.test(id);
  }
  @Get('models/:id/export') export(@Param('id') id: string) {
    return this.services.export(id);
  }
  @Post('channels/:id/models/import') preview(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ModelExport)) input: ModelExport,
  ) {
    return this.services.preview(id, input);
  }
  @Get('model-defaults') defaults() {
    return this.repository.defaults();
  }
  @Put('model-defaults') saveDefaults(
    @Body(new ZodValidationPipe(ModelDefaultsPatch)) input: Partial<ModelDefaults>,
  ) {
    return this.repository.saveDefaults(input);
  }
  @Get('models/:id/voices') voiceList(@Param('id') id: string) {
    return this.voices.list(id);
  }
  @Post('models/:id/voices') saveVoice(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(VoiceWrite)) input: VoiceWrite,
  ) {
    return this.voices.save(id, input);
  }
  @Delete('models/:id/voices/:voiceId') removeVoice(
    @Param('id') id: string,
    @Param('voiceId') voiceId: string,
  ) {
    return this.voices.remove(id, voiceId);
  }
  @Post('models/:id/voices/remote') fetchVoices(@Param('id') id: string) {
    return this.voices.fetch(id);
  }
  @Get('protocols') protocols() {
    return PROTOCOLS;
  }
  @Post('llm/test-chat') async chat(
    @Body(new ZodValidationPipe(TestChatRequest)) input: TestChatRequest,
    @Res() response: Response,
  ) {
    await this.llm.validateChat(input.modelId);
    const controller = new AbortController();
    const close = () => controller.abort();
    response.on('close', close);
    const events = this.llm.chat(input, controller.signal);
    try {
      response.status(200).set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      response.flushHeaders();
      for await (const event of events) {
        if (controller.signal.aborted) break;
        if (!response.write(`data: ${JSON.stringify(event)}\n\n`))
          await once(response, 'drain', { signal: controller.signal });
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      controller.abort();
      response.off('close', close);
      await events.return(undefined);
      response.end();
    }
  }
}

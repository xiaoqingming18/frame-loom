import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Res } from '@nestjs/common';
import {
  ChannelWrite,
  ChannelPatch,
  ChannelModelWrite,
  ChannelModelPatch,
  ModelDefaultsPatch,
  ModelProbeRequest,
  TestChatRequest,
  type ModelDefaults,
} from '@frame-loom/contracts';
import type { Response } from 'express';
import { once } from 'node:events';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { ChannelsRepository } from './channels.repository.js';
import { ChannelsService } from './channels.service.js';
import { LlmService } from '../llm/llm.service.js';

@Controller()
export class ChannelsController {
  constructor(
    private readonly repository: ChannelsRepository,
    private readonly channels: ChannelsService,
    private readonly llm: LlmService,
  ) {}
  @Get('channels') listChannels() {
    return this.repository.listChannels();
  }
  @Get('channels/:id') channel(@Param('id') id: string) {
    return this.repository.getChannel(id);
  }
  @Post('channels') async createChannel(
    @Body(new ZodValidationPipe(ChannelWrite)) input: ChannelWrite,
  ) {
    await this.validateModels(input.models);
    return this.repository.saveChannel(input);
  }
  @Patch('channels/:id') async updateChannel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChannelPatch)) input: Partial<ChannelWrite>,
  ) {
    await this.validateModels(input.models);
    return this.repository.saveChannel(input, id);
  }
  private async validateModels(models: ChannelWrite['models']) {
    for (const model of models ?? []) await this.llm.metadata(this.channels.validateModel(model));
  }
  @Post('channels/probe-models') probeModels(
    @Body(new ZodValidationPipe(ModelProbeRequest)) input: ModelProbeRequest,
  ) {
    return this.channels.probe(input);
  }
  @Delete('channels/:id') deleteChannel(@Param('id') id: string) {
    return this.repository.deleteChannel(id);
  }
  @Post('channels/:id/test') testChannel(@Param('id') id: string) {
    return this.channels.test(id);
  }
  @Get('channel-models') allModels() {
    return Promise.all(this.repository.listModels().map((model) => this.llm.publicModel(model)));
  }
  @Get('channels/:id/models') listModels(@Param('id') id: string) {
    return Promise.all(this.repository.listModels(id).map((model) => this.llm.publicModel(model)));
  }
  @Get('channel-models/:id') model(@Param('id') id: string) {
    return this.llm.publicModel(this.repository.getModel(id));
  }
  @Post('channels/:id/models') async createModel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChannelModelWrite)) input: ChannelModelWrite,
  ) {
    this.channels.validateModel(input);
    await this.llm.metadata(input);
    return this.llm.publicModel(this.repository.saveModel(id, input));
  }
  @Patch('channel-models/:id') async updateModel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChannelModelPatch)) input: Partial<ChannelModelWrite>,
  ) {
    const model = this.repository.getModel(id);
    const merged = this.channels.validateModel({ ...model, ...input });
    await this.llm.metadata(merged);
    return this.llm.publicModel(this.repository.updateModel(id, merged));
  }
  @Delete('channel-models/:id') deleteModel(@Param('id') id: string) {
    return this.repository.deleteModel(id);
  }
  @Post('channel-models/:id/test') testModel(@Param('id') id: string) {
    return this.llm.test(id);
  }
  @Get('model-defaults') defaults() {
    return this.repository.defaults();
  }
  @Put('model-defaults') updateDefaults(
    @Body(new ZodValidationPipe(ModelDefaultsPatch)) input: Partial<ModelDefaults>,
  ) {
    return this.repository.saveDefaults(input);
  }

  @Post('llm/test-chat') async testChat(
    @Body(new ZodValidationPipe(TestChatRequest)) input: TestChatRequest,
    @Res() response: Response,
  ) {
    // 在发送 SSE 响应头前验证模型，保证配置错误仍走统一 JSON 错误契约。
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

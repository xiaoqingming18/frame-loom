import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  ProjectId,
  Sha256,
  AssetPath,
  AssetListRequest,
  AssetSearchRequest,
  AssetCreateDirectoryRequest,
  AssetUploadRequest,
  AssetRenameRequest,
  AssetMoveRequest,
  AssetImportRequest,
  AssetExportRequest,
} from '@frame-loom/contracts';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { DomainError } from '../../core/http/domain-error.js';
import { MediaService } from '../generation/media.service.js';
import { ProjectAssetsService } from './project-assets.service.js';
import { ProjectMediaService } from './project-media.service.js';

const idPipe = new ZodValidationPipe(ProjectId);
const adoptRequest = z.strictObject({ sha256: z.array(Sha256).max(10000) });
const dryRunPipe = new ZodValidationPipe(z.enum(['true', 'false']).default('true'));

@Controller('projects/:id')
export class ProjectContentController {
  constructor(
    private readonly media: MediaService,
    private readonly projectMedia: ProjectMediaService,
    private readonly assets: ProjectAssetsService,
  ) {}

  private async upload<T>(request: Request, receive: (signal: AbortSignal) => Promise<T>) {
    if (request.headers['content-type'] !== 'application/octet-stream')
      throw new DomainError('INVALID_UPLOAD', 415, '请使用二进制上传');
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(() => {
      abort();
      request.destroy();
    }, 120_000);
    request.once('aborted', abort);
    try {
      return await receive(controller.signal);
    } finally {
      clearTimeout(timer);
      request.off('aborted', abort);
    }
  }

  @Post('media') uploadMedia(@Param('id', idPipe) id: string, @Req() request: Request) {
    return this.upload(request, (signal) => this.media.upload(id, request, signal));
  }
  @Post('media/adopt') adopt(
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(adoptRequest)) input: z.infer<typeof adoptRequest>,
  ) {
    return this.media.adopt(id, input.sha256);
  }
  @Post('media/cleanup') cleanup(
    @Param('id', idPipe) id: string,
    @Query('dryRun', dryRunPipe) dryRun: string,
  ) {
    return this.projectMedia.cleanup(id, dryRun === 'true');
  }
  @Post('sessions/open') open(@Param('id', idPipe) id: string) {
    return this.projectMedia.session(id, true);
  }
  @Post('sessions/close') close(@Param('id', idPipe) id: string) {
    return this.projectMedia.session(id, false);
  }
  @Get('assets') list(
    @Param('id', idPipe) id: string,
    @Query(new ZodValidationPipe(AssetListRequest)) input: AssetListRequest,
  ) {
    return this.assets.list(id, input.path);
  }
  @Get('assets/search') search(@Param('id', idPipe) id: string, @Query('q') query: string) {
    return this.assets.search(id, AssetSearchRequest.parse({ query }).query);
  }
  @Post('assets/folders') folder(
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(AssetCreateDirectoryRequest)) input: AssetCreateDirectoryRequest,
  ) {
    return this.assets.folder(id, input.path, input.name);
  }
  @Post('assets/files') uploadAsset(
    @Param('id', idPipe) id: string,
    @Query(new ZodValidationPipe(AssetUploadRequest)) input: AssetUploadRequest,
    @Req() request: Request,
  ) {
    return this.upload(request, (signal) =>
      this.assets.upload(
        id,
        input.path,
        input.name,
        request,
        request.headers['content-length'] === undefined
          ? undefined
          : Number(request.headers['content-length']),
        signal,
      ),
    );
  }
  @Patch('assets') rename(
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(AssetRenameRequest)) input: AssetRenameRequest,
  ) {
    return this.assets.rename(id, input);
  }
  @Post('assets/move') move(
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(AssetMoveRequest)) input: AssetMoveRequest,
  ) {
    return this.assets.move(id, input);
  }
  @Post('media/from-asset') fromAsset(
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(AssetImportRequest)) input: AssetImportRequest,
  ) {
    return this.assets.fromAsset(id, input.path);
  }
  @Post('assets/from-media') fromMedia(
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(AssetExportRequest)) input: AssetExportRequest,
  ) {
    return this.assets.fromMedia(id, input);
  }
  private send(response: Response, path: string, mime: string, name?: string) {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (mime === 'application/octet-stream') response.attachment(name);
    response.type(mime);
    return new Promise<void>((resolve, reject) =>
      response.sendFile(
        path,
        { dotfiles: 'allow' },
        (error?: Error & { status?: number; headers?: Record<string, string> }) => {
          if (!error) resolve();
          else if (response.headersSent) {
            response.destroy();
            resolve();
          } else {
            response.removeHeader('Content-Type');
            response.removeHeader('Content-Disposition');
            if (error.headers) response.set(error.headers);
            reject(error.status ? new HttpException('文件读取失败', error.status) : error);
          }
        },
      ),
    );
  }
  @Get('files/media/:sha256') async mediaFile(
    @Param('id', idPipe) id: string,
    @Param('sha256', new ZodValidationPipe(Sha256)) sha256: string,
    @Res() response: Response,
  ) {
    const { path, media } = await this.media.resolve(sha256, id);
    return this.send(response, path, media.mime);
  }
  @Get('files/assets') async assetFile(
    @Param('id', idPipe) id: string,
    @Query('path', new ZodValidationPipe(AssetPath)) path: string,
    @Res() response: Response,
  ) {
    const file = await this.assets.file(id, path);
    return this.send(response, file.path, file.mime, file.name);
  }
}

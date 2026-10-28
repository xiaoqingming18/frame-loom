import { expect, it } from 'vitest';
import { checkRequest, validateModel, type VideoCap } from '@frame-loom/contracts';
import { ModelWrite } from '@frame-loom/contracts/model-service';
import {
  protocolContext,
  semanticRequest,
  imageHash,
  png,
  httpResult,
} from '../../../testing/protocol-context.js';
import { openaiVideos } from './openai-videos.js';
import { newapiVideo } from './newapi-video.js';

it.each([
  ['720p', '16:9', '1280x720'],
  ['720p', '9:16', '720x1280'],
  ['1080p', '16:9', '1920x1080'],
  ['1080p', '9:16', '1080x1920'],
])('OpenAI Videos %s × %s → %s，首帧文件和 content 鉴权', async (resolution, aspectRatio, size) => {
  const ctx = protocolContext(openaiVideos.descriptor, 'video');
  const req = semanticRequest(ctx, {
    mode: 'first',
    inputs: [{ role: 'first_frame', kind: 'image', sha256: imageHash, order: 0 }],
    params: { resolution, aspectRatio, duration: 8 },
  });
  const call = await openaiVideos.buildSubmit(ctx, req, ctx.snapshot.capability);
  const body = call.body as FormData;
  expect(call.url).toBe('http://127.0.0.1:12345/gateway/v1/videos');
  expect(Object.fromEntries([...body.entries()].filter(([, v]) => typeof v === 'string'))).toEqual({
    model: 'arbitrary-model',
    prompt: '测试',
    seconds: '8',
    size,
  });
  expect(Buffer.from(await (body.get('input_reference') as Blob).arrayBuffer())).toEqual(png);
  expect(openaiVideos.buildContent!(ctx, 'task id')).toMatchObject({
    method: 'GET',
    url: 'http://127.0.0.1:12345/gateway/v1/videos/task%20id/content',
    headers: { Authorization: 'Bearer test-key' },
  });
  expect(
    await openaiVideos.parseQuery!(ctx, httpResult({ id: 'task', status: 'completed' })),
  ).toEqual({
    status: 'succeeded',
    outputs: [{ kind: 'content', ref: 'task', mime: 'video/mp4' }],
  });
});

it('OpenAI Videos 顶层附加字段、无首帧路径与保留字段', async () => {
  const ctx = protocolContext(openaiVideos.descriptor, 'video');
  ctx.snapshot.extras = [
    { key: 'label', label: '标签', path: 'label', type: 'string', default: 'draft' },
  ];
  ctx.snapshot.fixedFields = [{ path: 'label', value: 'fixed' }];
  const body = (await openaiVideos.buildSubmit(ctx, semanticRequest(ctx), ctx.snapshot.capability))
    .body as FormData;
  expect(body.has('input_reference')).toBe(false);
  for (const key of body.keys())
    if (key !== 'label') expect(openaiVideos.descriptor.reservedFields).toContain(key);
  expect(body.get('label')).toBe('fixed');
  const model = ModelWrite.parse({
    kind: 'video',
    protocolId: openaiVideos.descriptor.id,
    upstreamModelId: 'alias',
    displayName: '测试',
    enabled: true,
    capability: ctx.snapshot.capability,
    extras: [{ key: 'label', label: '标签', path: 'meta.label', type: 'string' }],
  });
  expect(
    validateModel(model, openaiVideos.descriptor, {
      baseUrl: 'http://127.0.0.1:12345',
      hasSecretKey: false,
    }).some((issue) => issue.message === 'multipart 只允许顶层字段'),
  ).toBe(true);
});

it('new-api 自定义像素、metadata 路径、参考图与语义校验', async () => {
  const ctx = protocolContext(newapiVideo.descriptor, 'video');
  const cap = ctx.snapshot.capability as VideoCap;
  cap.duration = { kind: 'values', values: [5], default: 5 };
  ctx.snapshot.extras = [
    { key: 'style', label: '风格', path: 'metadata.style', type: 'string', default: 'cinema' },
  ];
  ctx.snapshot.fixedFields = [{ path: 'metadata.quality', value: 'high' }];
  const req = semanticRequest(ctx, {
    mode: 'first',
    inputs: [{ role: 'first_frame', kind: 'image', sha256: imageHash, order: 0 }],
    params: { width: 1920, height: 1080, duration: 5, seed: 8 },
    extras: { style: 'animation' },
  });
  const call = await newapiVideo.buildSubmit(ctx, req, cap);
  for (const key of Object.keys(JSON.parse(call.body as string) as Record<string, unknown>))
    expect(newapiVideo.descriptor.reservedFields).toContain(key);
  expect(JSON.parse(call.body as string)).toEqual({
    model: 'arbitrary-model',
    prompt: '测试',
    width: 1920,
    height: 1080,
    duration: 5,
    seed: 8,
    image: `data:image/png;base64,${png.toString('base64')}`,
    metadata: { style: 'animation', quality: 'high' },
  });
  const model = ModelWrite.parse({
    kind: 'video',
    protocolId: newapiVideo.descriptor.id,
    upstreamModelId: 'alias',
    displayName: '测试',
    enabled: true,
    capability: cap,
    extras: ctx.snapshot.extras,
    fixedFields: ctx.snapshot.fixedFields,
  });
  expect(checkRequest(req, model, newapiVideo.descriptor)).toEqual([]);
  expect(checkRequest({ ...req, params: { width: 1920 } }, model, newapiVideo.descriptor)).toEqual(
    expect.arrayContaining([expect.objectContaining({ message: '视频自定义宽高必须同时填写' })]),
  );
  model.extras[0].path = 'style';
  expect(
    validateModel(model, newapiVideo.descriptor, {
      baseUrl: 'http://127.0.0.1:12345',
      hasSecretKey: false,
    }).some((issue) => issue.field === 'extras.0.path'),
  ).toBe(true);
});

it.each([
  'queued',
  'in_progress',
  'processing',
  'completed',
  'succeeded',
  'failed',
  'future-state',
])('new-api 两套状态 %s', async (status) => {
  const ctx = protocolContext(newapiVideo.descriptor, 'video');
  const result = await newapiVideo.parseQuery!(
    ctx,
    httpResult({ task_id: 'outer', id: 'inner', status, url: 'http://127.0.0.1:12345/video.mp4' }),
  );
  if (['queued', 'in_progress', 'processing'].includes(status))
    expect(result).toMatchObject({ status: 'running', remoteTaskId: 'outer' });
  else
    expect(result.status).toBe(
      ['completed', 'succeeded'].includes(status) ? 'succeeded' : 'failed',
    );
});

it.each(['queued', 'in_progress', 'completed', 'failed', 'future-state'])(
  'OpenAI Videos 状态 %s',
  async (status) => {
    const ctx = protocolContext(openaiVideos.descriptor, 'video');
    const result = await openaiVideos.parseQuery!(ctx, httpResult({ id: 'task', status }));
    expect(result.status).toBe(
      ['queued', 'in_progress'].includes(status)
        ? 'running'
        : status === 'completed'
          ? 'succeeded'
          : 'failed',
    );
  },
);

it.each([openaiVideos, newapiVideo])(
  '$descriptor.id 提交未知结果抛错，查询未知结果失败',
  async (adapter) => {
    const ctx = protocolContext(adapter.descriptor, 'video');
    await expect(async () => adapter.parseSubmit(ctx, httpResult({}))).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(await adapter.parseQuery!(ctx, httpResult({}))).toMatchObject({
      status: 'failed',
      code: 'INVALID_RESPONSE',
    });
  },
);

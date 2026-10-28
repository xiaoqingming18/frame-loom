import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { checkRequest, type VideoCap, type SemanticInput } from '@frame-loom/contracts';
import { ModelWrite } from '@frame-loom/contracts/model-service';
import {
  protocolContext,
  semanticRequest,
  imageHash,
  png,
  httpResult,
} from '../../../testing/protocol-context.js';
import { arkSeedance } from './ark-seedance.js';
import { dashscopeWan } from './dashscope-wan.js';
import { minimaxVideoV2 } from './minimax-video-v2.js';
import { klingOmni } from './kling-omni.js';

const adapters = [arkSeedance, dashscopeWan, minimaxVideoV2, klingOmni];
const input = (
  role: SemanticInput['role'],
  kind: SemanticInput['kind'],
  order = 0,
): SemanticInput => ({ role, kind, order, sha256: imageHash });
const fields = (body: string | FormData | Uint8Array | undefined) =>
  JSON.parse(body as string) as Record<string, unknown>;

it.each(adapters)(
  '$descriptor.id 参考图视频音频按能力卡映射，模型别名不改变请求',
  async (adapter) => {
    const ctx = protocolContext(adapter.descriptor, 'video');
    const cap = ctx.snapshot.capability as VideoCap;
    const req = semanticRequest(ctx, {
      mode: 'reference',
      prompt: `参考 @{${imageHash}}`,
      inputs: [
        input('reference', 'image'),
        input('reference', 'video', 1),
        ...(cap.references.audio ? [input('reference', 'audio', 2)] : []),
      ],
      params: {
        duration: cap.duration.kind === 'auto' ? -1 : cap.duration.default,
        audio: false,
        watermark: false,
        seed: 42,
      },
    });
    const call = await adapter.buildSubmit(ctx, req, cap);
    expect(call.method).toBe('POST');
    expect(call.headers.Authorization).toBe('Bearer test-key');
    const body = fields(call.body);
    for (const key of Object.keys(body)) expect(adapter.descriptor.reservedFields).toContain(key);
    if (adapter === arkSeedance || adapter === minimaxVideoV2) {
      expect(body).toMatchObject({
        model: 'arbitrary-model',
        content: [
          { type: 'text', text: '参考 图1' },
          {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${png.toString('base64')}` },
            role: 'reference_image',
          },
          {
            type: 'video_url',
            video_url: { url: ctx.referenceUrl(imageHash) },
            role: 'reference_video',
          },
          {
            type: 'audio_url',
            audio_url: { url: ctx.referenceUrl(imageHash) },
            role: 'reference_audio',
          },
        ],
      });
      expect(body).not.toHaveProperty('prompt');
      expect(body).not.toHaveProperty('aspect_ratio');
    } else if (adapter === dashscopeWan) {
      expect(body.input).toMatchObject({
        prompt: '参考 图1',
        media: [
          { type: 'reference_image' },
          { type: 'reference_video' },
          { type: 'reference_audio' },
        ],
      });
      expect(call.headers['X-DashScope-Async']).toBe('enable');
      expect(body.parameters).toMatchObject({ audio: false, seed: 42 });
    } else {
      expect(body.contents).toMatchObject([
        { type: 'prompt', text: '参考 @image_1' },
        { type: 'refer_image', id: 'image_1' },
        { type: 'feature_video', id: 'video_1' },
      ]);
      expect(call.url).toBe('http://127.0.0.1:12345/gateway/omni-video/arbitrary-model');
      expect(body.options).toEqual({ watermark_info: { enabled: false } });
    }
    if (adapter === minimaxVideoV2 || adapter === klingOmni)
      expect(JSON.stringify(body)).not.toMatch(/"audio"|"generate_audio"|"seed"/);
    if (adapter === arkSeedance)
      expect(body).toMatchObject({ generate_audio: false, watermark: false, seed: 42 });
  },
);

it.each(adapters)('$descriptor.id 帧角色、文生无素材与自动时长', async (adapter) => {
  const ctx = protocolContext(adapter.descriptor, 'video');
  const cap = ctx.snapshot.capability as VideoCap;
  for (const mode of cap.modes.filter((mode) =>
    ['first', 'last', 'first_last', 'keyframes'].includes(mode.id),
  )) {
    const inputs =
      mode.id === 'first_last'
        ? [input('first_frame', 'image'), input('last_frame', 'image', 1)]
        : [
            input(
              mode.id === 'first' ? 'first_frame' : mode.id === 'last' ? 'last_frame' : 'keyframe',
              'image',
            ),
          ];
    const req = semanticRequest(ctx, { mode: mode.id, inputs });
    const body = fields((await adapter.buildSubmit(ctx, req, cap)).body);
    for (const entry of inputs)
      expect(JSON.stringify(body)).toContain(
        entry.role === 'keyframe' ? 'middle_frame' : entry.role,
      );
  }
  const auto = semanticRequest(ctx, { mode: 't2v', params: { duration: -1 } });
  const body = fields((await adapter.buildSubmit(ctx, auto, cap)).body);
  if (adapter === klingOmni) expect(body.settings).not.toHaveProperty('duration');
  else if (adapter === dashscopeWan) expect(body.parameters).toMatchObject({ duration: -1 });
  else if (adapter === arkSeedance) expect(body.duration).toBe(-1);
  else {
    const model = ModelWrite.parse({
      kind: 'video',
      protocolId: adapter.descriptor.id,
      upstreamModelId: 'alias',
      displayName: '测试',
      enabled: true,
      capability: cap,
    });
    expect(
      checkRequest(auto, model, adapter.descriptor).some(
        (issue) => issue.field === 'params.duration',
      ),
    ).toBe(true);
  }
  const text = fields(
    (await adapter.buildSubmit(ctx, semanticRequest(ctx, { mode: 't2v' }), cap)).body,
  );
  expect(text).not.toHaveProperty('image');
});

it.each(adapters)('$descriptor.id 状态全集、业务错误、未知响应与查询地址', async (adapter) => {
  const ctx = protocolContext(adapter.descriptor, 'video');
  const fixture = JSON.parse(
    await readFile(
      new URL(`./fixtures/${adapter.descriptor.id}/task.json`, import.meta.url),
      'utf8',
    ),
  ) as unknown;
  expect(await adapter.parseQuery!(ctx, httpResult(fixture))).toMatchObject({
    status: 'succeeded',
    outputs: [{ kind: 'url', mime: 'video/mp4' }],
  });
  const query = adapter.buildQuery!(ctx, 'task id');
  expect(query.method).toBe('GET');
  expect(query.headers.Authorization).toBe('Bearer test-key');
  if (adapter === klingOmni)
    expect(query.url).toBe('http://127.0.0.1:12345/gateway/tasks?task_ids=task%20id');
  else expect(query.url).toContain('task%20id');
  await expect(async () => adapter.parseSubmit(ctx, httpResult({}))).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
  });
  expect(await adapter.parseQuery!(ctx, httpResult({}))).toMatchObject({
    status: 'failed',
    code: 'INVALID_RESPONSE',
  });
  const running =
    adapter === dashscopeWan
      ? ['PENDING', 'RUNNING']
      : adapter === klingOmni
        ? ['submitted', 'processing']
        : adapter === minimaxVideoV2
          ? ['queued', 'pending', 'processing', 'running']
          : ['queued', 'running'];
  const failed =
    adapter === dashscopeWan
      ? ['FAILED', 'CANCELED', 'UNKNOWN']
      : adapter === klingOmni
        ? ['failed']
        : ['failed', 'expired', 'cancelled'];
  const response = (status: string) =>
    adapter === dashscopeWan
      ? { output: { task_id: 'outer', task_status: status } }
      : adapter === klingOmni
        ? { code: 0, data: [{ id: 'outer', status }] }
        : adapter === minimaxVideoV2
          ? { task_id: 'ignored-outer', task: { id: 'outer', status } }
          : { id: 'outer', status };
  for (const status of running)
    expect(await adapter.parseQuery!(ctx, httpResult(response(status)))).toMatchObject({
      status: 'running',
      remoteTaskId: 'outer',
      remoteStatus: status,
    });
  for (const status of failed)
    expect(await adapter.parseQuery!(ctx, httpResult(response(status)))).toMatchObject({
      status: 'failed',
    });
  expect(await adapter.parseQuery!(ctx, httpResult(response('future-state')))).toMatchObject({
    status: 'failed',
    code: 'INVALID_RESPONSE',
  });
  const error =
    adapter === dashscopeWan
      ? { code: 'InvalidApiKey', message: 'test-key' }
      : adapter === klingOmni
        ? { code: 1004, message: 'test-key' }
        : adapter === minimaxVideoV2
          ? { base_resp: { status_code: 1004, status_msg: 'test-key' } }
          : { error: { code: 'InvalidApiKey', message: 'test-key' } };
  expect(await adapter.parseSubmit(ctx, httpResult(error))).toMatchObject({
    status: 'failed',
    category: 'auth',
  });
  expect(JSON.stringify(await adapter.parseSubmit(ctx, httpResult(error)))).not.toContain(
    'test-key',
  );
});

it('MiniMax 使用外层提交任务 ID，不能错取内部 ID', async () => {
  const ctx = protocolContext(minimaxVideoV2.descriptor, 'video');
  expect(
    await minimaxVideoV2.parseSubmit(
      ctx,
      httpResult({ task_id: 'outer', task: { id: 'inner', status: 'running' } }),
    ),
  ).toMatchObject({ remoteTaskId: 'outer' });
});
it('协议规则与混用限制来自共享校验，Wan 附加参数写入 parameters', async () => {
  for (const adapter of [arkSeedance, minimaxVideoV2]) {
    const ctx = protocolContext(adapter.descriptor, 'video');
    const model = ModelWrite.parse({
      kind: 'video',
      protocolId: adapter.descriptor.id,
      upstreamModelId: 'alias',
      displayName: '测试',
      enabled: true,
      capability: ctx.snapshot.capability,
    });
    const issues = checkRequest(
      semanticRequest(ctx, {
        mode: 'first_last',
        inputs: [input('first_frame', 'image'), input('last_frame', 'image', 1)],
        params: { aspectRatio: '16:9' },
      }),
      model,
      adapter.descriptor,
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: adapter.descriptor.rules.find((rule) => rule.when.modes?.includes('first_last'))!
            .message,
        }),
      ]),
    );
    expect(
      checkRequest(
        semanticRequest(ctx, {
          mode: 'first',
          inputs: [input('first_frame', 'image'), input('reference', 'image', 1)],
        }),
        model,
        adapter.descriptor,
      ).length,
    ).toBeGreaterThan(0);
  }
  const ctx = protocolContext(dashscopeWan.descriptor, 'video');
  ctx.snapshot.extras = dashscopeWan.descriptor.defaultExtras!;
  expect(
    fields(
      (
        await dashscopeWan.buildSubmit(
          ctx,
          semanticRequest(ctx, { extras: { promptExtend: false } }),
          ctx.snapshot.capability,
        )
      ).body,
    ).parameters,
  ).toMatchObject({ prompt_extend: false });
});

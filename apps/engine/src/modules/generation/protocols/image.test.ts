import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { checkRequest, validateModel, type ImageCap } from '@frame-loom/contracts';
import { ModelWrite } from '@frame-loom/contracts/model-service';
import {
  protocolContext,
  semanticRequest,
  imageHash,
  png,
  httpResult,
} from '../../../testing/protocol-context.js';
import { openaiImages } from './openai-images.js';
import { arkSeedream } from './ark-seedream.js';
import { geminiGenerate } from './gemini-generate.js';
import type { HttpCall } from './types.js';

function json(call: HttpCall) {
  return JSON.parse(call.body as string) as Record<string, unknown>;
}
const reference = {
  kind: 'image' as const,
  role: 'reference' as const,
  order: 0,
  sha256: imageHash,
};
describe('OpenAI Images 契约', () => {
  it('JSON 文生图、任意模型别名、像素计算、质量、透明和固定单张', async () => {
    const ctx = protocolContext(openaiImages.descriptor);
    const req = semanticRequest(ctx, {
      params: {
        tier: '2K',
        aspectRatio: '16:9',
        quality: 'max',
        background: 'transparent',
        compression: 70,
      },
    });
    const call = await openaiImages.buildSubmit(ctx, req, ctx.snapshot.capability);
    expect(call).toMatchObject({
      method: 'POST',
      url: 'http://127.0.0.1:12345/gateway/v1/images/generations',
      headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
    });
    expect(json(call)).toEqual({
      model: 'arbitrary-model',
      prompt: '测试',
      n: 1,
      size: '2560x1440',
      quality: 'max',
      background: 'transparent',
      output_format: 'png',
      output_compression: 70,
    });
  });
  it('参考图走 multipart 编辑，蒙版单独放置，附加参数后固定字段覆盖', async () => {
    const ctx = protocolContext(openaiImages.descriptor);
    ctx.snapshot.extras = [
      {
        key: 'safety',
        label: '标记',
        type: 'string',
        path: 'safety_identifier',
        default: 'default',
      },
    ];
    ctx.snapshot.fixedFields = [{ path: 'safety_identifier', value: 'fixed' }];
    const maskHash = 'b'.repeat(64);
    const req = semanticRequest(ctx, {
      inputs: [reference, { ...reference, order: 1, sha256: maskHash }],
      prompt: `修改 @{${imageHash}}`,
      extras: { safety: 'request' },
      imageEdit: {
        version: 1,
        operation: 'emotion',
        source: { nodeId: 'source', sha256: imageHash },
        targetFace: { x: 0, y: 0, width: 1, height: 1 },
        editRegion: { x: 0, y: 0, width: 1, height: 1 },
        imageWidth: 1,
        imageHeight: 1,
        presetId: 'test',
        intimacy: 0,
        arousal: 0,
        characterName: '',
        maskMode: 'provider',
        artifacts: { crop: imageHash, identity: imageHash, mask: maskHash },
        postProcess: 'pending',
      },
    });
    const call = await openaiImages.buildSubmit(ctx, req, ctx.snapshot.capability);
    expect(call.url).toBe('http://127.0.0.1:12345/gateway/v1/images/edits');
    const form = call.body as FormData;
    expect(form.get('prompt')).toBe('修改 图1');
    expect(form.getAll('image[]')).toHaveLength(1);
    expect(form.get('mask')).toBeInstanceOf(Blob);
    expect(form.get('safety_identifier')).toBe('fixed');
    expect(Buffer.from(await (form.get('image[]') as Blob).arrayBuffer())).toEqual(png);
  });
  it('自动尺寸省略 size，带参考图像素上限由共享校验拒绝', async () => {
    const ctx = protocolContext(openaiImages.descriptor);
    const cap = ctx.snapshot.capability as ImageCap;
    cap.size.default = { auto: true };
    expect(json(await openaiImages.buildSubmit(ctx, semanticRequest(ctx), cap))).not.toHaveProperty(
      'size',
    );
    cap.size.withReference = { maxPixels: 1048576 };
    const req = semanticRequest(ctx, {
      inputs: [reference],
      params: { width: 2560, height: 1440 },
    });
    const model = ModelWrite.parse({
      kind: 'image',
      protocolId: openaiImages.descriptor.id,
      upstreamModelId: 'arbitrary-model',
      displayName: '测试',
      enabled: true,
      capability: cap,
    });
    expect(checkRequest(req, model, openaiImages.descriptor)).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: '带参考图时像素超过上限' })]),
    );
    model.extras = [{ key: 'nested', label: '嵌套', type: 'string', path: 'nested.value' }];
    expect(
      validateModel(model, openaiImages.descriptor, {
        baseUrl: 'http://127.0.0.1:12345',
        hasSecretKey: false,
      }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: 'multipart 只允许顶层字段' })]),
    );
  });
});

describe('Seedream 契约', () => {
  it.each(['pixels', 'tier', 'none'] as const)('尺寸发送 %s，引用与附加字段路径', async (wire) => {
    const ctx = protocolContext(arkSeedream.descriptor);
    const cap = ctx.snapshot.capability as ImageCap;
    cap.size.wire = wire;
    ctx.snapshot.extras = [
      { key: 'watermark', label: '水印', type: 'boolean', path: 'watermark', default: false },
    ];
    ctx.snapshot.fixedFields = [{ path: 'optimization.mode', value: 'standard' }];
    const req = semanticRequest(ctx, {
      inputs: [reference],
      prompt: `重绘 @{${imageHash}}`,
      params: { tier: '2K', aspectRatio: '16:9', outputFormat: 'png' },
    });
    const call = await arkSeedream.buildSubmit(ctx, req, cap);
    expect(call.url).toBe('http://127.0.0.1:12345/gateway/api/v3/images/generations');
    const body = json(call);
    expect(body).toMatchObject({
      model: 'arbitrary-model',
      prompt: '重绘 图1',
      sequential_image_generation: 'disabled',
      response_format: 'url',
      output_format: 'png',
      watermark: false,
      optimization: { mode: 'standard' },
      image: [`data:image/png;base64,${png.toString('base64')}`],
    });
    if (wire === 'none') expect(body).not.toHaveProperty('size');
    else expect(body.size).toBe(wire === 'pixels' ? '2848x1600' : '2K');
    ctx.snapshot.transport.image = 'url';
    expect(json(await arkSeedream.buildSubmit(ctx, req, cap)).image).toEqual([
      ctx.referenceUrl(imageHash),
    ]);
  });
});

describe('Gemini 图像契约', () => {
  it('generateContent 文本与内联参考图，档位原样发送', async () => {
    const ctx = protocolContext(geminiGenerate.descriptor);
    const req = semanticRequest(ctx, {
      inputs: [reference],
      prompt: `重绘 @{${imageHash}}`,
      params: { tier: '4K', aspectRatio: '16:9' },
    });
    const call = await geminiGenerate.buildSubmit(ctx, req, ctx.snapshot.capability);
    expect(call).toMatchObject({
      method: 'POST',
      url: 'http://127.0.0.1:12345/gateway/v1beta/models/arbitrary-model:generateContent',
      headers: { 'x-goog-api-key': 'test-key' },
    });
    expect(json(call)).toEqual({
      contents: [
        {
          role: 'user',
          parts: [
            { text: '重绘 图1' },
            { inlineData: { mimeType: 'image/png', data: png.toString('base64') } },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: '16:9', imageSize: '4K' },
      },
    });
    const textOnly = json(
      await geminiGenerate.buildSubmit(ctx, semanticRequest(ctx), ctx.snapshot.capability),
    );
    expect(textOnly.contents).toEqual([{ role: 'user', parts: [{ text: '测试' }] }]);
  });
  it('审核拒绝与无产物响应不能视为成功', async () => {
    const ctx = protocolContext(geminiGenerate.descriptor);
    expect(
      await geminiGenerate.parseSubmit(
        ctx,
        httpResult({ promptFeedback: { blockReason: 'SAFETY' } }),
      ),
    ).toMatchObject({ status: 'failed', category: 'moderation' });
    await expect(async () =>
      geminiGenerate.parseSubmit(
        ctx,
        httpResult({ candidates: [{ content: { parts: [{ text: 'no-image' }] } }] }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

it.each([openaiImages, arkSeedream, geminiGenerate])(
  '$descriptor.id 官方结构样例解析、保留字段与未知响应',
  async (adapter) => {
    const ctx = protocolContext(adapter.descriptor);
    const name = adapter === geminiGenerate ? 'image' : 'success';
    const fixture = JSON.parse(
      await readFile(
        new URL(`./fixtures/${adapter.descriptor.id}/${name}.json`, import.meta.url),
        'utf8',
      ),
    ) as unknown;
    expect(await adapter.parseSubmit(ctx, httpResult(fixture))).toMatchObject({
      status: 'succeeded',
      outputs: [expect.objectContaining({ kind: adapter === arkSeedream ? 'url' : 'data' })],
    });
    const call = await adapter.buildSubmit(ctx, semanticRequest(ctx), ctx.snapshot.capability);
    for (const key of Object.keys(json(call)))
      expect(adapter.descriptor.reservedFields).toContain(key);
    await expect(async () => adapter.parseSubmit(ctx, httpResult({}))).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(
      JSON.stringify(
        await adapter.parseSubmit(
          ctx,
          httpResult(
            adapter === geminiGenerate
              ? { promptFeedback: { blockReason: 'SAFETY' } }
              : { error: { message: 'test-key private-body' } },
          ),
        ),
      ),
    ).not.toMatch(/test-key|private-body/);
  },
);

it('图像响应支持 URL 与 base64，素材 MIME 按实际签名识别', async () => {
  const ctx = protocolContext(arkSeedream.descriptor);
  expect(
    await arkSeedream.parseSubmit(
      ctx,
      httpResult({ data: [{ b64_json: png.toString('base64') }] }),
    ),
  ).toMatchObject({ status: 'succeeded', outputs: [{ kind: 'data', mime: 'image/png' }] });
  expect(
    await openaiImages.parseSubmit(
      ctx,
      httpResult({ data: [{ url: 'http://127.0.0.1:12345/result' }] }),
    ),
  ).toMatchObject({ status: 'succeeded', outputs: [{ kind: 'url' }] });
});

it.each([
  ['content_policy_violation', 'moderation'],
  ['invalid_api_key', 'auth'],
  ['insufficient_quota', 'quota'],
  ['rate_limit_exceeded', 'rate_limit'],
  ['invalid_parameter', 'invalid_params'],
  ['unrecognized', 'upstream'],
])('图像业务错误 %s 分类为 %s，正文不外泄', async (code, category) => {
  const ctx = protocolContext(openaiImages.descriptor);
  expect(
    await openaiImages.parseSubmit(
      ctx,
      httpResult({ error: { code, message: 'test-key private-body' } }),
    ),
  ).toEqual({ status: 'failed', category, code: 'IMAGE_FAILED', message: '上游图像生成失败' });
});

it.each([openaiImages, arkSeedream, geminiGenerate])(
  '$descriptor.id 素材 order 与提示词序号一致',
  async (adapter) => {
    const ctx = protocolContext(adapter.descriptor);
    const secondHash = 'b'.repeat(64);
    const req = semanticRequest(ctx, {
      inputs: [
        { ...reference, sha256: secondHash, order: 2 },
        { ...reference, order: 1 },
      ],
      prompt: `参考 @{${imageHash}} 与 @{${secondHash}}`,
    });
    const call = await adapter.buildSubmit(ctx, req, ctx.snapshot.capability);
    const content = call.body instanceof FormData ? call.body.get('prompt') : call.body;
    expect(content).toContain('参考 图1 与 图2');
  },
);

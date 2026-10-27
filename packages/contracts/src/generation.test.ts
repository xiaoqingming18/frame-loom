import { describe, expect, it } from 'vitest';
import {
  checkGenerationRequest,
  GenerationRequest,
  ModelProfile,
  GenerationJob,
} from './generation.js';

const profile = ModelProfile.parse({
  id: 'test',
  name: '测试',
  kind: 'image',
  protocol: 'openai-images',
  matchIds: [],
  generic: true,
  modes: [
    { id: 'text', name: '文生' },
    { id: 'reference', name: '参考' },
    { id: 'frames', name: '首尾帧' },
  ],
  params: [
    { key: 'resolution', name: '分辨率', type: 'enum', values: ['720p', '1080p'], default: '720p' },
    { key: 'duration', name: '时长', type: 'number', min: 4, max: 8, default: 8 },
  ],
  constraints: [
    {
      when: { inputRole: 'first_frame' },
      forbidRoles: ['reference'],
      message: '首尾帧和全模态参考互斥',
    },
    {
      when: { param: 'resolution', equals: '1080p' },
      param: 'duration',
      allowed: [8],
      message: '1080p 仅支持 8 秒',
    },
  ],
  inputs: [
    { kind: 'image', maxCount: 2, maxBytes: 100, mimeTypes: ['image/png'], transport: 'inline' },
  ],
  runtime: {
    concurrency: 1,
    pollInitialMs: 100,
    pollMaxMs: 1000,
    timeoutMs: 10000,
    submitTimeoutMs: 1000,
    supportsCancel: false,
  },
});
const request = GenerationRequest.parse({
  modelId: '11111111-1111-4111-8111-111111111111',
  mode: 'text',
  prompt: '测试',
});
const image = { kind: 'image' as const, role: 'reference' as const, sha256: 'a'.repeat(64) };

describe('生成契约与共享预检', () => {
  it('通用档案接受基础请求并补齐请求默认值', () => {
    expect(checkGenerationRequest(profile, request)).toEqual([]);
    expect(request).toMatchObject({ inputs: [], params: {}, source: 'manual' });
    expect(ModelProfile.safeParse({ ...profile, protocol: 'fake' }).success).toBe(false);
    expect(GenerationRequest.safeParse({ ...request, source: 'fake' }).success).toBe(false);
    expect(GenerationJob.safeParse({ status: 'fake' }).success).toBe(false);
  });
  it('首尾帧与全模态参考互斥', () => {
    expect(
      checkGenerationRequest(profile, {
        ...request,
        mode: 'frames',
        inputs: [{ ...image, role: 'first_frame' }, image],
      }),
    ).toContainEqual({ field: 'inputs', message: '首尾帧和全模态参考互斥' });
  });
  it('分辨率与时长联动，并在未显式传参时使用档案默认值', () => {
    expect(
      checkGenerationRequest(profile, { ...request, params: { resolution: '1080p', duration: 4 } }),
    ).toContainEqual({ field: 'duration', message: '1080p 仅支持 8 秒' });
    expect(
      checkGenerationRequest(profile, { ...request, params: { resolution: '1080p' } }),
    ).toEqual([]);
  });
  it('拦截数量、格式、大小、模式、范围和白名单外字段', () => {
    expect(
      checkGenerationRequest(
        { ...profile, params: [{ ...profile.params[0], values: undefined }] },
        {
          ...request,
          params: { resolution: '720p' },
        },
      ),
    ).toContainEqual({ field: 'resolution', message: '分辨率取值无效' });
    expect(
      checkGenerationRequest(profile, {
        ...request,
        mode: 'reference',
        inputs: [image, image, image],
      }).some((issue) => issue.field === 'inputs'),
    ).toBe(true);
    expect(
      checkGenerationRequest(profile, {
        ...request,
        mode: 'reference',
        inputs: [
          {
            kind: 'image',
            role: 'reference',
            dataUrl: `data:image/jpeg;base64,${'a'.repeat(200)}`,
          },
        ],
      }),
    ).toContainEqual({ field: 'inputs', message: '参考素材格式或大小不符合档案' });
    expect(
      checkGenerationRequest(profile, {
        ...request,
        params: { duration: 99, inject: 'secret' },
      }).map((issue) => issue.field),
    ).toEqual(['duration', 'inject']);
    expect(checkGenerationRequest(profile, { ...request, mode: 'invalid' })[0]?.field).toBe('mode');
    expect(checkGenerationRequest(profile, { ...request, mode: 'reference' })).not.toEqual([]);
    expect(
      GenerationRequest.safeParse({
        ...request,
        inputs: [{ ...image, dataUrl: 'data:image/png;base64,YQ==' }],
      }).success,
    ).toBe(false);
    expect(
      GenerationRequest.safeParse({ ...request, inputs: [{ ...image, sha256: '../a' }] }).success,
    ).toBe(false);
  });
});

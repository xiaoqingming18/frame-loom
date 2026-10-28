import { expect, it } from 'vitest';
import { checkMedia, checkRequest, effectiveVideoParams } from './capability-check.js';
import { getProtocol } from './protocols.js';
import { SemanticRequest } from './semantic-request.js';

it('Seedance 编辑和续写按已核对文档锁定参数；Kling 不开放续写', () => {
  const descriptor = getProtocol('ark-seedance')!;
  const cap = descriptor.templates.video!;
  const input = {
    role: 'base_video' as const,
    kind: 'video' as const,
    sha256: 'a'.repeat(64),
    order: 0,
  };
  const req = SemanticRequest.parse({
    modelId: '11111111-1111-4111-8111-111111111111',
    mode: 'edit',
    prompt: '编辑视频',
    inputs: [input],
    params: { aspectRatio: 'adaptive', duration: -1 },
  });
  const model = { kind: 'video' as const, capability: cap, extras: [] };
  expect(checkRequest(req, model, descriptor)).toEqual([]);
  for (const inputs of [[], [input, { ...input, order: 1 }]])
    expect(
      checkRequest({ ...req, inputs }, model, descriptor).some((issue) => issue.field === 'inputs'),
    ).toBe(true);
  expect(
    checkRequest(
      { ...req, inputs: [input, { ...input, role: 'reference' }] },
      model,
      descriptor,
    ).some((issue) => issue.field === 'inputs'),
  ).toBe(true);
  expect(
    checkRequest({ ...req, params: { aspectRatio: '16:9', duration: 5 } }, model, descriptor),
  ).toHaveLength(2);
  expect(
    checkRequest(
      { ...req, mode: 'extend', params: { aspectRatio: 'adaptive', duration: 5 } },
      model,
      descriptor,
    ),
  ).toEqual([]);
  expect(
    effectiveVideoParams(cap, descriptor, 'edit', [input])
      .durations.filter((item) => !item.disabled)
      .map((item) => item.value),
  ).toEqual([-1]);
  const media = [{ input, media: { durationMs: 3000, mime: 'video/mp4' } }];
  expect(checkMedia(media, cap, descriptor, 'edit')).toContainEqual({
    field: 'inputs',
    message: 'Seedance 待编辑视频至少需要 4 秒',
  });
  expect(checkMedia(media, cap, descriptor, 'extend')).toEqual([]);
  expect(getProtocol('kling-omni')!.ceiling.video!.modes).toContain('edit');
  expect(getProtocol('kling-omni')!.ceiling.video!.modes).not.toContain('extend');
});

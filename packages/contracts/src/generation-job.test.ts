import { expect, it } from 'vitest';
import { GenerationJob } from './generation-job.js';

it('任务只暴露模型标识、语义请求和配置哈希', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const job = {
    id,
    modelId: id,
    kind: 'image',
    status: 'pending',
    request: { modelId: id, prompt: '测试', inputs: [], params: { tier: '1K' } },
    configHash: 'hash',
    remoteTaskId: null,
    remoteStatus: null,
    attempts: 0,
    nextPollAt: null,
    errorCategory: null,
    errorCode: null,
    errorMessage: null,
    outputs: [],
    createdAt: '2026-10-29T00:00:00Z',
    updatedAt: '2026-10-29T00:00:00Z',
    finishedAt: null,
  };
  const parsed = GenerationJob.parse({ ...job, profileId: '旧档案', channelModelId: id });
  expect(parsed.modelId).toBe(id);
  expect(parsed.request.extras).toEqual({});
  expect(parsed).not.toHaveProperty('profileId');
  expect(parsed).not.toHaveProperty('channelModelId');
  expect(GenerationJob.safeParse({ ...job, modelId: undefined }).success).toBe(false);
  expect(
    GenerationJob.safeParse({ ...job, request: { ...job.request, mode: 'text' } }).success,
  ).toBe(false);
  expect(
    GenerationJob.safeParse({ ...job, request: { ...job.request, params: { ratio: '1:1' } } })
      .success,
  ).toBe(false);
});

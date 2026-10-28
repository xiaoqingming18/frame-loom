import { afterEach, expect, it } from 'vitest';
import { getProtocol } from '@frame-loom/contracts';
import { ModelWrite } from '@frame-loom/contracts/model-service';
import { mockUpstream } from '../../testing/mock-upstream.js';
import { testEngine } from '../../testing/test-engine.js';
import { ModelServicesRepository } from '../model-services/model-services.repository.js';
import { LlmService } from './llm.service.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
it('文本模型只按能力卡和统一地址调用 pi-ai，检查绑定配置哈希', async () => {
  const upstream = await mockUpstream([
    {
      method: 'GET',
      path: '/gateway/v1/models',
      headers: { authorization: 'Bearer test-chat-key' },
      reply: () => ({ body: JSON.stringify({ data: [] }) }),
    },
    {
      method: 'POST',
      path: '/gateway/v1/chat/completions',
      headers: { authorization: 'Bearer test-chat-key' },
      reply: (req) => {
        const body = JSON.parse(req.body) as Record<string, unknown>;
        expect(body.model).toBe('arbitrary-alias');
        expect(body.stream).toBe(true);
        expect(body.temperature).toBeUndefined();
        expect(body.tools).toBeUndefined();
        return {
          headers: { 'Content-Type': 'text/event-stream' },
          body:
            [
              {
                id: 'chat-1',
                object: 'chat.completion.chunk',
                model: 'arbitrary-alias',
                choices: [
                  { index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null },
                ],
              },
              {
                id: 'chat-1',
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
              },
            ]
              .map((item) => `data: ${JSON.stringify(item)}\n\n`)
              .join('') + 'data: [DONE]\n\n',
        };
      },
    },
  ]);
  cleanups.push(() => upstream.close());
  const s = await testEngine();
  cleanups.push(() => s.close());
  const repo = s.app.get(ModelServicesRepository);
  const channel = repo.saveChannel({
    name: '测试',
    baseUrl: `${upstream.origin}/gateway/v1`,
    apiKey: 'test-chat-key',
    enabled: true,
  });
  const model = repo.saveModels(channel.id, [
    ModelWrite.parse({
      kind: 'chat',
      upstreamModelId: 'arbitrary-alias',
      displayName: '文本',
      protocolId: 'openai-chat',
      capability: { ...getProtocol('openai-chat')!.templates.chat!, maxOutput: 42 },
      enabled: true,
    }),
  ])[0];
  const result = await s.app.get(LlmService).test(model.id);
  expect(result.ok).toBe(true);
  expect(repo.getModel(model.id).lastCheck).toEqual(result);
  const events = [];
  for await (const event of s.app
    .get(LlmService)
    .chat(
      { modelId: model.id, messages: [{ role: 'user', content: '测试' }] },
      new AbortController().signal,
    ))
    events.push(event);
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'text.delta', delta: 'OK' }),
      expect.objectContaining({ type: 'done' }),
    ]),
  );
  expect(upstream.requests).toHaveLength(3);
  expect(upstream.violations).toEqual([]);
});
it.each([401, 429, 500, 302])('文本 HTTP %s 分类，重定向拒绝且不泄露正文', async (status) => {
  const upstream = await mockUpstream([
    {
      method: 'POST',
      path: '/v1/chat/completions',
      headers: { authorization: 'Bearer test-chat-key' },
      reply: () => ({
        status,
        headers: status === 302 ? { Location: '/forbidden' } : undefined,
        body: 'test-chat-key upstream-private-error',
      }),
    },
  ]);
  cleanups.push(() => upstream.close());
  const s = await testEngine();
  cleanups.push(() => s.close());
  const repo = s.app.get(ModelServicesRepository);
  const channel = repo.saveChannel({
    name: '测试',
    baseUrl: upstream.origin,
    apiKey: 'test-chat-key',
    enabled: true,
  });
  const model = repo.saveModels(channel.id, [
    ModelWrite.parse({
      kind: 'chat',
      upstreamModelId: 'arbitrary',
      displayName: '测试',
      protocolId: 'openai-chat',
      capability: getProtocol('openai-chat')!.templates.chat,
      enabled: true,
    }),
  ])[0];
  const events = [];
  for await (const event of s.app
    .get(LlmService)
    .chat(
      { modelId: model.id, messages: [{ role: 'user', content: '测试' }] },
      new AbortController().signal,
    ))
    events.push(event);
  expect(events.at(-1)).toMatchObject({
    type: 'error',
    code:
      status === 401
        ? 'AUTH_FAILED'
        : status === 429
          ? 'RATE_LIMITED'
          : status === 500
            ? 'UPSTREAM_ERROR'
            : 'CONNECTION_FAILED',
  });
  expect(JSON.stringify(events)).not.toMatch(/test-chat-key|upstream-private-error/);
  expect(upstream.requests).toHaveLength(1);
  expect(upstream.violations).toEqual([]);
});

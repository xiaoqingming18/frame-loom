import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ModelWrite, getProtocol } from '@frame-loom/contracts';
import { testEngine } from '../../testing/test-engine.js';
import { mockUpstream } from '../../testing/mock-upstream.js';
import { ModelServicesRepository } from '../model-services/model-services.repository.js';
import { LlmService } from './llm.service.js';

it('M10 剧本调用可有界增大预算并拒绝截断，普通 complete 保持原默认值', async () => {
  let reason = 'stop';
  const budgets: number[] = [];
  const upstream = await mockUpstream([
    {
      method: 'POST',
      path: '/v1/chat/completions',
      reply: (request) => {
        budgets.push(
          z.object({ max_tokens: z.number() }).parse(JSON.parse(request.body)).max_tokens,
        );
        return {
          headers: { 'Content-Type': 'text/event-stream' },
          body:
            `data: ${JSON.stringify({ id: 'budget', choices: [{ index: 0, delta: { content: '原文' }, finish_reason: null }] })}\n\n` +
            `data: ${JSON.stringify({ id: 'budget', choices: [{ index: 0, delta: {}, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`,
        };
      },
    },
  ]);
  const engine = await testEngine();
  try {
    const repository = engine.app.get(ModelServicesRepository);
    const channel = repository.saveChannel({
      name: '预算',
      baseUrl: upstream.origin,
      apiKey: 'test',
      enabled: true,
    });
    const model = repository.saveModels(channel.id, [
      ModelWrite.parse({
        kind: 'chat',
        protocolId: 'openai-chat',
        upstreamModelId: 'budget',
        displayName: '预算',
        enabled: true,
        capability: { ...getProtocol('openai-chat')!.templates.chat!, maxOutput: 1024 },
      }),
    ])[0];
    const llm = engine.app.get(LlmService);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const input = { system: '系统', user: '原文' },
      signal = new AbortController().signal;
    await expect(llm.complete(model.id, input, signal)).resolves.toBe('原文');
    expect(timeout).toHaveBeenCalledWith(60000);
    await expect(
      llm.complete(model.id, input, signal, {
        timeoutMs: 180000,
        maxTokens: 512,
        requireStop: true,
      }),
    ).resolves.toBe('原文');
    expect(timeout).toHaveBeenCalledWith(180000);
    expect(budgets).toEqual([1024, 512]);
    reason = 'length';
    await expect(
      llm.complete(model.id, input, signal, { requireStop: true }),
    ).rejects.toMatchObject({ code: 'INCOMPLETE_OUTPUT' });
    await expect(llm.complete(model.id, input, signal)).resolves.toBe('原文');
    await expect(
      llm.complete(model.id, input, signal, { timeoutMs: 300001 }),
    ).rejects.toMatchObject({ code: 'INVALID_COMPLETION_BUDGET' });
  } finally {
    vi.restoreAllMocks();
    await engine.close();
    await upstream.close();
  }
}, 30000);

import { afterEach, expect, it } from 'vitest';
import { getProtocol, type LlmEvent } from '@frame-loom/contracts';
import { ModelWrite } from '@frame-loom/contracts';
import { mockUpstream } from '../../testing/mock-upstream.js';
import { testEngine } from '../../testing/test-engine.js';
import { ModelServicesRepository } from '../model-services/model-services.repository.js';
import { LlmService } from './llm.service.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const protocols = ['openai-responses', 'anthropic-messages', 'gemini-generate'] as const;
function stream(protocol: (typeof protocols)[number]) {
  const events =
    protocol === 'openai-responses'
      ? [
          { type: 'response.created', response: { id: 'r1', status: 'in_progress' } },
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: { id: 'm1', type: 'message', role: 'assistant', content: [] },
          },
          { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'OK' },
          {
            type: 'response.output_item.done',
            output_index: 0,
            item: {
              id: 'm1',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'OK', annotations: [] }],
            },
          },
          {
            type: 'response.completed',
            response: {
              id: 'r1',
              status: 'completed',
              output: [],
              usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
            },
          },
        ]
      : protocol === 'anthropic-messages'
        ? [
            {
              type: 'message_start',
              message: {
                id: 'm1',
                type: 'message',
                role: 'assistant',
                model: 'alias',
                content: [],
                usage: { input_tokens: 2, output_tokens: 0 },
              },
            },
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
            { type: 'content_block_stop', index: 0 },
            {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage: { output_tokens: 1 },
            },
            { type: 'message_stop' },
          ]
        : [
            {
              candidates: [
                {
                  content: { role: 'model', parts: [{ text: 'OK' }] },
                  finishReason: 'STOP',
                  index: 0,
                },
              ],
              usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
            },
          ];
  return events
    .map(
      (event) =>
        `${'type' in event ? `event: ${event.type}\n` : ''}data: ${JSON.stringify(event)}\n\n`,
    )
    .join('');
}
async function setup(protocol: (typeof protocols)[number], origin: string) {
  const engine = await testEngine();
  cleanups.push(() => engine.close());
  const repo = engine.app.get(ModelServicesRepository);
  const channel = repo.saveChannel({
    name: '测试',
    baseUrl: origin,
    apiKey: 'test-key',
    enabled: true,
  });
  const model = repo.saveModels(channel.id, [
    ModelWrite.parse({
      kind: 'chat',
      displayName: '文本',
      upstreamModelId: 'alias',
      protocolId: protocol,
      capability: getProtocol(protocol)!.templates.chat,
      endpointOverride: { submitUrl: `${origin}/exact/custom-operation`, confirmedHosts: [] },
      enabled: true,
    }),
  ])[0];
  return { llm: engine.app.get(LlmService), model };
}
it.each(protocols)('%s 两步检查、精确覆盖地址、流与用量、默认不发采样参数', async (protocol) => {
  const upstream = await mockUpstream([
    {
      method: 'GET',
      path: '/v1/models',
      headers: { authorization: 'Bearer test-key' },
      reply: () => ({ body: JSON.stringify({ data: [] }) }),
    },
    {
      method: 'POST',
      path: '/exact/custom-operation',
      headers:
        protocol === 'anthropic-messages'
          ? { 'x-api-key': 'test-key', 'anthropic-version': '2023-06-01' }
          : protocol === 'gemini-generate'
            ? { 'x-goog-api-key': 'test-key' }
            : { authorization: 'Bearer test-key' },
      reply: (req) => {
        const body = JSON.parse(req.body) as Record<string, unknown>;
        const sampling =
          protocol === 'gemini-generate'
            ? (body.generationConfig as Record<string, unknown>)
            : body;
        for (const key of [
          'temperature',
          'top_p',
          'top_k',
          'topP',
          'topK',
          'presencePenalty',
          'frequencyPenalty',
        ])
          expect(sampling?.[key]).toBeUndefined();
        return { headers: { 'content-type': 'text/event-stream' }, body: stream(protocol) };
      },
    },
  ]);
  cleanups.push(() => upstream.close());
  const { llm, model } = await setup(protocol, upstream.origin);
  const check = await llm.test(model.id);
  expect(getProtocol(protocol)!.reservedFields).toEqual(
    expect.arrayContaining(Object.keys(JSON.parse(upstream.requests[1].body) as object)),
  );
  expect(check).toMatchObject({ ok: true });
  const events: LlmEvent[] = [];
  for await (const event of llm.chat(
    { modelId: model.id, messages: [{ role: 'user', content: '测试' }] },
    new AbortController().signal,
  ))
    events.push(event);
  expect(events).toContainEqual({ type: 'text.delta', delta: 'OK' });
  expect(events.at(-1)).toMatchObject({
    type: 'done',
    usage: { input: 2, output: 1, totalTokens: 3 },
  });
  expect(upstream.requests).toHaveLength(3);
  expect(upstream.violations).toEqual([]);
});
it.each(
  protocols.flatMap((protocol) => [401, 429, 500, 302].map((status) => ({ protocol, status }))),
)('$protocol HTTP $status 安全分类且不跟随重定向', async ({ protocol, status }) => {
  const upstream = await mockUpstream([
    {
      method: 'POST',
      path: '/exact/custom-operation',
      reply: () => ({
        status,
        headers: status === 302 ? { location: '/forbidden' } : undefined,
        body: 'test-key private-detail',
      }),
    },
  ]);
  cleanups.push(() => upstream.close());
  const { llm, model } = await setup(protocol, upstream.origin);
  const events = [];
  for await (const event of llm.chat(
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
  expect(JSON.stringify(events)).not.toMatch(/test-key|private-detail/);
  expect(upstream.requests).toHaveLength(1);
  expect(upstream.violations).toEqual([]);
});

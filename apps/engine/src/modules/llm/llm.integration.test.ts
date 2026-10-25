import type { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  Channel,
  ChannelModel,
  ConnectionCheck,
  LlmProtocol,
  ModelDefaults,
  type LlmEvent,
} from '@frame-loom/contracts';
import { createEngine } from '../../application.js';
import { EngineConfig } from '../../core/config/config.js';
import { LlmService } from './llm.service.js';

const token = 'a'.repeat(64);
const secret = 'sk-unique-integration-secret-923847';
let app: INestApplication<Server>;
let upstream: Server;
let origin: string;
let remote: string;
let directory: string;
let failure = 0;
let truncated = false;
let requests = 0;
let redirect = false;
let redirectedRequests = 0;
let lastProbe: { authorization?: string; goog?: string; custom?: string } = {};
const received: {
  url: string;
  authorization?: string;
  custom?: string;
  body: Record<string, unknown>;
}[] = [];

// 使用供应商原始 SSE 格式，确保测试经过真实 SDK 解码而非替换 SDK。
function wireEvents(path: string, tool: boolean, model: string): unknown[] {
  const pathname = new URL(path, 'http://localhost').pathname;
  if (pathname.endsWith('/responses')) {
    const message = {
      type: 'message',
      id: 'msg_1',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'OK', annotations: [] }],
    };
    const call = {
      type: 'function_call',
      id: 'fc_1',
      call_id: 'call_1',
      name: 'connection_probe',
      arguments: '{"value":"OK"}',
    };
    return [
      { type: 'response.created', response: { id: 'resp_1' } },
      { type: 'response.output_item.added', output_index: 0, item: { ...message, content: [] } },
      { type: 'response.output_text.delta', output_index: 0, delta: 'OK' },
      { type: 'response.output_item.done', output_index: 0, item: message },
      ...(tool
        ? [
            {
              type: 'response.output_item.added',
              output_index: 1,
              item: { ...call, arguments: '' },
            },
            {
              type: 'response.function_call_arguments.delta',
              output_index: 1,
              delta: call.arguments,
            },
            { type: 'response.output_item.done', output_index: 1, item: call },
          ]
        : []),
      {
        type: 'response.completed',
        response: {
          id: 'resp_1',
          status: 'completed',
          output: [message, ...(tool ? [call] : [])],
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        },
      },
    ];
  }
  if (pathname.endsWith('/messages'))
    return [
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
      { type: 'content_block_stop', index: 0 },
      ...(tool
        ? [
            {
              type: 'content_block_start',
              index: 1,
              content_block: {
                type: 'tool_use',
                id: 'call_1',
                name: 'connection_probe',
                input: {},
              },
            },
            {
              type: 'content_block_delta',
              index: 1,
              delta: { type: 'input_json_delta', partial_json: '{"value":"OK"}' },
            },
            { type: 'content_block_stop', index: 1 },
          ]
        : []),
      {
        type: 'message_delta',
        delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null },
        usage: { output_tokens: 5 },
      },
      { type: 'message_stop' },
    ];
  if (pathname.includes(':streamGenerateContent'))
    return [
      {
        candidates: [
          {
            index: 0,
            content: {
              role: 'model',
              parts: [
                { text: 'OK' },
                ...(tool
                  ? [{ functionCall: { name: 'connection_probe', args: { value: 'OK' } } }]
                  : []),
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      },
    ];
  return [
    {
      id: 'chat_1',
      object: 'chat.completion.chunk',
      model,
      choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }],
    },
    ...(tool
      ? [
          {
            id: 'chat_1',
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'connection_probe', arguments: '{"value":"OK"}' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
        ]
      : []),
    {
      id: 'chat_1',
      choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    },
  ];
}
beforeAll(async () => {
  upstream = createServer((request, response) => {
    requests++;
    if (request.url === '/redirect-target') {
      redirectedRequests++;
      response.end();
      return;
    }
    if (redirect) {
      response.writeHead(307, { Location: remote + '/redirect-target' }).end();
      return;
    }
    if (failure) {
      response.writeHead(failure, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: secret } }));
      return;
    }
    if (request.method === 'GET') {
      lastProbe = {
        authorization: request.headers.authorization,
        goog: request.headers['x-goog-api-key'] as string | undefined,
        custom: request.headers['x-custom'] as string | undefined,
      };
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          data: [{ id: 'unknown' }, { id: 'unknown' }, { id: 'gpt-4o' }],
          models: [{ name: 'models/unknown' }],
        }),
      );
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      received.push({
        url: request.url!,
        authorization:
          request.headers.authorization ??
          String(request.headers['x-api-key'] ?? request.headers['x-goog-api-key']),
        custom: String(request.headers['x-custom']),
        body: parsed,
      });
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const events = wireEvents(request.url!, !!parsed.tools, String(parsed.model));
      for (const event of truncated ? events.slice(0, 2) : events) {
        const type = (event as { type?: string }).type;
        response.write(`${type ? `event: ${type}\n` : ''}data: ${JSON.stringify(event)}\n\n`);
      }
      response.end();
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  remote = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  directory = mkdtempSync(join(tmpdir(), 'frame-loom-models-'));
  app = await createEngine(new EngineConfig(token, directory, [], 'cd'.repeat(32)));
  await app.listen(0, '127.0.0.1');
  origin = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(async () => {
  await app?.close();
  if (upstream) {
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
  if (directory) rmSync(directory, { recursive: true, force: true });
});
async function call(path: string, method = 'GET', body?: unknown) {
  return fetch(origin + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
async function channel(apiFormat: LlmProtocol = 'openai-completions') {
  return Channel.parse(
    await (
      await call('/channels', 'POST', {
        name: '测试渠道',
        apiFormat,
        baseUrl: remote,
        apiKey: secret,
        headers: { 'X-Custom': 'encrypted-header-secret' },
        enabled: true,
      })
    ).json(),
  );
}
async function model(channelId: string, protocol: LlmProtocol = 'openai-completions') {
  const response = await call(`/channels/${channelId}/models`, 'POST', {
    upstreamModelId: 'unknown',
    displayName: '测试模型',
    kind: 'chat',
    protocol,
    profileId: null,
    overrides: {},
    enabled: true,
  });
  expect(response.status).toBe(201);
  return ChannelModel.parse(await response.json());
}
it('渠道读取不泄露凭据，更新保留或清除密钥，真实数据库及 WAL 不含明文', async () => {
  const created = await channel();
  expect(created.hasKey).toBe(true);
  expect(created.keyHint).toBe('••••3847');
  expect(JSON.stringify(await (await call('/channels')).json())).not.toContain(secret);
  expect(created.headerNames).toEqual(['X-Custom']);
  await call(`/channels/${created.id}`, 'PATCH', { name: '保留密钥' });
  const check = ConnectionCheck.parse(
    await (await call(`/channels/${created.id}/test`, 'POST')).json(),
  );
  expect(check.ok).toBe(true);
  for (const suffix of ['', '-wal'])
    expect(
      readFileSync(join(directory, `data/frame-loom.sqlite${suffix}`)).includes(
        Buffer.from(secret),
      ),
    ).toBe(false);
  expect(
    readFileSync(join(directory, 'data/frame-loom.sqlite-wal')).includes(
      Buffer.from('encrypted-header-secret'),
    ),
  ).toBe(false);
  const cleared = Channel.parse(
    await (await call(`/channels/${created.id}`, 'PATCH', { apiKey: '', headers: {} })).json(),
  );
  expect(cleared.hasKey).toBe(false);
  expect(cleared.headerNames).toEqual([]);
});
it('唯一约束、类别校验、默认模型验证、禁用清理与级联删除', async () => {
  const created = await channel();
  const saved = await model(created.id);
  const duplicate = await call(`/channels/${created.id}/models`, 'POST', {
    upstreamModelId: saved.upstreamModelId,
    displayName: saved.displayName,
    kind: saved.kind,
    protocol: saved.protocol,
    profileId: null,
    overrides: {},
    enabled: true,
  });
  expect(duplicate.status).toBe(409);
  expect((await call('/model-defaults', 'PUT', { image: saved.id })).status).toBe(422);
  await call('/model-defaults', 'PUT', { chat: saved.id });
  await call(`/channels/${created.id}`, 'PATCH', { enabled: false });
  expect(ModelDefaults.parse(await (await call('/model-defaults')).json()).chat).toBeNull();
  await call(`/channels/${created.id}`, 'PATCH', { enabled: true });
  await call('/model-defaults', 'PUT', { chat: saved.id });
  await call(`/channels/${created.id}`, 'DELETE');
  expect((await call(`/channel-models/${saved.id}`)).status).toBe(404);
  expect(ModelDefaults.parse(await (await call('/model-defaults')).json()).chat).toBeNull();
});
it('草稿拉取去重且不写库，编辑时复用已存密钥', async () => {
  const draft = await call('/channels/probe-models', 'POST', {
    apiFormat: 'openai-completions',
    baseUrl: remote,
    apiKey: secret,
  });
  expect(await draft.json()).toEqual(['unknown', 'gpt-4o']);
  expect(lastProbe.authorization).toBe(`Bearer ${secret}`);
  const created = await channel();
  const before = (await (await call('/channel-models')).json()) as unknown[];
  const reused = await call('/channels/probe-models', 'POST', {
    apiFormat: 'google-generative-ai',
    baseUrl: remote,
    channelId: created.id,
  });
  expect(await reused.json()).toEqual(['unknown']);
  expect(lastProbe).toMatchObject({ goog: secret, custom: 'encrypted-header-secret' });
  expect(((await (await call('/channel-models')).json()) as unknown[]).length).toBe(before.length);
});
it('渠道与模型一次保存：增改删同事务，失败整体回滚，协议须匹配类别', async () => {
  const created = await channel();
  const first = await model(created.id);
  const chat = {
    upstreamModelId: 'gpt-4o',
    displayName: 'GPT',
    kind: 'chat',
    protocol: 'openai-responses',
    profileId: null,
    overrides: {},
    enabled: true,
  };
  const saved = await call(`/channels/${created.id}`, 'PATCH', {
    name: '已改名',
    models: [chat],
  });
  expect(saved.status).toBe(200);
  let list = ChannelModel.array().parse(
    await (await call(`/channels/${created.id}/models`)).json(),
  );
  expect(list.map((item) => item.upstreamModelId)).toEqual(['gpt-4o']);
  expect((await call(`/channel-models/${first.id}`)).status).toBe(404);
  const mismatch = await call(`/channels/${created.id}`, 'PATCH', {
    name: '不应保存',
    models: [
      { ...chat, id: list[0].id },
      { ...chat, protocol: 'openai-images' },
    ],
  });
  expect(mismatch.status).toBe(422);
  const duplicate = await call(`/channels/${created.id}`, 'PATCH', {
    name: '不应保存',
    models: [chat, chat],
  });
  expect(duplicate.status).toBe(409);
  expect(Channel.parse(await (await call(`/channels/${created.id}`)).json()).name).toBe('已改名');
  list = ChannelModel.array().parse(await (await call(`/channels/${created.id}/models`)).json());
  expect(list).toHaveLength(1);
});
it.each(LlmProtocol.options)('%s 经真实 SDK 通过两步测试、文本流与用量解析', async (protocol) => {
  const created = await channel(protocol);
  const saved = await model(created.id, protocol);
  expect(saved.metadata).toMatchObject({ needsConfirmation: true, contextWindow: 8192 });
  const check = ConnectionCheck.parse(
    await (await call(`/channel-models/${saved.id}/test`, 'POST')).json(),
  );
  expect(check.ok, check.message).toBe(true);
  expect(check.steps).toMatchObject({ connection: true, text: true, toolCall: true, usage: true });
  const stream = await call('/llm/test-chat', 'POST', {
    modelId: saved.id,
    messages: [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: 'OK' },
      { role: 'user', content: '继续' },
    ],
  });
  expect(stream.headers.get('content-type')).toContain('text/event-stream');
  const events = (await stream.text())
    .trim()
    .split('\n\n')
    .map((line) => JSON.parse(line.slice(6)) as LlmEvent);
  expect(events).toContainEqual({ type: 'text.delta', delta: 'OK' });
  expect(events.at(-1)).toMatchObject({
    type: 'done',
    usage: { input: 10, output: 5, totalTokens: 15 },
  });
  expect(received.at(-1)?.authorization).toContain(secret);
  expect(received.at(-1)?.custom).toBe('encrypted-header-secret');
});
it.each(
  LlmProtocol.options.flatMap((protocol) =>
    [401, 429, 500].map((status) => ({ protocol, status })),
  ),
)('$protocol 上游 HTTP $status 分类且不回传错误正文，不重试', async ({ protocol, status }) => {
  const created = await channel();
  const saved = await model(created.id, protocol);
  const previous = requests;
  failure = status;
  try {
    const result = await call('/llm/test-chat', 'POST', {
      modelId: saved.id,
      messages: [{ role: 'user', content: '你好' }],
    });
    const body = await result.text();
    expect(body).toContain(
      status === 401 ? 'AUTH_FAILED' : status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR',
    );
    expect(body).not.toContain(secret);
    expect(requests - previous).toBe(1);
  } finally {
    failure = 0;
  }
});
it.each(LlmProtocol.options)('%s 拒绝携带凭据跟随重定向', async (protocol) => {
  const created = await channel();
  const saved = await model(created.id, protocol);
  redirect = true;
  try {
    const response = await call('/llm/test-chat', 'POST', {
      modelId: saved.id,
      messages: [{ role: 'user', content: '你好' }],
    });
    expect(await response.text()).toContain('"type":"error"');
    expect(redirectedRequests).toBe(0);
  } finally {
    redirect = false;
  }
});
it('提前结束流返回错误，取消请求停止读取；协议覆盖和精确目录匹配', async () => {
  const created = await channel();
  const saved = await model(created.id, 'openai-responses');
  truncated = true;
  try {
    const response = await call('/llm/test-chat', 'POST', {
      modelId: saved.id,
      messages: [{ role: 'user', content: '你好' }],
    });
    expect(await response.text()).toContain('"type":"error"');
  } finally {
    truncated = false;
  }
  expect(
    (
      await call(`/channel-models/${saved.id}`, 'PATCH', {
        overrides: { compat: { inventedOption: true } },
      })
    ).status,
  ).toBe(400);
  const llm = app.get<LlmService>(LlmService);
  const metadata = await llm.metadata({
    ...saved,
    upstreamModelId: 'gpt-4o',
    protocol: 'openai-completions',
  });
  expect(metadata?.needsConfirmation).toBe(false);
  const controller = new AbortController();
  controller.abort();
  const events: LlmEvent[] = [];
  for await (const event of llm.chat(
    { modelId: saved.id, messages: [{ role: 'user', content: '取消' }] },
    controller.signal,
  ))
    events.push(event);
  expect(events.at(-1)).toMatchObject({ type: 'error', code: 'REQUEST_ABORTED' });
});

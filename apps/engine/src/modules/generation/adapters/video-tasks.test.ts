import { afterEach, expect, it, vi } from 'vitest';
import { GenerationRequest } from '@frame-loom/contracts';
import { arkVideoTasks, fastaitokenVideo, minimaxVideoV2, openaiVideos } from './video-tasks.js';
import type { AdapterContext } from './types.js';

const request = GenerationRequest.parse({
  modelId: '00000000-0000-4000-8000-000000000001',
  mode: 'text',
  prompt: '测试视频',
  params: { duration: 5 },
});
const context: AdapterContext = {
  baseUrl: 'https://provider.test',
  apiKey: 'secret',
  headers: {},
  model: 'video-model',
  signal: AbortSignal.timeout(5000),
};
afterEach(() => vi.unstubAllGlobals());

it.each([
  [
    'ark',
    arkVideoTasks,
    { id: 'task-ark' },
    { id: 'task-ark', status: 'succeeded', content: { video_url: 'https://cdn.test/a.mp4' } },
  ],
  [
    'minimax',
    minimaxVideoV2,
    { task_id: 'task-mini' },
    { task: { id: 'task-mini', status: 'completed', content: { url: 'https://cdn.test/m.mp4' } } },
  ],
] as const)('%s 适配器覆盖提交、排队与成功结果', async (_name, adapter, submitted, completed) => {
  const fetchMock = vi
    .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(new Response(JSON.stringify(submitted), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(completed), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const first = await adapter.submit(context, request);
  expect(first.status).toBe('running');
  if (first.status !== 'running') throw new Error('提交未进入排队状态');
  const second = await adapter.query!(context, first.remoteTaskId);
  expect(second.status).toBe('succeeded');
  if (second.status !== 'succeeded') throw new Error('查询未返回成功状态');
  expect(second.outputs[0]?.mime).toBe('video/mp4');
  expect(second.outputs[0]?.url).toContain('.mp4');
  expect(fetchMock.mock.calls[1][0]).toContain(encodeURIComponent(first.remoteTaskId));
});

it('OpenAI 视频适配器发送 multipart 首帧，并使用内容端点标识结果', async () => {
  const fetchMock = vi
    .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
    .mockResolvedValue(
      new Response(JSON.stringify({ id: 'video_1', status: 'completed' }), { status: 200 }),
    );
  vi.stubGlobal('fetch', fetchMock);
  const result = await openaiVideos.submit(context, {
    ...request,
    mode: 'frames',
    inputs: [{ kind: 'image', role: 'first_frame', dataUrl: 'data:image/png;base64,YQ==' }],
  });
  expect(result).toEqual({
    status: 'succeeded',
    outputs: [{ mime: 'video/mp4', providerContent: 'video_1' }],
    usage: undefined,
  });
  const init = fetchMock.mock.calls[0][1];
  expect(init?.body).toBeInstanceOf(FormData);
  if (!(init?.body instanceof FormData)) throw new Error('未发送 multipart 表单');
  const body = init.body;
  expect(body.get('model')).toBe('video-model');
  expect(body.get('input_reference')).toBeInstanceOf(Blob);
});

it('视频任务审核拒绝不暴露远端正文', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ task: { id: 'task', status: 'failed', error: { code: '1026' } } }),
          { status: 200 },
        ),
      ),
  );
  await expect(minimaxVideoV2.query!(context, 'task')).resolves.toEqual({
    status: 'failed',
    category: 'moderation',
    code: '1026',
    message: '内容未通过审核',
  });
});

it('H3 查询接受外层 task_id 和 base_resp', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          task_id: 'task-h3',
          base_resp: { status_code: 0 },
          task: { status: 'completed', content: { video_url: 'https://cdn.test/h3.mp4' } },
        }),
      ),
    ),
  );
  await expect(minimaxVideoV2.query!(context, 'task-h3')).resolves.toMatchObject({
    status: 'succeeded',
  });
});

it('H3 兼容旧渠道的 /v1 地址并改用 minimax/v2 路由', async () => {
  const fetchMock = vi
    .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
    .mockResolvedValue(
      new Response(JSON.stringify({ task: { id: 'task-h3', status: 'running' } }), { status: 200 }),
    );
  vi.stubGlobal('fetch', fetchMock);
  await minimaxVideoV2.query!({ ...context, baseUrl: 'https://provider.test/v1' }, 'task-h3');
  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    'https://provider.test/minimax/v2/query/video_generation/task-h3',
  );
});

it('FastAIToken 视频使用 JSON 任务并映射 processing/completed', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'fast-1', status: 'processing' })))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 'fast-1', status: 'completed', video_url: 'https://cdn.test/f.mp4' }),
      ),
    );
  vi.stubGlobal('fetch', fetchMock);
  const submitted = await fastaitokenVideo.submit(context, request);
  expect(submitted).toMatchObject({ status: 'running', remoteTaskId: 'fast-1' });
  expect(await fastaitokenVideo.query!(context, 'fast-1')).toMatchObject({ status: 'succeeded' });
  expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'Content-Type': 'application/json' });
});

it.each([
  ['ark', arkVideoTasks],
  ['minimax', minimaxVideoV2],
  ['openai', openaiVideos],
] as const)('%s 查询覆盖排队、运行、失败与限流', async (name, adapter) => {
  const states = ['queued', 'running', 'failed'];
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
  for (const status of states) {
    const task = {
      id: 'task',
      status,
      error: status === 'failed' ? { code: 'render_failed' } : null,
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(name === 'minimax' ? { task } : task)),
    );
  }
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: { code: 'rate_limit' } }), { status: 429 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  for (const status of states.slice(0, 2)) {
    await expect(adapter.query!(context, 'task')).resolves.toMatchObject({
      status: 'running',
      remoteStatus: status,
    });
  }
  await expect(adapter.query!(context, 'task')).resolves.toMatchObject({
    status: 'failed',
    category: 'upstream',
    code: 'render_failed',
  });
  await expect(adapter.query!(context, 'task')).rejects.toMatchObject({
    category: 'rate_limit',
    safeRetry: true,
    uncertain: false,
  });
});

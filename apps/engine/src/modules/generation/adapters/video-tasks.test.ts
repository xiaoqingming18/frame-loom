import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GenerationRequest } from '@frame-loom/contracts';
import {
  arkVideoTasks,
  fastaitokenVideo,
  klingVideo,
  minimaxVideoV2,
  openaiVideos,
  wanVideo,
} from './video-tasks.js';
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

it.each([arkVideoTasks, minimaxVideoV2, openaiVideos, fastaitokenVideo])(
  '$protocol：严格 HTTP 方法、部署前缀、鉴权、请求体、查询与内容路由',
  async (adapter) => {
    const prefix = '/gateway';
    const route =
      adapter === arkVideoTasks
        ? 'contents/generations/tasks'
        : adapter === minimaxVideoV2
          ? 'minimax/v2/video_generation'
          : adapter === openaiVideos
            ? 'videos'
            : 'v1/videos/generations';
    const query =
      adapter === minimaxVideoV2
        ? 'minimax/v2/query/video_generation/remote-1'
        : adapter === fastaitokenVideo
          ? 'v1/videos/remote-1'
          : `${route}/remote-1`;
    const seen: string[] = [];
    const bodies: string[] = [];
    const contentTypes: (string | undefined)[] = [];
    const server = createServer((req, res) => {
      if (req.headers.authorization !== 'Bearer secret') {
        res.writeHead(401).end();
        return;
      }
      const key = `${req.method} ${req.url}`;
      if (![`POST ${prefix}/${route}`, `GET ${prefix}/${query}`].includes(key)) {
        res.writeHead(404).end();
        return;
      }
      seen.push(key);
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        if (req.method === 'POST') {
          bodies.push(body);
          contentTypes.push(req.headers['content-type']);
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify(
            req.method === 'POST'
              ? adapter === minimaxVideoV2
                ? { task_id: 'remote-1', base_resp: { status_code: 0 } }
                : { id: 'remote-1', status: 'queued' }
              : adapter === minimaxVideoV2
                ? {
                    task_id: 'remote-1',
                    task: {
                      status: 'completed',
                      content: { video_url: 'https://cdn.test/result.mp4' },
                    },
                  }
                : {
                    id: 'remote-1',
                    status: 'completed',
                    content: { video_url: 'https://cdn.test/result.mp4' },
                  },
          ),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const ctx = {
      ...context,
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}${prefix}`,
      signal: AbortSignal.timeout(10_000),
    };
    try {
      await expect(adapter.submit(ctx, request)).resolves.toMatchObject({
        status: 'running',
        remoteTaskId: 'remote-1',
      });
      await expect(adapter.query!(ctx, 'remote-1')).resolves.toMatchObject({ status: 'succeeded' });
      expect(seen).toEqual([`POST ${prefix}/${route}`, `GET ${prefix}/${query}`]);
      expect(contentTypes[0]).toContain(
        adapter === openaiVideos ? 'multipart/form-data' : 'application/json',
      );
      if (adapter === openaiVideos) {
        expect(bodies[0]).toContain('name="model"');
        expect(bodies[0]).toContain('video-model');
      } else expect(JSON.parse(bodies[0])).toMatchObject({ model: 'video-model', duration: 5 });
      if (adapter.contentUrl)
        expect(adapter.contentUrl(ctx, 'remote/1')).toBe(
          `${ctx.baseUrl}/${adapter === fastaitokenVideo ? 'v1/' : ''}videos/remote%2F1/content`,
        );
      await expect(
        adapter.submit({ ...ctx, connection: { routes: { submit: 'wrong' } } }, request),
      ).rejects.toMatchObject({ code: 'HTTP_404' });
      await expect(adapter.submit({ ...ctx, apiKey: 'wrong' }, request)).rejects.toMatchObject({
        category: 'auth',
      });
      expect(seen).toHaveLength(2);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

it.each(['submit', 'query'] as const)(
  'H3 %s 拒绝 HTTP 200 的业务错误，保留安全码而不透传正文',
  async (stage) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            task_id: 'remote-1',
            task: { status: 'completed', content: { video_url: 'https://cdn.test/result.mp4' } },
            base_resp: { status_code: 1008, status_msg: 'secret prompt must stay private' },
          }),
        ),
      ),
    );
    const result =
      stage === 'submit'
        ? minimaxVideoV2.submit(context, request)
        : minimaxVideoV2.query!(context, 'remote-1');
    await expect(result).rejects.toMatchObject({
      code: '1008',
      uncertain: false,
      safeRetry: false,
    });
    await expect(result).rejects.not.toHaveProperty('message', expect.stringContaining('secret'));
  },
);
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

it('Kling 使用精确文本生成路径并保留受限参数', async () => {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return new Response(
      JSON.stringify({ code: '0', data: { task_id: 'kling-1', task_status: 'submitted' } }),
      { status: 200 },
    );
  });
  await klingVideo.submit(
    { ...context, model: 'kling-v4' },
    GenerationRequest.parse({
      ...request,
      mode: 'text',
      params: { duration: 5, aspect_ratio: '16:9', ignored: 'drop' },
    }),
  );
  expect(requests[0].url).toBe('https://provider.test/v1/videos/text2video');
  expect(await requests[0].json()).toEqual({
    model_name: 'kling-v4',
    prompt: '测试视频',
    duration: 5,
    aspect_ratio: '16:9',
  });
});

it('Wan 任务查询缺少视频地址时拒绝伪成功', async () => {
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(JSON.stringify({ code: 0, data: { task_status: 'SUCCEEDED', output: {} } }), {
        status: 200,
      }),
  );
  await expect(
    wanVideo.query!({ ...context, model: 'wan3.0-video' }, 'wan-1'),
  ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

it('FastAIToken 视频使用 JSON 任务并映射 processing/completed', async () => {
  const fetchMock = vi
    .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
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

it('FastAIToken 首尾帧按角色排序，同键提交且处理中业务码不误判失败', async () => {
  const fetchMock = vi
    .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ id: 'fast-frames', status: 'processing', error_code: 'upstream_retry' }),
      ),
    );
  vi.stubGlobal('fetch', fetchMock);
  await expect(
    fastaitokenVideo.submit(
      {
        ...context,
        idempotencyKey: 'stable-key',
        referenceUrls: { first: 'https://cdn.test/first.png', last: 'https://cdn.test/last.png' },
      },
      {
        ...request,
        mode: 'frames',
        inputs: [
          { kind: 'image', role: 'last_frame', sha256: 'last' },
          { kind: 'image', role: 'first_frame', sha256: 'first' },
        ],
      },
    ),
  ).resolves.toMatchObject({ status: 'running' });
  const init = fetchMock.mock.calls[0][1]!;
  expect(init.headers).toMatchObject({ 'Idempotency-Key': 'stable-key' });
  if (typeof init.body !== 'string') throw new Error('未发送 JSON 请求体');
  expect(JSON.parse(init.body)).toMatchObject({
    mode: 'first_last_frame',
    images: ['https://cdn.test/first.png', 'https://cdn.test/last.png'],
    videos: [],
    audio: [],
    n: 1,
  });
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

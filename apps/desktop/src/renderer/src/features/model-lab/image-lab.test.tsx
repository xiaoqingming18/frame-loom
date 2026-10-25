import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GenerationJob, ModelProfile } from '@frame-loom/contracts';
import type { EngineClient } from '@/lib/engine-client';
import { ImageLab } from './image-lab';

const modelId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const channelId = '33333333-3333-4333-8333-333333333333';
const profile = ModelProfile.parse({
  id: 'test-image',
  name: '测试图片档案',
  kind: 'image',
  protocol: 'openai-images',
  matchIds: ['test-image'],
  generic: false,
  modes: [
    { id: 'text', name: '文生图' },
    { id: 'reference', name: '参考图' },
  ],
  params: [{ key: 'quality', name: '质量', type: 'enum', values: ['low', 'high'], default: 'low' }],
  constraints: [
    {
      when: { mode: 'reference' },
      param: 'quality',
      allowed: ['low'],
      message: '参考模式仅支持 low',
    },
  ],
  inputs: [
    { kind: 'image', maxCount: 1, maxBytes: 1024, mimeTypes: ['image/png'], transport: 'inline' },
  ],
  runtime: {
    concurrency: 1,
    pollInitialMs: 1000,
    pollMaxMs: 5000,
    timeoutMs: 900000,
    submitTimeoutMs: 30000,
    supportsCancel: false,
  },
});
const job = GenerationJob.parse({
  id: jobId,
  kind: 'image',
  channelModelId: modelId,
  profileId: profile.id,
  status: 'submit_unknown',
  request: { modelId, mode: 'text', prompt: '测试画面' },
  outputs: [],
  remoteTaskId: null,
  remoteStatus: null,
  attempts: 1,
  nextPollAt: null,
  errorCategory: 'network',
  errorCode: 'SUBMIT_UNKNOWN',
  errorMessage: '无法确认远端是否受理',
  createdAt: '2026-10-25T00:00:00.000Z',
  updatedAt: '2026-10-25T00:00:00.000Z',
  finishedAt: '2026-10-25T00:00:00.000Z',
});
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanup();
  cleanups.splice(0).forEach((dispose) => dispose());
});

function setup(initial: GenerationJob[] = []) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cleanups.push(() => queries.clear());
  let jobs = initial;
  const calls: { path: string; body: unknown }[] = [];
  let notify: (() => void) | undefined;
  const client: EngineClient = {
    request(path, schema, init) {
      calls.push({ path, body: init?.body });
      let value: unknown;
      if (path === '/channels') value = [{ id: channelId, name: '模拟渠道', enabled: true }];
      else if (path === '/channel-models')
        value = [
          {
            id: modelId,
            channelId,
            displayName: '测试图片',
            upstreamModelId: 'test-image',
            kind: 'image',
            protocol: 'openai-images',
            profileId: null,
            enabled: true,
          },
        ];
      else if (path === '/model-defaults')
        value = { chat: null, image: modelId, video: null, tts: null };
      else if (path === '/model-profiles') value = [profile];
      else if (path === '/generation-jobs' && !init?.method) value = jobs;
      else if (path === '/generation-jobs' || path.endsWith('/resubmit')) {
        value = { ...job, status: 'pending' };
        jobs = [value as GenerationJob];
      } else if (path.endsWith('/cancel')) {
        value = { ...job, status: 'cancelled' };
        jobs = [value as GenerationJob];
      } else if (path.endsWith('/requery')) {
        value = { ...job, status: 'running' };
        jobs = [value as GenerationJob];
      } else throw new Error(`未处理的替身请求：${path}`);
      // 渠道、模型查询由共享查询层校验；替身补齐最少的合法字段。
      if (path === '/channels')
        value = [
          {
            ...(value as object[])[0],
            apiFormat: 'openai-completions',
            baseUrl: 'http://127.0.0.1:9000',
            hasKey: true,
            keyHint: '••••1234',
            headerNames: [],
            lastCheck: null,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
          },
        ];
      if (path === '/channel-models')
        value = [{ ...(value as object[])[0], overrides: {}, metadata: null, lastCheck: null }];
      return Promise.resolve(schema.parse(value));
    },
    async *stream(_path, schema, init) {
      while (!init?.signal?.aborted) {
        await new Promise<void>((resolve) => {
          notify = resolve;
          init?.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        if (!init?.signal?.aborted) yield schema.parse({ type: 'generation.job.updated', jobId });
      }
    },
  };
  render(
    <QueryClientProvider client={queries}>
      <ImageLab client={client} />
    </QueryClientProvider>,
  );
  return {
    calls,
    update: (next: GenerationJob[]) => {
      jobs = next;
      notify?.();
    },
  };
}

it('按档案禁用不兼容选项并说明原因，参考图校验后内联提交', async () => {
  const { calls } = setup();
  await screen.findByLabelText('质量');
  fireEvent.change(screen.getByLabelText('生成模式'), { target: { value: 'reference' } });
  const invalid = screen.getByRole<HTMLOptionElement>('option', {
    name: /high（参考模式仅支持 low）/,
  });
  expect(invalid.disabled).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '生成图片' }).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('图片提示词'), { target: { value: '参考图生成' } });
  fireEvent.change(screen.getByLabelText('参考图', { exact: false }), {
    target: { files: [new File(['image'], 'reference.png', { type: 'image/png' })] },
  });
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '生成图片' }).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '生成图片' }));
  await screen.findByText('等待名额');
  expect(calls.find((call) => call.path === '/generation-jobs' && call.body)?.body).toMatchObject({
    modelId,
    mode: 'reference',
    prompt: '参考图生成',
    params: { quality: 'low' },
    inputs: [{ kind: 'image', role: 'reference', dataUrl: 'data:image/png;base64,aW1hZ2U=' }],
  });
});

it('submit_unknown 明示计费风险，重新提交须二次点击；无任务 ID 时不提供查询，支持放弃', async () => {
  const { calls } = setup([job]);
  await screen.findByText('提交结果不明');
  expect(screen.getByText(/远端可能已经受理并扣费/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '重新查询' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^重新提交$/ }));
  expect(calls.some((call) => call.path.endsWith('/resubmit'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '确认重新提交（可能再次计费）' }));
  await screen.findByText('等待名额');
  expect(calls.filter((call) => call.path.endsWith('/resubmit'))).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '放弃' }));
  await screen.findByText('已放弃');
  expect(calls.some((call) => call.path.endsWith('/cancel'))).toBe(true);
});

it('SSE 更新重查任务并显示哈希预览；有远端 ID 的失败任务提供重新查询', async () => {
  const { calls, update } = setup([{ ...job, status: 'failed', remoteTaskId: 'remote-1' }]);
  fireEvent.click(await screen.findByRole('button', { name: '重新查询' }));
  await screen.findByText('远端生成中');
  expect(calls.some((call) => call.path.endsWith('/requery'))).toBe(true);
  update([
    {
      ...job,
      status: 'succeeded',
      errorCategory: null,
      errorCode: null,
      errorMessage: null,
      outputs: [
        {
          sha256: 'a'.repeat(64),
          mime: 'image/png',
          bytes: 10,
          width: 512,
          height: 512,
          durationMs: null,
          createdAt: job.createdAt,
        },
      ],
    },
  ]);
  expect((await screen.findByRole('img', { name: '生成图片 1' })).getAttribute('src')).toBe(
    `frame-media://${'a'.repeat(64)}`,
  );
  await screen.findByText('已完成');
});

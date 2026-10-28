import { afterEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import {
  SemanticRequest,
  type ProjectSummary,
  type ProjectPageSummary,
} from '@frame-loom/contracts';
import { ModelWrite } from '@frame-loom/contracts';
import { testEngine } from '../../testing/test-engine.js';
import { mockUpstream, type MockRoute } from '../../testing/mock-upstream.js';
import { fakeProtocol } from '../../testing/fake-protocol.js';
import { ModelServicesRepository } from '../model-services/model-services.repository.js';
import { DatabaseService } from '../../core/database/database.service.js';
import { generationJobs } from './generation.schema.js';
import { GenerationService } from './generation.service.js';
import { MediaService } from './media.service.js';
import { ProtocolRegistry } from './protocols/registry.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=',
  'base64',
);
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup(
  options: {
    async?: boolean;
    disconnect?: boolean;
    submitStatus?: number;
    content?: boolean;
    downloadFailure?: boolean;
    expiredOutput?: boolean;
    holdSubmit?: boolean;
    cancel?: 'confirmed' | 'pending' | 'unknown';
    channelConcurrency?: number;
    modelConcurrency?: number;
  } = {},
) {
  const adapter = fakeProtocol();
  let polls = 0;
  let downloads = 0;
  let origin = '';
  const routes: MockRoute[] = [
    {
      method: 'POST',
      path: '/cancel',
      headers: { authorization: 'Bearer test-only-key' },
      reply: () =>
        options.cancel === 'unknown'
          ? { disconnect: true }
          : {
              status: options.cancel === 'pending' ? 202 : 200,
              body: JSON.stringify({
                status: options.cancel === 'pending' ? 'queued' : 'cancelled',
              }),
            },
    },
    {
      method: 'POST',
      path: '/v1/fake/submit',
      headers: { authorization: 'Bearer test-only-key' },
      reply: async (req) => {
        expect(JSON.parse(req.body)).toMatchObject({
          model: 'arbitrary',
          prompt: '测试',
          inputs: [],
        });
        while (options.holdSubmit) await new Promise((resolve) => setTimeout(resolve, 10));
        if (options.disconnect) return { disconnect: true };
        if (options.submitStatus)
          return { status: options.submitStatus, body: '不应暴露的上游正文' };
        return {
          body: JSON.stringify(
            options.async
              ? { status: 'running', remoteTaskId: 'task-1', remoteStatus: 'queued' }
              : {
                  status: 'succeeded',
                  outputs: options.content
                    ? [{ kind: 'content', ref: 'task-1', mime: 'image/png' }]
                    : [{ kind: 'data', base64: png.toString('base64'), mime: 'image/png' }],
                },
          ),
        };
      },
    },
    {
      method: 'GET',
      path: '/v1/fake/tasks/task-1',
      headers: { authorization: 'Bearer test-only-key' },
      reply: () => {
        polls++;
        return {
          body: JSON.stringify({
            status: 'succeeded',
            outputs: [{ kind: 'url', url: `${origin}/result.png`, mime: 'image/png' }],
          }),
        };
      },
    },
    {
      method: 'GET',
      path: '/result.png',
      reply: (req) => {
        downloads++;
        expect(req.headers.authorization).toBeUndefined();
        expect(req.headers['x-private']).toBeUndefined();
        return {
          status: options.downloadFailure
            ? 503
            : options.expiredOutput && downloads === 1
              ? 403
              : 200,
          headers: { 'Content-Type': 'image/png' },
          body: png,
        };
      },
    },
    {
      method: 'GET',
      path: '/v1/fake/content/task-1',
      headers: { authorization: 'Bearer test-only-key' },
      reply: () => ({ headers: { 'Content-Type': 'image/png' }, body: png }),
    },
    {
      method: 'GET',
      path: '/redirect',
      reply: () => ({ status: 302, headers: { Location: '/forbidden' } }),
    },
    {
      method: 'GET',
      path: '/forbidden',
      reply: () => {
        throw new Error('重定向不得访问');
      },
    },
  ];
  const upstream = await mockUpstream(routes);
  origin = upstream.origin;
  if (options.cancel) {
    adapter.descriptor.poll = { initialMs: 60000, maxMs: 60000, timeoutMs: 120000 };
    adapter.buildCancel = () => ({
      operation: 'cancel',
      method: 'POST',
      url: `${origin}/cancel`,
      headers: { Authorization: 'Bearer test-only-key' },
    });
  }
  cleanups.push(() => upstream.close());
  const s = await testEngine(adapter);
  cleanups.push(() => s.close());
  const repo = s.app.get(ModelServicesRepository);
  const channel = repo.saveChannel({
    name: '测试',
    baseUrl: `${origin}/v1`,
    apiKey: 'test-only-key',
    concurrency: Math.max(options.channelConcurrency ?? 1, options.modelConcurrency ?? 1),
    enabled: true,
  });
  const model = repo.saveModels(channel.id, [
    ModelWrite.parse({
      kind: 'image',
      upstreamModelId: 'arbitrary',
      displayName: '测试',
      protocolId: adapter.descriptor.id,
      capability: adapter.descriptor.templates.image,
      endpointOverride: {
        operations: {
          submit: `${origin}/v1/fake/submit`,
          query: `${origin}/v1/fake/tasks/{id}`,
          content: `${origin}/v1/fake/content/{id}`,
        },
        confirmedHosts: [],
      },
      enabled: true,
      concurrency: options.modelConcurrency,
    }),
  ])[0];
  if (options.channelConcurrency !== undefined)
    repo.saveChannel({ concurrency: options.channelConcurrency }, channel.id);
  return {
    s,
    upstream,
    model,
    channel,
    options,
    adapter,
    get generation() {
      return s.app.get(GenerationService);
    },
    get repo() {
      return s.app.get(ModelServicesRepository);
    },
    get db() {
      return s.app.get(DatabaseService).db;
    },
    request: () =>
      SemanticRequest.parse({ modelId: model.id, prompt: '测试', inputs: [], source: 'test' }),
    counts: () => ({ polls, downloads }),
  };
}
it('同步任务冻结快照、哈希落盘去重，媒体测试绑定配置哈希，项目写回', async () => {
  const t = await setup();
  const project = (await (
    await t.s.request('/projects', 'POST', { name: '测试项目', location: t.s.directory })
  ).json()) as ProjectSummary;
  const page = (await (
    await t.s.request(`/projects/${project.id}/pages`, 'POST', { name: '创作' })
  ).json()) as ProjectPageSummary;
  const job = await t.generation.create({ ...t.request(), projectId: project.id, pageId: page.id });
  await expect.poll(() => t.generation.get(job.id).status).toBe('succeeded');
  const result = t.generation.get(job.id);
  expect(result.outputs).toHaveLength(1);
  expect(result.outputs[0].mime).toBe('image/png');
  expect(
    await readFile(
      (await t.s.app.get(MediaService).resolve(result.outputs[0].sha256, project.id)).path,
    ),
  ).toEqual(png);
  const stored = t.db.select().from(generationJobs).where(eq(generationJobs.id, job.id)).get()!;
  expect(stored.snapshot).toMatchObject({
    protocolId: 'test-image',
    protocolVersion: 'v1',
    upstreamModelId: 'arbitrary',
    concurrencyKey: t.channel.id,
    preparedBody: { model: 'arbitrary', prompt: '测试', inputs: [] },
  });
  expect(JSON.stringify(stored)).not.toContain('test-only-key');
  expect(t.repo.getModel(t.model.id).lastCheck?.ok).toBe(true);
  const second = await t.generation.create(t.request());
  await expect.poll(() => t.generation.get(second.id).status).toBe('succeeded');
  expect(t.generation.get(second.id).outputs[0].sha256).toBe(result.outputs[0].sha256);
  expect(t.upstream.requests.filter((req) => req.method === 'POST')).toHaveLength(2);
  expect(t.upstream.violations).toEqual([]);
});
it('异步任务查询下载，无凭据下载，重启有远端 ID 只查询', async () => {
  const t = await setup({ async: true });
  const job = await t.generation.create(t.request());
  await expect.poll(() => t.generation.get(job.id).status, { interval: 5 }).toBe('running');
  await t.s.restart();
  await expect.poll(() => t.generation.get(job.id).status).toBe('succeeded');
  expect(t.upstream.requests.filter((req) => req.method === 'POST')).toHaveLength(1);
  expect(t.counts().polls).toBeGreaterThan(0);
  expect(t.counts().downloads).toBe(1);
  expect(t.upstream.violations).toEqual([]);
});
it('签名产物过期重新查询，不重投生成，下载仍不带凭据', async () => {
  const t = await setup({ async: true, expiredOutput: true });
  const job = await t.generation.create(t.request());
  await expect.poll(() => t.generation.get(job.id).status, { timeout: 15000 }).toBe('succeeded');
  expect(t.counts()).toEqual({ polls: 2, downloads: 2 });
  expect(t.upstream.requests.filter((req) => req.method === 'POST')).toHaveLength(1);
  expect(t.upstream.violations).toEqual([]);
}, 16000);
it('content 下载带凭据，重定向不跟随', async () => {
  const t = await setup({ content: true });
  const job = await t.generation.create(t.request());
  await expect.poll(() => t.generation.get(job.id).status).toBe('succeeded');
  expect(
    t.upstream.requests.find((req) => req.path.endsWith('/content/task-1'))?.headers.authorization,
  ).toBe('Bearer test-only-key');
  const adapter = t.s.app.get(ProtocolRegistry).get('test-image');
  adapter.parseSubmit = () =>
    Promise.resolve({
      status: 'succeeded',
      outputs: [{ kind: 'url', url: `${t.upstream.origin}/redirect`, mime: 'image/png' }],
    });
  const next = await t.generation.create(t.request());
  t.db
    .update(generationJobs)
    .set({ deadlineAt: new Date(Date.now() + 800).toISOString() })
    .where(eq(generationJobs.id, next.id))
    .run();
  await expect.poll(() => t.generation.get(next.id).status).toBe('download_failed');
  expect(t.upstream.requests.filter((req) => req.method === 'POST')).toHaveLength(2);
  expect(t.upstream.requests.some((req) => req.path === '/forbidden')).toBe(false);
});
it.each([
  { channelConcurrency: 1, modelConcurrency: 3 },
  { channelConcurrency: 3, modelConcurrency: 1 },
])('同渠道总并发受较小值限制，取消释放名额 %j', async (limits) => {
  const t = await setup({ holdSubmit: true, ...limits });
  const first = await t.generation.create(t.request());
  const second = await t.generation.create(t.request());
  try {
    await expect.poll(() => t.generation.get(first.id).status).toBe('submitting');
    expect(t.generation.get(second.id).status).toBe('pending');
    expect(t.upstream.requests.filter((req) => req.method === 'POST')).toHaveLength(1);
    t.generation.cancel(first.id);
    t.options.holdSubmit = false;
    await expect.poll(() => t.generation.get(second.id).status).toBe('succeeded');
    expect(t.generation.get(first.id).status).toBe('cancelled');
  } finally {
    t.options.holdSubmit = false;
  }
});
it('超限请求在创建时返回 422，不落任务也不发上游请求', async () => {
  const t = await setup();
  t.adapter.buildSubmit = () =>
    Promise.resolve({
      operation: 'submit',
      method: 'POST',
      url: `${t.upstream.origin}/v1/fake/submit`,
      headers: {},
      body: 'x'.repeat(64 * 1024 * 1024 + 1),
    });
  await expect(t.generation.create(t.request())).rejects.toMatchObject({
    code: 'REQUEST_TOO_LARGE',
    status: 422,
  });
  expect(t.generation.list()).toEqual([]);
  expect(t.upstream.requests).toHaveLength(0);
});
it('submitting 重启变结果不明，pending 重启继续，快照不受当前模型改动影响', async () => {
  const t = await setup();
  const unknown = await t.generation.create(t.request());
  t.db
    .update(generationJobs)
    .set({ status: 'submitting' })
    .where(eq(generationJobs.id, unknown.id))
    .run();
  const pending = await t.generation.create(t.request());
  t.repo.updateModel(
    t.model.id,
    ModelWrite.parse({
      kind: 'image',
      upstreamModelId: 'changed-model',
      displayName: '已修改',
      protocolId: t.adapter.descriptor.id,
      capability: t.adapter.descriptor.templates.image,
      endpointOverride: { ...t.model.endpointOverride },
      enabled: true,
    }),
  );
  await t.s.restart();
  expect(t.generation.get(unknown.id).status).toBe('submit_unknown');
  await expect.poll(() => t.generation.get(pending.id).status).toBe('succeeded');
  expect(t.upstream.requests.filter((req) => req.method === 'POST')).toHaveLength(1);
  expect(JSON.parse(t.upstream.requests.find((req) => req.method === 'POST')!.body)).toMatchObject({
    model: 'arbitrary',
  });
});
it.each([{ disconnect: true }, { submitStatus: 503 }])('提交结果不明不重投 %j', async (options) => {
  const t = await setup(options);
  const job = await t.generation.create(t.request());
  await expect.poll(() => t.generation.get(job.id).status).toBe('submit_unknown');
  await expect(t.generation.resubmit(job.id)).rejects.toMatchObject({ code: 'UNSAFE_RESUBMIT' });
  await t.s.restart();
  expect(t.generation.get(job.id).status).toBe('submit_unknown');
  expect(t.upstream.requests.filter((req) => req.method === 'POST')).toHaveLength(1);
});
it('凭据变更暂停，恢复原凭据后继续；本地放弃与远端取消分开', async () => {
  const t = await setup();
  const job = await t.generation.create(t.request());
  t.repo.saveChannel({ apiKey: 'different-test-key' }, t.channel.id);
  await expect.poll(() => t.generation.get(job.id).status).toBe('paused');
  expect(t.upstream.requests).toHaveLength(0);
  expect(t.generation.get(job.id).errorMessage).toContain('凭据');
  t.repo.saveChannel({ apiKey: 'test-only-key' }, t.channel.id);
  t.generation.requery(job.id);
  await expect.poll(() => t.generation.get(job.id).status).toBe('succeeded');
  const abandoned = await t.generation.create(t.request());
  t.generation.cancel(abandoned.id);
  await expect(t.generation.cancelRemote(abandoned.id)).rejects.toMatchObject({
    code: 'CANCEL_UNAVAILABLE',
  });
  expect(t.generation.get(abandoned.id).status).toBe('cancelled');
});
it('请求校验、URL 交付无存储与非法素材在提交前拦截', async () => {
  const t = await setup();
  await expect(
    t.generation.create({ ...t.request(), params: { quality: 'unknown' } }),
  ).rejects.toMatchObject({ code: 'INVALID_GENERATION_REQUEST' });
  const media = await t.s.app.get(MediaService).saveStream([png]);
  // 传输白名单由正式描述控制；测试通过快照前的注册适配器覆盖交付默认值。
  t.adapter.descriptor.transports.image!.auto = 'url';
  await expect(
    t.generation.create({
      ...t.request(),
      inputs: [{ role: 'reference', kind: 'image', order: 0, sha256: media.sha256 }],
    }),
  ).rejects.toMatchObject({ code: 'OBJECT_STORAGE_REQUIRED' });
  expect(t.upstream.requests).toHaveLength(0);
});
it.each(['confirmed', 'pending', 'unknown'] as const)(
  '远端取消只在明确回执后完成：%s',
  async (cancel) => {
    const t = await setup({ async: true, cancel });
    const job = await t.generation.create(t.request());
    await expect.poll(() => t.generation.get(job.id).status).toBe('running');
    const result = await t.generation.cancelRemote(job.id);
    expect(result.status).toBe(cancel === 'confirmed' ? 'cancelled' : 'paused');
    const row = t.db.select().from(generationJobs).where(eq(generationJobs.id, job.id)).get()!;
    expect(row.snapshot.cancellation).toBe(cancel === 'pending' ? 'requested' : cancel);
    expect(t.upstream.requests.filter((req) => req.path === '/cancel')).toHaveLength(1);
    expect(t.upstream.violations).toEqual([]);
  },
);
it('下载失败只重试下载，已经下载的索引不重下', async () => {
  const t = await setup({ async: true, downloadFailure: true });
  const job = await t.generation.create(t.request());
  await expect.poll(() => t.counts().downloads).toBeGreaterThan(0);
  t.options.downloadFailure = false;
  await expect.poll(() => t.generation.get(job.id).status).toBe('succeeded');
  expect(t.upstream.requests.filter((req) => req.method === 'POST')).toHaveLength(1);
  expect(t.counts().downloads).toBeGreaterThan(1);
});

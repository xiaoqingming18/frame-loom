import type { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, expect, it } from 'vitest';
import { GenerationJob, GenerationRequest, type ImageProtocol } from '@frame-loom/contracts';
import { createEngine } from '../../application.js';
import { EngineConfig } from '../../core/config/config.js';
import { DatabaseService } from '../../core/database/database.service.js';
import { EventBus } from '../../core/events/event-bus.js';
import { ChannelsRepository } from '../channels/channels.repository.js';
import { GenerationAdapters, GenerationService } from './generation.service.js';
import { generationJobs, mediaFiles } from './generation.schema.js';
import { MediaService } from './media.service.js';
import type { AdapterResult } from './adapters/types.js';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=';
const token = 'a'.repeat(64);
const secret = 'sk-generation-private-key-932847';
const arkFixture = JSON.parse(
  await readFile(new URL('./adapters/fixtures/ark-images.json', import.meta.url), 'utf8'),
) as { jpegBase64: string; data: { url: string }[] };
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(
  modelOptions: { upstreamModelId: string; protocol: ImageProtocol } = {
    upstreamModelId: 'gpt-image-1',
    protocol: 'openai-images',
  },
) {
  const directory = await mkdtemp(join(tmpdir(), 'loom-generation-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  let submissions = 0;
  let downloads = 0;
  let polls = 0;
  let mode:
    'success' | 'timeout' | 'limit' | 'download' | 'async' | 'hold' | 'server-error' | 'jpeg' =
    'success';
  let release: (() => void) | undefined;
  const upstream = createServer((req, res) => {
    if (req.url === '/result.jpg') {
      downloads++;
      // 故意声明错误类型，入库必须以真实字节为准。
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(Buffer.from(arkFixture.jpegBase64, 'base64'));
      return;
    }
    if (req.url === '/result.png') {
      downloads++;
      res.writeHead(downloads === 1 ? 503 : 200, { 'Content-Type': 'image/png' });
      res.end(Buffer.from(png, 'base64'));
      return;
    }
    if (req.url === '/poll/remote-1') {
      polls++;
      res.writeHead(polls === 1 ? 429 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'succeeded', outputs: [{ data: png, mime: 'image/png' }] }));
      return;
    }
    req.resume();
    req.on('end', () => {
      submissions++;
      const success = () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify(
            mode === 'jpeg'
              ? { ...arkFixture, data: [{ ...arkFixture.data[0], url: `${remote}/result.jpg` }] }
              : mode === 'async'
                ? { status: 'running', remoteTaskId: 'remote-1', remoteStatus: 'queued' }
                : mode === 'download'
                  ? { data: [{ url: `${remote}/result.png` }] }
                  : { data: [{ b64_json: png }] },
          ),
        );
      };
      if (mode === 'timeout') return;
      if (mode === 'hold') {
        release = success;
        return;
      }
      if (mode === 'server-error' || (mode === 'limit' && submissions === 1)) {
        res.writeHead(mode === 'server-error' ? 503 : 429, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { code: mode === 'server-error' ? 'server_error' : 'rate_limit_exceeded' },
          }),
        );
        return;
      }
      success();
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const remote = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  cleanups.push(async () => {
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });
  const config = new EngineConfig(token, directory, [], 'b'.repeat(64));
  let app: INestApplication<Server>;
  async function boot() {
    app = await createEngine(config);
    await app.listen(0, '127.0.0.1');
    return app;
  }
  await boot();
  cleanups.push(async () => app.close());
  const channels = app!.get(ChannelsRepository);
  const channel = channels.saveChannel({
    name: '测试',
    apiFormat: 'openai-completions',
    baseUrl: remote,
    apiKey: secret,
    enabled: true,
  });
  const model = channels.saveModel(channel.id, {
    upstreamModelId: modelOptions.upstreamModelId,
    displayName: '图片',
    kind: 'image',
    protocol: modelOptions.protocol,
    profileId: null,
    overrides: {},
    enabled: true,
  });
  const request = GenerationRequest.parse({ modelId: model.id, mode: 'text', prompt: '测试图片' });
  async function create(overrides: Partial<GenerationRequest> = {}, submitTimeoutMs = 3000) {
    const job = await app.get(GenerationService).create({ ...request, ...overrides });
    const db = app.get(DatabaseService).db;
    const row = db.select().from(generationJobs).where(eq(generationJobs.id, job.id)).get()!;
    db.update(generationJobs)
      .set({
        profile: {
          ...row.profile,
          runtime: { ...row.profile.runtime, pollInitialMs: 50, pollMaxMs: 200, submitTimeoutMs },
        },
      })
      .where(eq(generationJobs.id, job.id))
      .run();
    return job;
  }
  const job = (id: string) => app.get(GenerationService).get(id);
  const waitStatus = async (id: string, status: GenerationJob['status']) => {
    await expect.poll(() => job(id).status, { timeout: 8000, interval: 30 }).toBe(status);
    return job(id);
  };
  return {
    directory,
    remote,
    model,
    request,
    create,
    job,
    waitStatus,
    get app() {
      return app;
    },
    setMode(value: typeof mode) {
      mode = value;
    },
    get submissions() {
      return submissions;
    },
    get downloads() {
      return downloads;
    },
    get polls() {
      return polls;
    },
    release() {
      release?.();
    },
    async restart() {
      await app.close();
      await boot();
    },
  };
}

it('真实 HTTP 创建图片任务、发布事件、哈希落盘并去重，接口与数据库不含凭据或内联请求', async () => {
  const context = await setup();
  const origin = await context.app.getUrl();
  const storage = await fetch(`${origin}/object-storage`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(storage.status).toBe(200);
  expect(storage.headers.get('content-type')).toContain('application/json');
  expect(await storage.json()).toBeNull();

  const changed: string[] = [];
  context.app.get(EventBus).events.subscribe((event) => {
    if (event.type === 'generation.job.updated') changed.push(event.jobId);
  });
  const response = await fetch(`${origin}/generation-jobs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(context.request),
  });
  expect(response.status).toBe(201);
  const first = GenerationJob.parse(await response.json());
  const completed = await context.waitStatus(first.id, 'succeeded');
  expect(completed.outputs[0]).toMatchObject({ width: 1, height: 1, mime: 'image/png' });
  expect(completed.outputs[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
  const second = await context.create({
    mode: 'reference',
    inputs: [{ kind: 'image', role: 'reference', dataUrl: `data:image/png;base64,${png}` }],
  });
  await context.waitStatus(second.id, 'succeeded');
  const files = await readdir(join(context.directory, 'media'));
  expect(files).toEqual([`${completed.outputs[0].sha256}.png`]);
  const rows = context.app.get(DatabaseService).db.select().from(generationJobs).all();
  expect(JSON.stringify(rows)).not.toContain(png);
  expect(JSON.stringify(rows)).not.toContain(secret);
  expect(changed.filter((id) => id === first.id).length).toBeGreaterThanOrEqual(4);
  expect(JSON.stringify(context.app.get(GenerationService).list())).not.toContain('rawResponse');
  const file = await readFile(join(context.directory, 'data', 'frame-loom.sqlite'));
  expect(file.includes(Buffer.from(secret))).toBe(false);
});

it('Seedream 4.5 快照匹配、JPEG 固件下载与哈希入库保留真实格式', async () => {
  const context = await setup({
    upstreamModelId: 'doubao-seedream-4-5-251128',
    protocol: 'ark-images',
  });
  context.setMode('jpeg');
  const job = await context.create({
    params: { aspectRatio: '16:9', resolution: '2K', watermark: false },
  });
  const row = context.app
    .get(DatabaseService)
    .db.select()
    .from(generationJobs)
    .where(eq(generationJobs.id, job.id))
    .get()!;
  expect(row.profile.id).toBe('ark-images-seedream-4.5');
  const completed = await context.waitStatus(job.id, 'succeeded');
  expect(completed.outputs[0]).toMatchObject({ mime: 'image/jpeg', width: 1, height: 1 });
  const stored = context.app.get(MediaService).get(completed.outputs[0].sha256);
  expect(stored).toMatchObject({ mime: 'image/jpeg', ext: 'jpg' });
  expect(await readFile(join(context.directory, 'media', `${stored.sha256}.jpg`))).toEqual(
    Buffer.from(arkFixture.jpegBase64, 'base64'),
  );
  expect(context.downloads).toBe(1);
  expect(context.submissions).toBe(1);
});

it('提交超时进入 submit_unknown，后续调度不会自动重提；503 同样保守处理', async () => {
  const context = await setup();
  context.setMode('timeout');
  const job = await context.create({}, 60);
  await context.waitStatus(job.id, 'submit_unknown');
  // 再完成另一项任务，确保调度器确实继续运转且未重提旧任务。
  context.setMode('success');
  const second = await context.create();
  await context.waitStatus(second.id, 'succeeded');
  expect(context.submissions).toBe(2);
  context.setMode('server-error');
  const third = await context.create();
  expect((await context.waitStatus(third.id, 'submit_unknown')).errorCode).toBe('server_error');
  expect(context.submissions).toBe(3);
});

it('同一渠道模型并发为 1；取消活动任务释放名额且不会被迟到响应改写', async () => {
  const context = await setup();
  context.setMode('hold');
  const first = await context.create();
  const second = await context.create();
  await expect.poll(() => context.submissions).toBe(1);
  expect(context.job(second.id).status).toBe('pending');
  expect(context.app.get(GenerationService).cancel(first.id).status).toBe('cancelled');
  context.setMode('success');
  context.release();
  await context.waitStatus(second.id, 'succeeded');
  expect(context.job(first.id).status).toBe('cancelled');
  expect(context.submissions).toBe(2);
});

it('明确 429 保存下次执行时刻后退避，下载失败只重试下载', async () => {
  const context = await setup();
  context.setMode('limit');
  const limited = await context.create();
  await expect.poll(() => context.job(limited.id).errorCategory).toBe('rate_limit');
  expect(context.job(limited.id).nextPollAt).not.toBeNull();
  await context.waitStatus(limited.id, 'succeeded');
  expect(context.submissions).toBe(2);
  context.setMode('download');
  const downloading = await context.create();
  await context.waitStatus(downloading.id, 'succeeded');
  expect(context.downloads).toBe(2);
  expect(context.submissions).toBe(3);
});

it('引擎在 submitting 退出后恢复为 submit_unknown；pending 与 downloading 重启继续', async () => {
  const context = await setup();
  context.setMode('timeout');
  const submitting = await context.create();
  await expect.poll(() => context.submissions).toBe(1);
  const pending = await context.create();
  await context.restart();
  expect(context.job(submitting.id).status).toBe('submit_unknown');
  context.setMode('success');
  await context.waitStatus(pending.id, 'succeeded');
  expect(context.submissions).toBe(2);
  const downloading = await context.create();
  context.app
    .get(DatabaseService)
    .db.update(generationJobs)
    .set({ status: 'downloading', rawResponse: [{ data: png, mime: 'image/png' }] })
    .where(eq(generationJobs.id, downloading.id))
    .run();
  await context.restart();
  await context.waitStatus(downloading.id, 'succeeded');
  expect(context.submissions).toBe(2);
});

it('running 重启后继续查询；查询 429 不失败、不重新提交；失败任务可手动重新查询', async () => {
  const context = await setup();
  context.setMode('async');
  const adapter = {
    protocol: 'openai-images' as const,
    async submit() {
      const response = await fetch(`${context.remote}/submit`, { method: 'POST' });
      return (await response.json()) as AdapterResult;
    },
    async query() {
      const response = await fetch(`${context.remote}/poll/remote-1`);
      if (!response.ok) throw new Error('查询暂时不可用');
      return (await response.json()) as AdapterResult;
    },
  };
  context.app.get(GenerationAdapters).adapters.set('openai-images', adapter);
  const job = await context.create();
  await context.waitStatus(job.id, 'running');
  await context.restart();
  context.app.get(GenerationAdapters).adapters.set('openai-images', adapter);
  await context.waitStatus(job.id, 'succeeded');
  expect(context.submissions).toBe(1);
  expect(context.polls).toBeGreaterThanOrEqual(2);
  context.app
    .get(DatabaseService)
    .db.update(generationJobs)
    .set({ status: 'failed', errorCategory: 'timeout', deadlineAt: '2000-01-01T00:00:00.000Z' })
    .where(eq(generationJobs.id, job.id))
    .run();
  expect(context.app.get(GenerationService).requery(job.id).status).toBe('running');
  await context.waitStatus(job.id, 'succeeded');
  expect(context.submissions).toBe(1);
});

it('重新提交产生新任务；同步图片不提供重新查询；非法参考和参数在提交前拦截', async () => {
  const context = await setup();
  context.setMode('timeout');
  const first = await context.create({}, 30);
  await context.waitStatus(first.id, 'submit_unknown');
  expect(() => context.app.get(GenerationService).requery(first.id)).toThrow('没有可重新查询');
  context.setMode('success');
  const second = await context.app.get(GenerationService).resubmit(first.id);
  expect(second.id).not.toBe(first.id);
  await context.waitStatus(second.id, 'succeeded');
  expect(context.job(first.id).status).toBe('submit_unknown');
  await expect(context.create({ params: { arbitrary: true } })).rejects.toThrow('白名单');
  await expect(
    context.create({
      mode: 'reference',
      inputs: [{ kind: 'image', role: 'reference', dataUrl: 'data:image/png;base64,YQ==' }],
    }),
  ).rejects.toThrow('有效图片');
  expect(context.app.get(DatabaseService).db.select().from(mediaFiles).all()).toHaveLength(1);
  expect(context.submissions).toBe(2);
  const output = await context.app.get(MediaService).save({ data: png, mime: 'image/png' });
  expect(output.width).toBe(1);
});

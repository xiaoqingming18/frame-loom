import type { INestApplication } from '@nestjs/common';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { GenerationRequest, type GenerationStatus } from '@frame-loom/contracts';
import { createEngine } from '../../application.js';
import { EngineConfig } from '../../core/config/config.js';
import { DatabaseService } from '../../core/database/database.service.js';
import { ChannelsRepository } from '../channels/channels.repository.js';
import { GenerationService } from './generation.service.js';
import { generationJobs, providerUploads } from './generation.schema.js';
import { MediaService } from './media.service.js';

it('持久化上传、调用快照与同键恢复不重复生成，下载重试不带鉴权', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-recovery-'));
  const video = await readFile(new URL('./adapters/fixtures/reference.mp4', import.meta.url));
  const submissions: { path: string; key: string; body: string }[] = [];
  let uploads = 0;
  let polls = 0;
  let downloads = 0;
  let loseSubmit = false;
  let badUpload = false;
  let badDownload = false;
  const violations: string[] = [];
  const upstream = createServer((req, res) => {
    if (req.method === 'GET' && req.url?.startsWith('/result.mp4')) {
      downloads++;
      if (req.headers.authorization || req.headers['x-private'])
        violations.push('CDN 收到渠道凭据');
      res.writeHead(badDownload ? 503 : 200, { 'Content-Type': 'video/mp4' }).end(video);
      return;
    }
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('x-request-id', 'request-safe');
      if (req.method === 'POST' && req.url === '/api/v1/uploads') {
        uploads++;
        if (
          !req.headers['content-type']?.includes('multipart/form-data') ||
          !body.includes('name="file"')
        )
          violations.push('上传不是 file multipart');
        res.end(
          JSON.stringify({
            url: badUpload ? 'http://127.0.0.1/private' : `https://8.8.8.8/ref-${uploads}.mp4`,
          }),
        );
      } else if (req.method === 'POST' && req.url === '/v1/videos/generations') {
        submissions.push({ path: req.url, key: String(req.headers['idempotency-key']), body });
        if (loseSubmit) res.destroy();
        else res.end(JSON.stringify({ id: 'remote-1', status: 'processing' }));
      } else if (req.method === 'GET' && req.url === '/v1/videos/remote-1') {
        polls++;
        res.end(
          JSON.stringify({
            status: 'completed',
            video_url: `${origin}/result.mp4?signature=private-signed-value`,
          }),
        );
      } else res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  const config = new EngineConfig('a'.repeat(64), directory, [], 'b'.repeat(64));
  let app: INestApplication | undefined;
  async function boot() {
    app = await createEngine(config);
    await app.listen(0, '127.0.0.1');
  }
  const service = () => app!.get(GenerationService);
  const db = () => app!.get(DatabaseService).db;
  const wait = async (id: string, status: GenerationStatus) => {
    await expect.poll(() => service().get(id).status, { timeout: 8000, interval: 30 }).toBe(status);
    return service().get(id);
  };
  try {
    await boot();
    const repository = () => app!.get(ChannelsRepository);
    const channel = repository().saveChannel({
      name: '恢复测试',
      apiFormat: 'openai-completions',
      baseUrl: origin,
      apiKey: 'original-secret',
      headers: { 'X-Private': 'header-secret' },
      enabled: true,
    });
    const model = repository().saveModel(channel.id, {
      upstreamModelId: 'seedance-2.5-token',
      displayName: '视频',
      kind: 'video',
      protocol: 'fastaitoken-video',
      profileId: null,
      overrides: {},
      enabled: true,
    });
    const media = await app!.get(MediaService).saveStream([video]);
    await expect(
      service().create(
        GenerationRequest.parse({ modelId: model.id, mode: 'text', prompt: '中'.repeat(5462) }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_GENERATION_REQUEST' });
    async function create() {
      const job = await service().create(
        GenerationRequest.parse({
          modelId: model.id,
          mode: 'reference',
          prompt: '不可出现在诊断的提示词',
          inputs: [{ kind: 'video', role: 'reference', sha256: media.sha256 }],
        }),
      );
      const row = db().select().from(generationJobs).where(eq(generationJobs.id, job.id)).get()!;
      db()
        .update(generationJobs)
        .set({
          profile: {
            ...row.profile,
            runtime: {
              ...row.profile.runtime,
              pollInitialMs: 30,
              pollMaxMs: 60,
              submitTimeoutMs: 1000,
            },
          },
        })
        .where(eq(generationJobs.id, job.id))
        .run();
      return job;
    }
    loseSubmit = true;
    const first = await create();
    await wait(first.id, 'submit_unknown');
    expect(service().get(first.id).recoveryAction).toBe('idempotent_submit');
    expect(uploads).toBe(1);
    repository().updateModel(model.id, {
      ...model,
      upstreamModelId: 'changed-model',
      connection: { baseUrl: 'http://127.0.0.1:1/wrong' },
    });
    await app!.close();
    await boot();
    loseSubmit = false;
    expect((await service().resubmit(first.id)).id).toBe(first.id);
    await wait(first.id, 'succeeded');
    expect(uploads).toBe(1);
    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toEqual(submissions[0]);
    expect(submissions[0]).toMatchObject({ path: '/v1/videos/generations', key: first.id });
    expect(JSON.parse(submissions[0].body)).toMatchObject({
      model: 'seedance-2.5-token',
      mode: 'omni',
      duration: 5,
      resolution: '720p',
      videos: ['https://8.8.8.8/ref-1.mp4'],
    });
    repository().updateModel(model.id, { ...model });
    const second = await create();
    await wait(second.id, 'succeeded');
    expect(uploads).toBe(1);
    db().update(providerUploads).set({ expiresAt: '2000-01-01T00:00:00.000Z' }).run();
    const third = await create();
    await wait(third.id, 'succeeded');
    expect(uploads).toBe(2);
    // 凭据变更隔离上传记录；旧任务暂停，恢复原凭据才能继续。
    const fourth = await create();
    repository().saveChannel({ apiKey: 'new-secret' }, channel.id);
    await wait(fourth.id, 'paused');
    expect(service().get(fourth.id).errorCode).toBe('MODEL_DISABLED');
    const fifth = await create();
    await wait(fifth.id, 'succeeded');
    expect(uploads).toBe(3);
    repository().saveChannel({ apiKey: 'original-secret' }, channel.id);
    await service().resubmit(fourth.id);
    await wait(fourth.id, 'succeeded');
    expect(uploads).toBe(3);
    const before = submissions.length;
    const deletedKey = await create();
    repository().saveChannel({ apiKey: '' }, channel.id);
    await wait(deletedKey.id, 'paused');
    expect(service().get(deletedKey.id).errorCode).toBe('MODEL_DISABLED');
    expect(submissions).toHaveLength(before);
    repository().saveChannel({ apiKey: 'original-secret' }, channel.id);
    service().cancel(deletedKey.id);
    const result = service().get(first.id);
    db()
      .update(generationJobs)
      .set({
        status: 'download_failed',
        outputs: [],
        snapshot: {
          ...db().select().from(generationJobs).where(eq(generationJobs.id, result.id)).get()!
            .snapshot!,
          completedDownloads: [],
        },
        rawResponse: [
          { url: `${origin}/result.mp4?signature=private-signed-value`, mime: 'video/mp4' },
        ],
      })
      .where(eq(generationJobs.id, result.id))
      .run();
    badDownload = true;
    service().requery(first.id);
    await expect.poll(() => service().get(first.id).errorCode).toBe('DOWNLOAD_503');
    db()
      .update(generationJobs)
      .set({ deadlineAt: '2000-01-01T00:00:00.000Z', nextPollAt: null })
      .where(eq(generationJobs.id, first.id))
      .run();
    await wait(first.id, 'download_failed');
    expect(service().get(first.id).recoveryAction).toBe('download');
    badDownload = false;
    await service().resubmit(first.id);
    await wait(first.id, 'succeeded');
    expect(submissions).toHaveLength(before);
    expect(service().get(first.id).diagnostic).toMatchObject({
      stage: 'download',
      route: `${origin}/result.mp4`,
      httpStatus: 200,
    });
    expect(JSON.stringify(service().get(first.id).diagnostic)).not.toMatch(
      /secret|signature|不可出现/,
    );
    // 未知上传与旧任务均不会因恢复而再次 POST。
    db().delete(providerUploads).run();
    badUpload = true;
    const unknown = await create();
    await wait(unknown.id, 'paused');
    expect(service().get(unknown.id)).toMatchObject({
      errorCode: 'UPLOAD_UNKNOWN',
      recoveryAction: 'none',
    });
    await expect(service().resubmit(unknown.id)).rejects.toMatchObject({ code: 'UNSAFE_RESUBMIT' });
    await app!.close();
    await boot();
    const again = await create();
    await wait(again.id, 'paused');
    expect(uploads).toBe(4);
    expect(submissions).toHaveLength(before);
    db()
      .update(generationJobs)
      .set({ status: 'running', snapshot: null, remoteTaskId: 'legacy-id', nextPollAt: null })
      .where(eq(generationJobs.id, again.id))
      .run();
    await wait(again.id, 'paused');
    expect(service().get(again.id).errorCode).toBe('LEGACY_SNAPSHOT_MISSING');
    expect(submissions).toHaveLength(before);
    expect(polls).toBeGreaterThan(0);
    expect(downloads).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  } finally {
    await app?.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

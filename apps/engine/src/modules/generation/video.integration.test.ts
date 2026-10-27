import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { GenerationRequest } from '@frame-loom/contracts';
import { createEngine } from '../../application.js';
import { EngineConfig } from '../../core/config/config.js';
import { DatabaseService } from '../../core/database/database.service.js';
import { ChannelsRepository } from '../channels/channels.repository.js';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';
import { GenerationService } from './generation.service.js';
import { generationJobs, mediaFiles } from './generation.schema.js';
import { MediaService } from './media.service.js';

it.each(['openai-videos', 'fastaitoken-video'] as const)(
  '%s 内容端点按部署前缀携带渠道凭据下载并落盘',
  async (protocol) => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-content-'));
    const video = await readFile(new URL('./adapters/fixtures/reference.mp4', import.meta.url));
    const route = protocol === 'openai-videos' ? 'videos' : 'v1/videos/generations';
    const content =
      protocol === 'openai-videos' ? 'videos/task-1/content' : 'v1/videos/task-1/content';
    const seen: string[] = [];
    const server = createServer((req, res) => {
      if (req.headers.authorization !== 'Bearer content-secret') {
        res.writeHead(401).end();
        return;
      }
      const key = `${req.method} ${req.url}`;
      if (key === `POST /gateway/${route}`) {
        seen.push(key);
        req.resume();
        res
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ id: 'task-1', status: 'completed' }));
      } else if (protocol === 'fastaitoken-video' && key === 'GET /gateway/v1/videos/task-1') {
        seen.push(key);
        res
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ id: 'task-1', status: 'completed' }));
      } else if (key === `GET /gateway/${content}`) {
        seen.push(key);
        res.writeHead(200, { 'Content-Type': 'video/mp4' }).end(video);
      } else res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const app = await createEngine(new EngineConfig('a'.repeat(64), directory, [], 'b'.repeat(64)));
    try {
      await app.listen(0, '127.0.0.1');
      const channels = app.get(ChannelsRepository);
      const channel = channels.saveChannel({
        name: '内容下载验收',
        apiFormat: 'openai-completions',
        baseUrl: origin,
        apiKey: 'content-secret',
        enabled: true,
      });
      const model = channels.saveModel(channel.id, {
        upstreamModelId: 'seedance-2.5-token',
        displayName: '视频',
        kind: 'video',
        protocol,
        profileId: protocol === 'openai-videos' ? 'openai-videos-default' : null,
        overrides: {},
        enabled: true,
        connection: { baseUrl: `${origin}/gateway` },
      });
      const generation = app.get(GenerationService);
      const job = await generation.create(
        GenerationRequest.parse({ modelId: model.id, mode: 'text', prompt: '测试' }),
      );
      const db = app.get(DatabaseService).db;
      const row = db.select().from(generationJobs).where(eq(generationJobs.id, job.id)).get()!;
      db.update(generationJobs)
        .set({
          profile: {
            ...row.profile,
            runtime: { ...row.profile.runtime, pollInitialMs: 20, pollMaxMs: 50 },
          },
        })
        .where(eq(generationJobs.id, job.id))
        .run();
      await expect.poll(() => generation.get(job.id).status, { timeout: 10000 }).toBe('succeeded');
      expect(generation.get(job.id).outputs).toHaveLength(1);
      expect(generation.get(job.id).outputs[0]).toMatchObject({
        mime: 'video/mp4',
        durationMs: 2000,
      });
      expect(seen).toEqual([
        `POST /gateway/${route}`,
        ...(protocol === 'fastaitoken-video' ? ['GET /gateway/v1/videos/task-1'] : []),
        `GET /gateway/${content}`,
      ]);
    } finally {
      await app.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
  15000,
);

it('视频完整流程验证探测、参考限制、S3 去重与四步连接、过期结果重新查询及 JSON 删除响应', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-video-'));
  const video = await readFile(new URL('./adapters/fixtures/reference.mp4', import.meta.url));
  const objects = new Map<string, Buffer>();
  const references: string[] = [];
  let uploads = 0;
  let polls = 0;
  let expiredDownloads = 0;
  const serverErrors: unknown[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url!, 'http://localhost');
      if (url.pathname.startsWith('/bucket/')) {
        if (req.method === 'PUT') {
          const chunks: Buffer[] = [];
          for await (const chunk of req as AsyncIterable<Uint8Array>)
            chunks.push(Buffer.from(chunk));
          objects.set(url.pathname, Buffer.concat(chunks));
          if (!url.pathname.includes('.connection-test-')) uploads++;
          expect(req.headers.authorization).toContain('AWS4-HMAC-SHA256');
        } else if (req.method === 'DELETE') objects.delete(url.pathname);
        else {
          expect(req.headers.authorization).toBeUndefined();
          expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
          res.end(objects.get(url.pathname));
          return;
        }
        res.end();
        return;
      }
      if (url.pathname === '/expired.mp4') {
        expiredDownloads++;
        res.writeHead(403).end();
        return;
      }
      if (url.pathname === '/result.mp4') {
        res.writeHead(200, { 'Content-Type': 'video/mp4' }).end(video);
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += String(chunk);
        const payload = JSON.parse(body) as {
          content: { video_url?: { url: string } }[];
        };
        references.push(payload.content.find((item) => item.video_url)!.video_url!.url);
        res.end(JSON.stringify({ id: `task-${references.length}` }));
        return;
      }
      polls++;
      const id = url.pathname.split('/').at(-1);
      res.end(
        JSON.stringify({
          id,
          status: 'succeeded',
          content: { video_url: `${origin}/${polls === 1 ? 'expired' : 'result'}.mp4` },
        }),
      );
    })().catch((error: unknown) => {
      serverErrors.push(error);
      res.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const token = 'a'.repeat(64);
  const app = await createEngine(new EngineConfig(token, directory, [], 'b'.repeat(64)));
  try {
    await app.listen(0, '127.0.0.1');
    const channels = app.get(ChannelsRepository);
    const channel = channels.saveChannel({
      name: '视频模拟',
      apiFormat: 'openai-completions',
      baseUrl: origin,
      apiKey: 'private-provider-key',
      enabled: true,
    });
    const model = channels.saveModel(channel.id, {
      upstreamModelId: 'doubao-seedance-2-0',
      displayName: '视频',
      kind: 'video',
      protocol: 'ark-video-tasks',
      profileId: null,
      overrides: {},
      enabled: true,
    });
    const media = await app.get(MediaService).saveStream([video]);
    expect(media).toMatchObject({
      durationMs: 2000,
      width: 320,
      height: 256,
      fps: 24,
      codec: 'h264',
      mime: 'video/mp4',
    });
    const generation = app.get(GenerationService);
    const request = GenerationRequest.parse({
      modelId: model.id,
      mode: 'reference',
      prompt: '参考视频',
      inputs: [{ kind: 'video', role: 'reference', sha256: media.sha256 }],
    });
    await expect(generation.create(request)).rejects.toMatchObject({
      code: 'OBJECT_STORAGE_REQUIRED',
    });
    const storage = app.get(ObjectStorageService);
    storage.save({
      endpoint: origin,
      region: 'us-east-1',
      bucket: 'bucket',
      accessKeyId: 'access-key',
      secretAccessKey: 'private-storage-secret',
      forcePathStyle: true,
      keyPrefix: 'refs',
      presignTtlSeconds: 86400,
    });
    expect(await storage.test()).toMatchObject({
      ok: true,
      steps: { upload: true, sign: true, download: true, delete: true },
    });
    expect(objects.size).toBe(0);
    const db = app.get(DatabaseService).db;
    db.update(mediaFiles)
      .set({ durationMs: 16000 })
      .where(eq(mediaFiles.sha256, media.sha256))
      .run();
    await expect(generation.create(request)).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
    db.update(mediaFiles)
      .set({ durationMs: 8000 })
      .where(eq(mediaFiles.sha256, media.sha256))
      .run();
    await expect(
      generation.create({ ...request, inputs: [request.inputs[0], request.inputs[0]] }),
    ).rejects.toThrow('总时长');
    db.update(mediaFiles)
      .set({ durationMs: 2000 })
      .where(eq(mediaFiles.sha256, media.sha256))
      .run();
    for (let index = 0; index < 2; index++) {
      const job = await generation.create(request);
      const row = db.select().from(generationJobs).where(eq(generationJobs.id, job.id)).get()!;
      db.update(generationJobs)
        .set({
          profile: {
            ...row.profile,
            runtime: { ...row.profile.runtime, pollInitialMs: 20, pollMaxMs: 50 },
          },
        })
        .where(eq(generationJobs.id, job.id))
        .run();
      await expect.poll(() => generation.get(job.id).status, { timeout: 10000 }).toBe('succeeded');
      expect(generation.get(job.id).outputs[0]).toMatchObject({ durationMs: 2000, fps: 24 });
    }
    expect(references).toHaveLength(2);
    expect(references[0]).not.toBe(references[1]);
    expect(uploads).toBe(1);
    expect(polls).toBe(3);
    expect(expiredDownloads).toBe(1);
    expect(objects.size).toBe(1);
    expect(JSON.stringify(generation.list())).not.toContain('X-Amz-Signature');
    const file = await readFile(join(directory, 'data', 'frame-loom.sqlite'));
    expect(file.includes(Buffer.from('private-storage-secret'))).toBe(false);
    const removed = await fetch(`${await app.getUrl()}/object-storage`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(removed.headers.get('content-type')).toContain('application/json');
    expect(await removed.json()).toBeNull();
    expect(objects.size).toBe(1);
    expect(serverErrors).toEqual([]);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, expect, it, vi } from 'vitest';
import {
  CanvasDocument,
  type CanvasMediaData,
  ProjectSummary,
  ProjectPageSummary,
  emptyCanvasDocument,
  GenerationRequest,
} from '@frame-loom/contracts';
import { createEngine } from '../../application.js';
import { EngineConfig } from '../../core/config/config.js';
import { DatabaseService } from '../../core/database/database.service.js';
import { MediaService } from '../generation/media.service.js';
import { GenerationAdapters, GenerationService } from '../generation/generation.service.js';
import { generationJobs, mediaFiles } from '../generation/generation.schema.js';
import { ChannelsRepository } from '../channels/channels.repository.js';
import { ProjectMediaService } from './project-media.service.js';
import { ProjectAssetsService } from './project-assets.service.js';
import { assetPath } from './project-files.service.js';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=',
  'base64',
);
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup() {
  const directory = await fs.mkdtemp(join(tmpdir(), 'loom-content-'));
  cleanups.push(() => fs.rm(directory, { recursive: true, force: true }));
  const config = new EngineConfig('a'.repeat(64), join(directory, 'user'), [], 'b'.repeat(64));
  let app: INestApplication<Server>;
  let base: string;
  async function boot() {
    app = await createEngine(config);
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  }
  await boot();
  cleanups.push(() => app.close());
  function request(
    path: string,
    method = 'GET',
    body?: unknown,
    binary = false,
    headers: Record<string, string> = {},
  ) {
    return fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': binary ? 'application/octet-stream' : 'application/json',
        ...headers,
      },
      ...(body === undefined
        ? {}
        : { body: binary ? new Uint8Array(body as Buffer) : JSON.stringify(body) }),
    });
  }
  async function call(path: string, method = 'GET', body?: unknown) {
    const response = await request(path, method, body);
    return { status: response.status, body: (await response.json()) as unknown };
  }
  const create = async (name = '测试') =>
    ProjectSummary.parse((await call('/projects', 'POST', { name, location: directory })).body);
  const page = async (id: string) =>
    ProjectPageSummary.parse((await call(`/projects/${id}/pages`, 'POST', { name: '创作' })).body);
  return {
    directory,
    config,
    request,
    call,
    create,
    page,
    get app() {
      return app;
    },
    restart: async () => {
      await app.close();
      await boot();
    },
  };
}
function document(hashes: string[], pendingJobIds: string[] = []) {
  return CanvasDocument.parse({
    ...emptyCanvasDocument(),
    nodes: [
      {
        id: 'image',
        type: 'image',
        typeVersion: 1,
        position: { x: 0, y: 0 },
        size: { width: 100, height: 100 },
        data: {
          versions: hashes.map((sha256) => ({
            sha256,
            mime: 'image/png',
            width: 1,
            height: 1,
            createdAt: new Date().toISOString(),
          })),
          activeVersion: 0,
          prompt: '',
          inputOrder: [],
          pendingJobIds,
        },
      },
    ],
  });
}
function model(app: INestApplication<Server>) {
  const channels = app.get(ChannelsRepository);
  const channel = channels.saveChannel({
    name: '测试',
    apiFormat: 'openai-completions',
    baseUrl: 'http://127.0.0.1:1',
    apiKey: 'test',
    enabled: true,
  });
  return channels.saveModel(channel.id, {
    upstreamModelId: 'gpt-image-1',
    displayName: '图片',
    kind: 'image',
    protocol: 'openai-images',
    profileId: null,
    overrides: {},
    enabled: true,
  });
}

it('媒体上传、跨项目与全局补齐、回收区找回、元数据重建与缺失保存', async () => {
  const s = await setup();
  const a = await s.create('A'),
    b = await s.create('B');
  const response = await s.request(`/projects/${a.id}/media`, 'POST', png, true);
  expect(response.status).toBe(201);
  const hash = createHash('sha256').update(png).digest('hex');
  const media = s.app.get(MediaService);
  expect((await s.request(`/projects/${a.id}/media`, 'POST', undefined)).status).toBe(415);
  expect(
    (await s.request(`/projects/${a.id}/media`, 'POST', png.subarray(0, 12), true)).status,
  ).toBe(422);
  expect((await media.resolve(hash, a.id)).path).toContain(a.rootPath);
  expect(await s.call(`/projects/${b.id}/media/adopt`, 'POST', { sha256: [hash] })).toMatchObject({
    body: { missing: [] },
  });
  const file = join(b.rootPath, '.frameloom/media', `${hash}.png`);
  await fs.rename(file, join(b.rootPath, '.frameloom/trash/media', `${hash}.png`));
  s.app.get(DatabaseService).db.delete(mediaFiles).where(eq(mediaFiles.sha256, hash)).run();
  expect((await media.resolve(hash, b.id)).media).toMatchObject({ width: 1, mime: 'image/png' });
  expect(await fs.readFile(file)).toEqual(png);
  const c = await s.create('C');
  await media.saveStream([png]);
  await fs.rm(join(a.rootPath, '.frameloom/media', `${hash}.png`));
  await fs.rm(file);
  expect(await media.adopt(c.id, [hash])).toEqual({ missing: [] });
  const page = await s.page(c.id),
    missing = 'f'.repeat(64);
  expect(
    await s.call(`/projects/${c.id}/pages/${page.id}`, 'PUT', {
      revision: 1,
      document: document([hash, missing]),
    }),
  ).toMatchObject({ status: 200, body: { revision: 2, missing: [missing] } });
});

it('资产路径拒绝越界、内部目录与 junction，搜索跳过链接并限制 500 条', async () => {
  const s = await setup(),
    p = await s.create();
  for (const path of [
    '../user',
    '/etc',
    'C:/user',
    'NUL',
    '.FrameLoom/project.json',
    'a\u0000b',
    'a\\b',
  ])
    await expect(assetPath(p.rootPath, path)).rejects.toThrow();
  expect((await s.call(`/projects/${p.id}/assets?path=%2e%2e%2fuser`)).status).toBe(400);
  await fs.symlink(s.directory, join(p.rootPath, 'link'), 'junction');
  await expect(assetPath(p.rootPath, 'link')).rejects.toThrow();
  expect((await s.call(`/projects/${p.id}/assets`)).body).toEqual([]);
  await Promise.all(
    Array.from({ length: 501 }, (_, i) => fs.writeFile(join(p.rootPath, `match-${i}.txt`), 'x')),
  );
  const result = await s.call(`/projects/${p.id}/assets/search?q=match`);
  expect(result.body).toMatchObject({ truncated: true });
  expect((result.body as { entries: unknown[] }).entries).toHaveLength(500);
  const realpath = fs.realpath.bind(fs);
  vi.spyOn(fs, 'realpath').mockImplementation(async (path, options) =>
    String(path).endsWith('SHORT~1') ? s.directory : realpath(path, options),
  );
  await fs.mkdir(join(p.rootPath, 'SHORT~1'));
  await expect(assetPath(p.rootPath, 'SHORT~1')).rejects.toThrow();
});

it('搜索跳过无权限目录，文件符号链接不能读取', async () => {
  const s = await setup(),
    p = await s.create();
  await fs.mkdir(join(p.rootPath, 'private'));
  await fs.writeFile(join(p.rootPath, 'private', 'secret.txt'), 'secret');
  const readdir = fs.readdir.bind(fs);
  vi.spyOn(fs, 'readdir').mockImplementation((...args) => {
    if (String(args[0]).endsWith('private'))
      return Promise.reject(Object.assign(new Error('拒绝访问'), { code: 'EACCES' }));
    return readdir(...args);
  });
  expect((await s.call(`/projects/${p.id}/assets/search?q=secret`)).body).toEqual({
    entries: [],
    truncated: false,
  });
  vi.restoreAllMocks();
  const link = join(p.rootPath, 'symbolic');
  try {
    await fs.symlink(join(p.rootPath, 'private', 'secret.txt'), link, 'file');
  } catch (error) {
    // Windows 未开启开发者模式时使用 lstat 注入覆盖同一拒绝分支。
    if (!(error instanceof Error && 'code' in error && error.code === 'EPERM')) throw error;
    await fs.writeFile(link, 'placeholder');
    const lstat = fs.lstat.bind(fs);
    vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
      const stat = await lstat(...args);
      if (String(args[0]) === link) stat.isSymbolicLink = () => true;
      return stat;
    });
  }
  await expect(assetPath(p.rootPath, 'symbolic')).rejects.toThrow();
});

it('资产上传、冲突、移动限制、媒体互转、Range 与附件鉴权', async () => {
  const s = await setup(),
    p = await s.create(),
    prefix = `/projects/${p.id}`;
  expect(
    (await s.call(`${prefix}/assets/folders`, 'POST', { path: '', name: '素材' })).status,
  ).toBe(201);
  expect(
    (await s.call(`${prefix}/assets/folders`, 'POST', { path: '', name: '素材' })).status,
  ).toBe(409);
  for (const name of ['图.png', '图 (2).png']) {
    const response = await s.request(
      `${prefix}/assets/files?path=&name=${encodeURIComponent('图.png')}`,
      'POST',
      png,
      true,
    );
    expect(await response.json()).toMatchObject({ name });
  }
  expect(
    (await s.call(`${prefix}/assets`, 'PATCH', { path: '图.png', name: '图 (2).png' })).status,
  ).toBe(409);
  expect(
    (await s.call(`${prefix}/assets/move`, 'POST', { path: '素材', destination: '素材' })).status,
  ).toBe(400);
  expect(
    (await s.call(`${prefix}/assets/move`, 'POST', { path: '图.png', destination: '素材' })).status,
  ).toBe(201);
  const imported = await s.call(`${prefix}/media/from-asset`, 'POST', { path: '素材/图.png' });
  const hash = createHash('sha256').update(png).digest('hex');
  expect(imported.body).toMatchObject({ sha256: hash });
  expect(
    (
      await s.call(`${prefix}/assets/from-media`, 'POST', {
        sha256: hash,
        path: '素材',
        name: '图.png',
      })
    ).body,
  ).toMatchObject({ path: '素材/图 (2).png' });
  expect(await fs.readFile(join(p.rootPath, '素材/图 (2).png'))).toEqual(png);
  expect(
    (await s.call(`${prefix}/assets`, 'PATCH', { path: '图 (2).png', name: '重命名.png' })).status,
  ).toBe(200);
  expect((await s.request(`${prefix}/files/assets?path=missing.txt`)).status).toBe(404);
  await fs.writeFile(join(p.rootPath, 'page.html'), '<script>alert(1)</script>');
  expect((await s.call(`${prefix}/media/from-asset`, 'POST', { path: 'page.html' })).status).toBe(
    422,
  );
  const range = await s.request(`${prefix}/files/media/${hash}`, 'GET', undefined, false, {
    Range: 'bytes=0-7',
  });
  expect(range.status).toBe(206);
  expect(Buffer.from(await range.arrayBuffer())).toEqual(png.subarray(0, 8));
  const unsatisfiable = await s.request(`${prefix}/files/media/${hash}`, 'GET', undefined, false, {
    Range: 'bytes=9999-',
  });
  expect(unsatisfiable.status).toBe(416);
  expect(unsatisfiable.headers.get('content-type')).toContain('application/json');
  await unsatisfiable.arrayBuffer();
  const html = await s.request(`${prefix}/files/assets?path=page.html`);
  expect(html.headers.get('content-disposition')).toContain('attachment');
  expect(html.headers.get('content-type')).toBe('application/octet-stream');
  expect(html.headers.get('x-content-type-options')).toBe('nosniff');
  await html.arrayBuffer();
  expect(
    (
      await s.request(`${prefix}/files/assets?path=page.html`, 'GET', undefined, false, {
        Authorization: '',
      })
    ).status,
  ).toBe(401);
});

it('流式限额、空间不足与中断不会残留临时文件', async () => {
  const s = await setup(),
    p = await s.create(),
    assets = s.app.get(ProjectAssetsService);
  await expect(
    assets.upload(p.id, '', 'huge', [{ byteLength: 4 * 1024 ** 3 + 1 } as Uint8Array]),
  ).rejects.toMatchObject({ code: 'ASSET_TOO_LARGE' });
  vi.spyOn(assets, 'statfs').mockResolvedValue({ bavail: 0n, bsize: 4096n } as Awaited<
    ReturnType<typeof assets.statfs>
  >);
  await expect(assets.upload(p.id, '', 'empty', [png], png.length)).rejects.toMatchObject({
    code: 'ASSET_NO_SPACE',
  });
  vi.restoreAllMocks();
  async function* interrupted() {
    yield await Promise.resolve(png);
    throw new Error('连接中断');
  }
  await expect(assets.upload(p.id, '', 'broken', interrupted())).rejects.toThrow('连接中断');
  const abort = new AbortController();
  abort.abort();
  await expect(
    assets.upload(p.id, '', 'cancelled', [png], undefined, abort.signal),
  ).rejects.toThrow();
  await expect(
    s.app.get(MediaService).upload(p.id, [{ byteLength: 256 * 1024 ** 2 + 1 } as Uint8Array]),
  ).rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE' });
  expect(await fs.readdir(join(p.rootPath, '.frameloom/tmp'))).toEqual([]);
  expect(await s.app.get(ProjectAssetsService).list(p.id, '')).toEqual([]);
});

it('清理保护全部页面版本、未结束任务和 pending 任务，会话避让且过期可控', async () => {
  const s = await setup(),
    p = await s.create(),
    page = await s.page(p.id);
  const media = s.app.get(MediaService),
    cleanup = s.app.get(ProjectMediaService);
  const hashes: string[] = [];
  for (let i = 0; i < 8; i++)
    hashes.push((await media.upload(p.id, [Buffer.concat([png, Buffer.from([i])])])).sha256);
  const request = GenerationRequest.parse({
    modelId: model(s.app).id,
    prompt: '测试',
    mode: 'text',
    projectId: p.id,
    pageId: page.id,
  });
  const generation = s.app.get(GenerationService);
  const unfinished = await generation.create(request),
    pending = await generation.create(request);
  const db = s.app.get(DatabaseService).db;
  db.update(generationJobs)
    .set({
      status: 'submit_unknown',
      outputs: [hashes[4]],
      request: { ...request, inputs: [{ kind: 'image', role: 'reference', sha256: hashes[5] }] },
    })
    .where(eq(generationJobs.id, unfinished.id))
    .run();
  db.update(generationJobs)
    .set({ status: 'succeeded', outputs: [hashes[6]] })
    .where(eq(generationJobs.id, pending.id))
    .run();
  const doc = document([hashes[0]], [pending.id]);
  Object.assign(doc.nodes[0].data as CanvasMediaData, {
    mediaReferences: [
      {
        id: 'local-reference',
        name: '本地参考',
        role: 'reference',
        media: {
          sha256: hashes[1],
          mime: 'image/png',
          bytes: png.length,
          width: 1,
          height: 1,
          durationMs: null,
          createdAt: new Date().toISOString(),
        },
      },
    ],
  });
  (doc.nodes[0].data as { versions: { posterSha256?: string }[] }).versions[0].posterSha256 =
    hashes[2];
  const second = ProjectPageSummary.parse(
    (await s.call(`/projects/${p.id}/pages`, 'POST', { name: '第二页' })).body,
  );
  await s.call(`/projects/${p.id}/pages/${second.id}`, 'PUT', {
    revision: 1,
    document: document([hashes[3]]),
  });
  await s.call(`/projects/${p.id}/pages/${page.id}`, 'PUT', { revision: 1, document: doc });
  await cleanup.session(p.id, true);
  expect((await s.call(`/projects/${p.id}/media/cleanup?dryRun=false`, 'POST')).body).toMatchObject(
    { skipped: true },
  );
  expect(await cleanup.cleanup(p.id, false)).toMatchObject({ skipped: true, files: 0 });
  await cleanup.session(p.id, false);
  expect(await fs.readdir(join(p.rootPath, '.frameloom/media'))).toHaveLength(7);
  expect(await fs.readdir(join(p.rootPath, '.frameloom/trash/media'))).toEqual([
    `${hashes[7]}.png`,
  ]);
  expect(await cleanup.cleanup(p.id, true)).toMatchObject({ files: 1 });
  expect(await cleanup.cleanup(p.id, false)).toMatchObject({ files: 1 });
  const old = new Date(Date.now() - 31 * 86400_000);
  for (const path of ['trash/pages/old.json', 'tmp/old', 'trash/media/old.png']) {
    const file = join(p.rootPath, '.frameloom', path);
    await fs.writeFile(file, 'old');
    await fs.utimes(file, old, old);
  }
  await fs.writeFile(join(p.rootPath, '.frameloom/tmp/fresh'), 'fresh');
  await s.call(`/projects/${p.id}`);
  expect(await fs.readdir(join(p.rootPath, '.frameloom/trash/pages'))).toEqual([]);
  expect(await fs.readdir(join(p.rootPath, '.frameloom/tmp'))).toEqual(['fresh']);
  vi.spyOn(cleanup, 'now').mockReturnValue(Date.now() + 2 * 3600_000);
  await s.call(`/projects/${p.id}`);
  expect(await fs.readdir(join(p.rootPath, '.frameloom/tmp'))).toEqual([]);
  await fs.writeFile(join(p.rootPath, '.frameloom/pages', `${page.id}.json`), '{损坏');
  await expect(cleanup.cleanup(p.id, false)).rejects.toThrow();
  expect(await fs.readdir(join(p.rootPath, '.frameloom/media'))).toHaveLength(7);
});

it('全局启动清理保留未结束任务输入和产物、移除项目暂存；旧完成任务仅保留记录', async () => {
  const s = await setup(),
    generation = s.app.get(GenerationService),
    media = s.app.get(MediaService);
  const request = GenerationRequest.parse({
    modelId: model(s.app).id,
    prompt: '测试',
    mode: 'text',
  });
  const hashes: string[] = [];
  for (let i = 0; i < 4; i++)
    hashes.push((await media.saveStream([Buffer.concat([png, Buffer.from([i])])])).sha256);
  const unfinished = await generation.create(request),
    old = await generation.create(request),
    removed = await generation.create(request);
  const db = s.app.get(DatabaseService).db;
  db.update(generationJobs)
    .set({
      status: 'submit_unknown',
      outputs: [hashes[0]],
      request: { ...request, inputs: [{ kind: 'image', role: 'reference', sha256: hashes[1] }] },
    })
    .where(eq(generationJobs.id, unfinished.id))
    .run();
  db.update(generationJobs)
    .set({ status: 'succeeded', outputs: [hashes[2]] })
    .where(eq(generationJobs.id, old.id))
    .run();
  db.update(generationJobs)
    .set({
      status: 'succeeded',
      projectId: randomUUID(),
      outputs: [hashes[3]],
      stagedOutputs: [hashes[3]],
    })
    .where(eq(generationJobs.id, removed.id))
    .run();
  await s.restart();
  for (const i of [0, 1, 3])
    expect((await s.app.get(MediaService).resolve(hashes[i])).path).toContain(s.config.dataDir);
  await expect(s.app.get(MediaService).resolve(hashes[2])).rejects.toMatchObject({
    code: 'MEDIA_NOT_FOUND',
  });
  expect(s.app.get(GenerationService).get(old.id).outputs[0].sha256).toBe(hashes[2]);
});

it('对象存储通过解析器读取仅存在于项目中的媒体', async () => {
  const s = await setup(),
    p = await s.create();
  const stored = await s.app.get(MediaService).upload(p.id, [png]);
  const storage = s.app.get(ObjectStorageService);
  storage.save({
    endpoint: 'https://storage.example.com',
    region: 'test',
    bucket: 'media',
    accessKeyId: 'test',
    secretAccessKey: 'test',
    forcePathStyle: true,
    keyPrefix: '',
    presignTtlSeconds: 3600,
  });
  const uploaded: Uint8Array[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    expect(input).toBeInstanceOf(Request);
    uploaded.push(new Uint8Array(await (input as Request).arrayBuffer()));
    return new Response(null, { status: 200 });
  });
  expect(await storage.reference(stored, undefined, p.id)).toContain('X-Amz-Signature');
  expect(Buffer.from(uploaded[0])).toEqual(png);
});

it('生成任务落项目，离线产物暂存并恢复复制，启动清全局但保留任务记录', async () => {
  const s = await setup(),
    p = await s.create(),
    page = await s.page(p.id);
  const generation = s.app.get(GenerationService);
  const request = GenerationRequest.parse({
    modelId: model(s.app).id,
    prompt: '测试',
    mode: 'text',
    projectId: p.id,
    pageId: page.id,
  });
  s.app.get(GenerationAdapters).adapters.set('openai-images', {
    protocol: 'openai-images',
    submit: (_context, input) => {
      if (input.inputs.length)
        expect(input.inputs[0].dataUrl).toBe(`data:image/png;base64,${png.toString('base64')}`);
      return Promise.resolve({
        status: 'succeeded',
        outputs: [{ data: png.toString('base64'), mime: 'image/png' }],
      });
    },
  });
  await expect(generation.create({ ...request, pageId: randomUUID() })).rejects.toMatchObject({
    code: 'PAGE_NOT_FOUND',
  });
  const reference = await s.app.get(MediaService).upload(p.id, [png]);
  const first = await generation.create({
    ...request,
    mode: 'reference',
    inputs: [{ kind: 'image', role: 'reference', sha256: reference.sha256 }],
  });
  expect(
    s.app
      .get(DatabaseService)
      .db.select()
      .from(generationJobs)
      .where(eq(generationJobs.id, first.id))
      .get(),
  ).toMatchObject({ projectId: p.id, pageId: page.id });
  await expect.poll(() => generation.get(first.id).status).toBe('succeeded');
  const hash = generation.get(first.id).outputs[0].sha256;
  const media = s.app.get(MediaService);
  expect((await media.resolve(hash, p.id)).path).toContain(p.rootPath);
  const second = await generation.create(request);
  const moved = `${p.rootPath}-offline`;
  await fs.rename(p.rootPath, moved);
  await expect.poll(() => generation.get(second.id).status).toBe('succeeded');
  expect((await media.resolve(hash, p.id)).path).toContain(s.config.dataDir);
  await fs.rm(join(moved, '.frameloom/media', `${hash}.png`));
  await s.restart();
  expect((await s.app.get(MediaService).resolve(hash)).path).toContain(s.config.dataDir);
  await fs.rename(moved, p.rootPath);
  await s.call('/projects');
  expect(await fs.readFile(join(p.rootPath, '.frameloom/media', `${hash}.png`))).toEqual(png);
  await s.app.get(ProjectMediaService).cleanup(p.id, false);
  await s.call('/projects');
  expect(await fs.readdir(join(p.rootPath, '.frameloom/media'))).toEqual([]);
  const orphan = await s.app
    .get(MediaService)
    .saveStream([Buffer.concat([png, Buffer.from('unused')])]);
  await s.restart();
  await expect(s.app.get(MediaService).resolve(orphan.sha256)).rejects.toMatchObject({
    code: 'MEDIA_NOT_FOUND',
  });
  expect(s.app.get(GenerationService).get(second.id).status).toBe('succeeded');
  await s.call(`/projects/${p.id}`);
  await s.call('/projects');
  expect(await fs.readdir(join(p.rootPath, '.frameloom/media'))).toEqual([]);
  expect(await fs.readdir(join(p.rootPath, '.frameloom/trash/media'))).toEqual([]);
});

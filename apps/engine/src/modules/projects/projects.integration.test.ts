import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ProjectManifest,
  ProjectSummary,
  ProjectPageSummary,
  ProjectPageRecord,
  emptyCanvasDocument,
} from '@frame-loom/contracts';
import { createEngine } from '../../application.js';
import { EngineConfig } from '../../core/config/config.js';
import { ProjectStore } from './project-store.js';
import { LocalProjectStore } from './local-project-store.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = await fs.mkdtemp(join(tmpdir(), 'loom-projects-'));
  cleanups.push(() => fs.rm(directory, { recursive: true, force: true }));
  const token = 'a'.repeat(64);
  const config = new EngineConfig(token, join(directory, 'user'), [], 'b'.repeat(64));
  let app: INestApplication<Server>;
  let base: string;
  async function boot() {
    app = await createEngine(config);
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  }
  await boot();
  cleanups.push(() => app.close());
  async function call(path: string, method = 'GET', body?: unknown, authorized = true) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(authorized ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as unknown };
  }
  return {
    directory,
    call,
    store: () => app.get<LocalProjectStore>(ProjectStore),
    create: async (name = '测试项目') =>
      ProjectSummary.parse((await call('/projects', 'POST', { name, location: directory })).body),
    restart: async () => {
      await app.close();
      await boot();
    },
  };
}

it('项目标签 CRUD、跨页引用和带改派删除按 revision 更新锁定节点', async () => {
  const { call, create } = await setup();
  const project = await create();
  const base = `/projects/${project.id}`;
  const tags = await call(`${base}/tags`);
  expect(tags.body).toHaveLength(7);
  expect(ProjectManifest.parse((await call(base)).body).tags).toHaveLength(7);
  expect(await call(`${base}/tags`, 'POST', { name: '重点', color: 'red' })).toMatchObject({
    status: 201,
  });
  const created = (await call(`${base}/tags`)).body as { id: string; name: string }[];
  const custom = created.find((tag) => tag.name === '重点')!;
  expect(
    await call(`${base}/tags/${custom.id}`, 'PATCH', { name: '关键', color: 'cyan' }),
  ).toMatchObject({ status: 200 });
  expect(await call(`${base}/tags/${created[0].id}`, 'PATCH', { name: '不可改' })).toMatchObject({
    status: 409,
    body: { code: 'TAG_BUILTIN_READONLY' },
  });
  expect(await call(`${base}/tags`, 'POST', { name: '关键', color: 'blue' })).toMatchObject({
    status: 409,
    body: { code: 'TAG_NAME_CONFLICT' },
  });

  const pages = await Promise.all(
    ['第一集', '第二集'].map(async (name) =>
      ProjectPageSummary.parse((await call(`${base}/pages`, 'POST', { name })).body),
    ),
  );
  const tagId = created[0].id;
  for (const [index, page] of pages.entries()) {
    const document = {
      ...emptyCanvasDocument(),
      nodes: [
        {
          id: `image-${index}`,
          type: 'image',
          typeVersion: 1,
          position: { x: 0, y: 0 },
          size: { width: 100, height: 100 },
          title: `画面${index}`,
          locked: true,
          tagId,
          data: { versions: [], activeVersion: 0, prompt: '', inputOrder: [] },
        },
      ],
    };
    expect((await call(`${base}/pages/${page.id}`, 'PUT', { revision: 1, document })).status).toBe(
      200,
    );
  }
  const usages = await call(`${base}/tags/${tagId}/usages`);
  expect(usages.body).toMatchObject([
    { pageId: pages[0].id, nodeId: 'image-0', locked: true, thumbnailSha256: null },
    { pageId: pages[1].id, nodeId: 'image-1', locked: true, thumbnailSha256: null },
  ]);
  const first = { pageId: pages[0].id, nodeId: 'image-0', tagId: created[1].id };
  const failed = await call(`${base}/tags/${tagId}/delete`, 'POST', { reassign: [first] });
  expect(failed).toMatchObject({
    status: 409,
    body: { code: 'TAG_IN_USE', details: { usages: [{ nodeId: 'image-1' }] } },
  });
  expect(ProjectPageRecord.parse((await call(`${base}/pages/${pages[0].id}`)).body).revision).toBe(
    3,
  );
  expect(
    await call(`${base}/tags/${tagId}/delete`, 'POST', {
      reassign: [{ pageId: pages[1].id, nodeId: 'image-1', tagId: null }],
    }),
  ).toMatchObject({ status: 201 });
  expect(ProjectPageRecord.parse((await call(`${base}/pages/${pages[1].id}`)).body)).toMatchObject({
    revision: 3,
    document: { nodes: [{ locked: true }] },
  });
  const remainingTags = (await call(`${base}/tags`)).body as { id: string }[];
  expect(remainingTags.some((tag) => tag.id === tagId)).toBe(false);
});

it('删除改派拒绝无效目标，页面先迁移而清单失败后重试可完成', async () => {
  const { call, create, store } = await setup();
  const project = await create();
  const base = `/projects/${project.id}`;
  const [tag] = (await call(`${base}/tags`)).body as { id: string }[];
  const page = ProjectPageSummary.parse(
    (await call(`${base}/pages`, 'POST', { name: '引用页' })).body,
  );
  const document = {
    ...emptyCanvasDocument(),
    nodes: [
      {
        id: 'tagged',
        type: 'image',
        typeVersion: 1,
        position: { x: 0, y: 0 },
        size: { width: 100, height: 100 },
        tagId: tag.id,
        data: { versions: [], activeVersion: 0, prompt: '', inputOrder: [] },
      },
    ],
  };
  await call(`${base}/pages/${page.id}`, 'PUT', { revision: 1, document });
  const reassignment = { pageId: page.id, nodeId: 'tagged', tagId: null };
  expect(
    await call(`${base}/tags/${tag.id}/delete`, 'POST', {
      reassign: [{ ...reassignment, tagId: 'missing-target' }],
    }),
  ).toMatchObject({ status: 400 });
  vi.spyOn(store(), 'writeManifest').mockRejectedValueOnce(new Error('清单写入失败'));
  expect(
    await call(`${base}/tags/${tag.id}/delete`, 'POST', { reassign: [reassignment] }),
  ).toMatchObject({ status: 500 });
  const migrated = ProjectPageRecord.parse((await call(`${base}/pages/${page.id}`)).body);
  expect(migrated.revision).toBe(3);
  expect(migrated.document.nodes[0]).not.toHaveProperty('tagId');
  expect(
    await call(`${base}/tags/${tag.id}/delete`, 'POST', { reassign: [reassignment] }),
  ).toMatchObject({ status: 201 });
  expect((await call(`${base}/tags`)).body).toHaveLength(6);
});

it('旧项目清单缺少 tags 时默认返回内置列表，首次写入时补齐', async () => {
  const { call, create } = await setup();
  const project = await create();
  const manifestPath = join(project.rootPath, '.frameloom/project.json');
  const manifest = ProjectManifest.parse(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
  delete manifest.tags;
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  expect((await call(`/projects/${project.id}/tags`)).body).toHaveLength(7);
  await call(`/projects/${project.id}/tags`, 'POST', { name: '自定义', color: 'gray' });
  expect(
    ProjectManifest.parse(JSON.parse(await fs.readFile(manifestPath, 'utf8'))).tags,
  ).toHaveLength(8);
});

it('新建、重命名、移除与打开：项目文件独立于注册表且重启保留', async () => {
  const { call, create, restart, directory } = await setup();
  const project = await create();
  expect(project.status).toBe('available');
  expect(project.rootPath.toLowerCase()).toBe(join(directory, '测试项目').toLowerCase());
  expect(await fs.readdir(join(project.rootPath, '.frameloom'))).toEqual([
    'media',
    'pages',
    'project.json',
    'tmp',
    'trash',
  ]);
  const file = join(project.rootPath, '.frameloom/project.json');
  const original = ProjectManifest.parse(JSON.parse(await fs.readFile(file, 'utf8')));
  await fs.writeFile(file, JSON.stringify({ ...original, sync: { clock: 7 } }));
  expect((await call(`/projects/${project.id}`, 'PATCH', { name: '已重命名' })).status).toBe(200);
  expect(ProjectManifest.parse((await call(`/projects/${project.id}`)).body)).toMatchObject({
    name: '已重命名',
    sync: { clock: 7 },
  });
  await restart();
  expect((await call('/projects')).body).toMatchObject([
    { id: project.id, name: '已重命名', rootPath: project.rootPath },
  ]);
  expect((await call(`/projects/${project.id}`, 'DELETE')).status).toBe(200);
  expect((await call('/projects')).body).toEqual([]);
  expect((await call('/projects/open', 'POST', { rootPath: project.rootPath })).body).toMatchObject(
    { id: project.id, name: '已重命名' },
  );
});

it('拒绝同名、同名文件夹、非绝对路径与过长路径；并发创建只成功一次', async () => {
  const { call, create, directory } = await setup();
  await create('Demo');
  expect(await call('/projects', 'POST', { name: 'demo', location: directory })).toMatchObject({
    status: 409,
    body: { code: 'PROJECT_NAME_CONFLICT' },
  });
  await fs.mkdir(join(directory, '已存在'));
  expect(await call('/projects', 'POST', { name: '已存在', location: directory })).toMatchObject({
    status: 409,
    body: { code: 'PROJECT_DIRECTORY_EXISTS' },
  });
  expect(await call('/projects', 'POST', { name: '相对', location: './relative' })).toMatchObject({
    status: 400,
    body: { code: 'PROJECT_PATH_INVALID' },
  });
  const deep = join(directory, 'a'.repeat(80), 'b'.repeat(80));
  await fs.mkdir(deep, { recursive: true });
  expect(await call('/projects', 'POST', { name: '过长', location: deep })).toMatchObject({
    status: 400,
    body: { code: 'PROJECT_PATH_TOO_LONG' },
  });
  const results = await Promise.all([
    call('/projects', 'POST', { name: '并发', location: directory }),
    call('/projects', 'POST', { name: '并发', location: directory }),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
});

it('新建写失败会回滚刚创建的目录，不影响既有文件夹', async () => {
  const { call, store, directory } = await setup();
  vi.spyOn(store(), 'writeManifest').mockRejectedValueOnce(new Error('磁盘满'));
  expect(await call('/projects', 'POST', { name: '回滚', location: directory })).toMatchObject({
    status: 500,
    body: { code: 'PROJECT_WRITE_FAILED' },
  });
  await expect(fs.stat(join(directory, '回滚'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await call('/projects')).body).toEqual([]);
});

it('列表区分 missing、mismatch、unreadable、too_new，禁止修改不可用项目', async () => {
  const { call, create } = await setup();
  const project = await create();
  const file = join(project.rootPath, '.frameloom/project.json');
  const original: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
  const manifest = ProjectManifest.parse(original);
  for (const [content, status] of [
    [{ ...manifest, id: randomUUID() }, 'mismatch'],
    [{ ...manifest, formatVersion: 2 }, 'too_new'],
    ['损坏', 'unreadable'],
  ] as const) {
    await fs.writeFile(file, typeof content === 'string' ? content : JSON.stringify(content));
    expect((await call('/projects')).body).toMatchObject([{ status }]);
    expect((await call(`/projects/${project.id}`, 'PATCH', { name: '不能修改' })).status).toBe(409);
  }
  await fs.rm(file);
  expect((await call('/projects')).body).toMatchObject([{ status: 'missing' }]);
  await fs.writeFile(file, JSON.stringify(original));
  expect((await call('/projects')).body).toMatchObject([{ status: 'available' }]);
});

it('复制目录需显式作为副本打开；拒绝原路径副本与重名，保留页面 id', async () => {
  const { call, create, directory } = await setup();
  const project = await create();
  const page = ProjectPageSummary.parse(
    (await call(`/projects/${project.id}/pages`, 'POST', { name: '第一集' })).body,
  );
  const copy = join(directory, '复制的文件夹');
  await fs.cp(project.rootPath, copy, { recursive: true });
  expect(await call('/projects/open', 'POST', { rootPath: copy })).toMatchObject({
    status: 409,
    body: { code: 'PROJECT_ALREADY_REGISTERED' },
  });
  expect(
    (await call('/projects/open', 'POST', { rootPath: project.rootPath, asCopy: true })).status,
  ).toBe(409);
  expect(
    await call('/projects/open', 'POST', { rootPath: copy, asCopy: true, name: project.name }),
  ).toMatchObject({ status: 409, body: { code: 'PROJECT_NAME_CONFLICT' } });
  const duplicate = ProjectSummary.parse(
    (await call('/projects/open', 'POST', { rootPath: copy, asCopy: true })).body,
  );
  expect(duplicate.id).not.toBe(project.id);
  expect(duplicate.name).toBe(`${project.name} 副本`);
  expect(ProjectManifest.parse((await call(`/projects/${duplicate.id}`)).body).pages[0].id).toBe(
    page.id,
  );
  expect(ProjectManifest.parse((await call(`/projects/${project.id}`)).body).id).toBe(project.id);
});

it('原目录不可用时打开更新路径，显式重新定位必须匹配 id', async () => {
  const { call, create, directory } = await setup();
  const project = await create();
  const moved = join(directory, '移动后');
  await fs.rename(project.rootPath, moved);
  expect((await call('/projects/open', 'POST', { rootPath: moved })).body).toMatchObject({
    id: project.id,
    status: 'available',
  });
  const other = await create('另一个项目');
  expect(
    await call(`/projects/${project.id}/relocate`, 'POST', { rootPath: other.rootPath }),
  ).toMatchObject({ status: 409, body: { code: 'PROJECT_MISMATCH' } });
  const movedAgain = join(directory, '再次移动');
  await fs.rename(moved, movedAgain);
  expect(
    (await call(`/projects/${project.id}/relocate`, 'POST', { rootPath: movedAgain })).body,
  ).toMatchObject({ id: project.id, status: 'available' });
});

it('页面增删改、独立视图和封面保存；删除进入回收区、移除注册行级联视图', async () => {
  const { call, create, restart } = await setup();
  const project = await create();
  const base = `/projects/${project.id}`;
  const page = ProjectPageSummary.parse(
    (await call(`${base}/pages`, 'POST', { name: '第一集' })).body,
  );
  const url = `${base}/pages/${page.id}`;
  expect((await call(`${base}/pages`, 'POST', { name: page.name })).status).toBe(409);
  const next = ProjectPageSummary.parse(
    (await call(`${base}/pages`, 'POST', { name: '第二集' })).body,
  );
  expect((await call(url, 'PATCH', { name: next.name })).status).toBe(409);
  expect((await call(url, 'PATCH', { name: '第一集重命名' })).status).toBe(200);
  const before = await fs.readFile(join(project.rootPath, '.frameloom/project.json'), 'utf8');
  const view = { viewport: { x: 20, y: 30, zoom: 1.2 }, minimap: false, edgeDisplay: 'related' };
  expect((await call(`${url}/view`, 'PUT', view)).status).toBe(200);
  expect(await fs.readFile(join(project.rootPath, '.frameloom/project.json'), 'utf8')).toBe(before);
  const document = {
    ...emptyCanvasDocument(),
    nodes: [
      {
        id: 'img',
        type: 'image',
        typeVersion: 1,
        position: { x: 0, y: 0 },
        size: { width: 200, height: 100 },
        data: {
          versions: [
            {
              sha256: 'a'.repeat(64),
              mime: 'image/png',
              width: 10,
              height: 10,
              createdAt: '2026-10-26T01:00:00.000Z',
            },
            {
              sha256: 'b'.repeat(64),
              mime: 'image/png',
              width: 10,
              height: 10,
              createdAt: '2026-10-26T02:00:00.000Z',
            },
          ],
          activeVersion: 0,
          prompt: '',
          inputOrder: [],
        },
      },
    ],
  };
  expect(await call(url, 'PUT', { revision: 1, document })).toMatchObject({
    status: 200,
    body: { revision: 2 },
  });
  expect(ProjectManifest.parse((await call(base)).body).pages[0]).toMatchObject({
    coverSha256: 'b'.repeat(64),
  });
  await restart();
  expect(ProjectPageRecord.parse((await call(url)).body)).toMatchObject({
    revision: 2,
    document,
    view,
  });
  expect((await call(url, 'PUT', { revision: 2, document: emptyCanvasDocument() })).status).toBe(
    200,
  );
  expect(ProjectManifest.parse((await call(base)).body).pages[0]).toMatchObject({
    coverSha256: null,
  });
  expect((await call(url, 'DELETE')).status).toBe(200);
  expect((await fs.readdir(join(project.rootPath, '.frameloom/trash/pages')))[0]).toContain(
    page.id,
  );
  expect((await call(url)).status).toBe(404);
  expect(ProjectManifest.parse((await call(base)).body).pages.map((page) => page.id)).toEqual([
    next.id,
  ]);
  await call(base, 'DELETE');
  await call('/projects/open', 'POST', { rootPath: project.rootPath });
  expect(ProjectPageRecord.parse((await call(`${base}/pages/${next.id}`)).body).view).toBeNull();
});

it('并发保存一个成功；外部修改（含相同 revision）必须重新加载，未知页面字段保留', async () => {
  const { call, create } = await setup();
  const project = await create();
  const base = `/projects/${project.id}`;
  const page = ProjectPageSummary.parse(
    (await call(`${base}/pages`, 'POST', { name: '第一集' })).body,
  );
  const url = `${base}/pages/${page.id}`;
  const input = { revision: 1, document: emptyCanvasDocument() };
  const results = await Promise.all([call(url, 'PUT', input), call(url, 'PUT', input)]);
  expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  const file = join(project.rootPath, `.frameloom/pages/${page.id}.json`);
  const current = ProjectPageRecord.parse((await call(url)).body);
  await fs.writeFile(
    file,
    JSON.stringify({ ...current, view: undefined, revision: 8, sync: '保留' }),
  );
  expect(await call(url, 'PUT', { ...input, revision: 2 })).toMatchObject({
    status: 409,
    body: { code: 'PAGE_REVISION_CONFLICT' },
  });
  expect(ProjectPageRecord.parse((await call(url)).body).revision).toBe(8);
  expect((await call(url, 'PUT', { ...input, revision: 8 })).body).toEqual({
    revision: 9,
    missing: [],
  });
  const external: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
  const parsed = ProjectPageRecord.parse({ ...(external as object), view: null });
  await fs.writeFile(file, JSON.stringify({ ...parsed, sync: '外部同 revision' }));
  for (let i = 0; i < 2; i++)
    expect((await call(url, 'PUT', { ...input, revision: 9 })).status).toBe(409);
  await call(url);
  expect((await call(url, 'PUT', { ...input, revision: 9 })).status).toBe(200);
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toMatchObject({ sync: '外部同 revision' });
});

it('页面先落盘后清单失败，下次读取修复摘要；删除清单失败恢复页面', async () => {
  const { call, create, store } = await setup();
  const project = await create();
  const base = `/projects/${project.id}`;
  const page = ProjectPageSummary.parse(
    (await call(`${base}/pages`, 'POST', { name: '第一集' })).body,
  );
  const url = `${base}/pages/${page.id}`;
  vi.spyOn(store(), 'writeManifest').mockRejectedValueOnce(new Error('清单失败'));
  expect((await call(url, 'PUT', { revision: 1, document: emptyCanvasDocument() })).status).toBe(
    500,
  );
  expect(ProjectPageRecord.parse((await call(url)).body).revision).toBe(2);
  vi.spyOn(store(), 'writeManifest').mockRejectedValueOnce(new Error('删除清单失败'));
  expect((await call(url, 'DELETE')).status).toBe(500);
  expect(ProjectPageRecord.parse((await call(url)).body).revision).toBe(2);
  expect(ProjectManifest.parse((await call(base)).body).pages[0].id).toBe(page.id);
});

it('项目接口鉴权及参数校验在读写之前执行', async () => {
  const { call, directory } = await setup();
  expect((await call('/projects', 'GET', undefined, false)).status).toBe(401);
  expect((await call('/projects/not-a-uuid')).status).toBe(400);
  for (const name of ['CON', '../bad', 'x'.repeat(81)])
    expect((await call('/projects', 'POST', { name, location: directory })).status).toBe(400);
  expect((await call('/projects')).body).toEqual([]);
});

import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { CANVAS_LIMITS, CanvasRecord, emptyCanvasDocument } from '@frame-loom/contracts';
import { createEngine } from '../../application.js';
import { EngineConfig } from '../../core/config/config.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'loom-canvas-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const token = 'a'.repeat(64);
  const config = new EngineConfig(token, directory, [], 'b'.repeat(64));
  let app: INestApplication<Server>;
  let base: string;
  async function boot() {
    app = await createEngine(config);
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  }
  await boot();
  cleanups.push(() => app.close());
  return {
    call: async (path = '/canvases/lab', body?: unknown) => {
      const response = await fetch(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: (await response.json()) as unknown };
    },
    restart: async () => {
      await app.close();
      await boot();
    },
  };
}

const document = {
  ...emptyCanvasDocument(),
  nodes: [
    {
      id: 'image-1',
      type: 'image',
      typeVersion: 1,
      title: '待保存镜头',
      position: { x: 120, y: -30 },
      size: { width: 280, height: 180 },
      data: { versions: [], activeVersion: 0, prompt: '测试', inputOrder: [] },
    },
  ],
};
const view = { viewport: { x: 80, y: -20, zoom: 1.25 }, minimap: false, edgeDisplay: 'related' };

it('真实 SQLite 创建、读取、递增 revision；视图独立保存并在重启后保留', async () => {
  const { call, restart } = await setup();
  expect(await call()).toEqual({ status: 200, body: null });
  expect(await call('/canvases/lab/view', view)).toMatchObject({
    status: 404,
    body: { code: 'CANVAS_NOT_FOUND' },
  });
  expect(await call('/canvases/lab', { revision: 0, document })).toEqual({
    status: 200,
    body: { revision: 1 },
  });
  const initial = CanvasRecord.parse((await call()).body);
  expect(initial).toMatchObject({ id: 'lab', revision: 1, document, view: null });
  expect(await call('/canvases/lab/view', view)).toEqual({ status: 200, body: { saved: true } });
  expect(CanvasRecord.parse((await call()).body)).toEqual({ ...initial, view });
  const next = { ...document, nodes: [{ ...document.nodes[0], title: '已修改镜头' }] };
  expect(await call('/canvases/lab', { revision: 1, document: next })).toEqual({
    status: 200,
    body: { revision: 2 },
  });
  await restart();
  expect(CanvasRecord.parse((await call()).body)).toMatchObject({
    revision: 2,
    document: next,
    view,
  });
});

it('重复创建、过期或不存在的 revision 返回 409，并发写只有一份成功且不覆盖视图', async () => {
  const { call } = await setup();
  await call('/canvases/lab', { revision: 0, document });
  await call('/canvases/lab/view', view);
  for (const revision of [0, 2])
    expect(
      await call('/canvases/lab', { revision, document: emptyCanvasDocument() }),
    ).toMatchObject({ status: 409, body: { code: 'CANVAS_REVISION_CONFLICT' } });
  expect(await call('/canvases/missing', { revision: 1, document })).toMatchObject({
    status: 409,
    body: { code: 'CANVAS_REVISION_CONFLICT' },
  });
  const results = await Promise.all([
    call('/canvases/lab', { revision: 1, document }),
    call('/canvases/lab', { revision: 1, document: emptyCanvasDocument() }),
  ]);
  expect(results.map(({ status }) => status).sort()).toEqual([200, 409]);
  expect(CanvasRecord.parse((await call()).body)).toMatchObject({ revision: 2, view });
});

it('拒绝非法 id、请求、内置 data 和视图；未知类型数据无损往返', async () => {
  const { call } = await setup();
  for (const id of ['Lab', 'a'.repeat(65)])
    expect((await call(`/canvases/${id}`)).status).toBe(400);
  for (const input of [
    { revision: -1, document },
    { revision: 0, document, extra: true },
    { revision: 0, document: { ...document, nodes: [{ ...document.nodes[0], data: {} }] } },
    {
      revision: 0,
      document: {
        ...document,
        nodes: [
          {
            ...document.nodes[0],
            type: 'video',
            data: { ...document.nodes[0].data, mode: 'invalid' },
          },
        ],
      },
    },
    {
      revision: 0,
      document: {
        ...document,
        nodes: [{ ...document.nodes[0], type: 'group', data: { color: 'invalid' } }],
      },
    },
  ])
    expect((await call('/canvases/lab', input)).status).toBe(400);
  expect(await call()).toEqual({ status: 200, body: null });
  const unknown = {
    ...document,
    nodes: [
      {
        ...document.nodes[0],
        type: 'extension:note',
        typeVersion: 9,
        data: { future: ['原样保留', 42] },
      },
    ],
  };
  await call('/canvases/lab', { revision: 0, document: unknown });
  expect(
    (await call('/canvases/lab/view', { ...view, viewport: { ...view.viewport, zoom: 5 } })).status,
  ).toBe(400);
  expect(CanvasRecord.parse((await call()).body)).toMatchObject({
    document: unknown,
    view: null,
    revision: 1,
  });
});

it('校验节点、连线和文档字节上限，拒绝的内容不落盘', async () => {
  const { call } = await setup();
  const excessiveNodes = Array.from({ length: CANVAS_LIMITS.nodes + 1 }, (_, i) => ({
    ...document.nodes[0],
    id: `n${i}`,
  }));
  const nodes = [document.nodes[0], { ...document.nodes[0], id: 'image-2' }];
  const excessiveEdges = Array.from({ length: CANVAS_LIMITS.edges + 1 }, (_, i) => ({
    id: `e${i}`,
    source: nodes[0].id,
    target: nodes[1].id,
    sourceHandle: 'output',
    targetHandle: 'reference',
  }));
  const huge = [
    {
      ...document.nodes[0],
      type: 'extension:note',
      data: { text: '中'.repeat(Math.ceil(CANVAS_LIMITS.bytes / 3)) },
    },
  ];
  for (const invalid of [
    { ...document, nodes: excessiveNodes },
    { ...document, nodes, edges: excessiveEdges },
    { ...document, nodes: huge },
  ])
    expect((await call('/canvases/lab', { revision: 0, document: invalid })).status).toBe(400);
  expect(await call()).toEqual({ status: 200, body: null });
});

import { expect, it } from 'vitest';
import { CanvasDocument, migrateCanvasMediaData } from './canvas.js';

it('旧参数转语义键，同名语义值优先，未知键丢弃', () => {
  expect(
    migrateCanvasMediaData({
      params: {
        ratio: '16:9',
        aspect_ratio: '4:3',
        aspectRatio: '1:1',
        seconds: 5,
        generate_audio: true,
        sound: false,
        audio: true,
        resolution: '1080p',
        quality: 'high',
        invented: 1,
      },
      pendingParams: { ratio: '4:3', unknown: true },
    }),
  ).toEqual({
    params: { aspectRatio: '1:1', duration: 5, audio: true, resolution: '1080p', quality: 'high' },
    pendingParams: { aspectRatio: '4:3' },
  });
});

it.each([
  ['text', false, 't2v'],
  ['frames', false, 'first'],
  ['frames', true, 'first_last'],
  ['reference', false, 'reference'],
])('旧方式 %s、有尾帧 %s 转为 %s', (mode, last, expected) => {
  expect(migrateCanvasMediaData({ mode }, last)).toEqual({ mode: expected });
});

it('文档先迁移再校验，尾帧连线与版本保留，非法语义值仍拒绝', () => {
  const data = {
    versions: [],
    activeVersion: 0,
    prompt: '',
    inputOrder: [],
    mode: 'frames',
    params: { seconds: 5, removed: true },
  };
  const node = (id: string, type: string) => ({
    id,
    type,
    typeVersion: 2,
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
    data,
  });
  const document = {
    schemaVersion: 1,
    nodes: [node('source', 'image'), node('target', 'video')],
    edges: [
      {
        id: 'edge',
        source: 'source',
        target: 'target',
        sourceHandle: 'out',
        targetHandle: 'last_frame',
      },
    ],
  };
  const parsed = CanvasDocument.parse(document);
  expect(parsed.nodes[1]).toMatchObject({
    typeVersion: 3,
    data: { mode: 'first_last', params: { duration: 5 } },
  });
  expect(parsed.edges).toEqual(document.edges);
  expect(document.nodes[1].typeVersion).toBe(2);
  expect(
    CanvasDocument.safeParse({
      ...document,
      nodes: [{ ...document.nodes[0], data: { ...data, params: { seconds: 'bad' } } }],
    }).success,
  ).toBe(false);
});

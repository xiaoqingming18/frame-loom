import { describe, expect, it } from 'vitest';
import { CANVAS_LIMITS, CanvasDocument, CanvasView } from './canvas.js';

const sha = 'a'.repeat(64);
const media = (extra = {}) => ({
  versions: [
    {
      sha256: sha,
      mime: 'image/png',
      width: 10,
      height: 10,
      createdAt: '2026-10-25T00:00:00Z',
    },
  ],
  activeVersion: 0,
  prompt: '',
  inputOrder: [],
  ...extra,
});
const node = (id: string, type = 'image', extra = {}) => ({
  id,
  type,
  typeVersion: 1,
  position: { x: 0, y: 0 },
  size: { width: 100, height: 100 },
  data: type === 'group' ? { color: 'blue' } : media(),
  ...extra,
});
const edge = (id: string, source: string, target: string) => ({
  id,
  source,
  target,
  sourceHandle: 'out',
  targetHandle: 'reference',
});
const doc = (nodes: unknown[], edges: unknown[] = []) => ({ schemaVersion: 1, nodes, edges });

describe('CanvasDocument', () => {
  it('接受合法文档、分组和未知类型节点的任意 data', () => {
    const value = doc(
      [
        node('g', 'group'),
        node('a', 'image', { parentId: 'g' }),
        node('b', 'video', { data: media({ mode: 'frames' }) }),
        node('x', 'plugin:note', { data: { anything: [1, 2] } }),
      ],
      [edge('e', 'a', 'b')],
    );
    expect(CanvasDocument.parse(value)).toEqual(value);
  });

  it.each([
    ['父节点排在子节点之后', doc([node('a', 'image', { parentId: 'g' }), node('g', 'group')])],
    ['父节点不是分组', doc([node('p'), node('a', 'image', { parentId: 'p' })])],
    [
      '嵌套分组',
      doc([
        node('g', 'group'),
        node('h', 'group', { parentId: 'g' }),
        node('a', 'image', { parentId: 'h' }),
      ]),
    ],
    ['节点 id 重复', doc([node('a'), node('a')])],
    ['连线指向不存在的节点', doc([node('a')], [edge('e', 'a', 'b')])],
    ['自连', doc([node('a')], [edge('e', 'a', 'a')])],
    ['内置类型 data 非法', doc([node('a', 'image', { data: { versions: 'x' } })])],
    ['当前版本越界', doc([node('a', 'image', { data: media({ activeVersion: 3 }) })])],
    ['视频方式非法', doc([node('a', 'video', { data: media({ mode: 'audio' }) })])],
    [
      '媒体以 data URL 保存',
      doc([node('a', 'image', { data: media({ url: 'data:image/png;base64,AA' }) })]),
    ],
    ['未知字段', { ...doc([]), extra: 1 }],
    ['非法 id', doc([node('a b')])],
    ['schema 版本', { ...doc([]), schemaVersion: 2 }],
  ])('拒绝%s', (_name, value) => {
    expect(CanvasDocument.safeParse(value).success).toBe(false);
  });

  it('限制节点数量', () => {
    const nodes = Array.from({ length: CANVAS_LIMITS.nodes + 1 }, (_, i) => node(`n${i}`, 'x'));
    expect(CanvasDocument.safeParse(doc(nodes)).success).toBe(false);
  });
});

it('CanvasView 限制缩放范围与连线显示取值', () => {
  const view = { viewport: { x: 0, y: 0, zoom: 1 }, minimap: true, edgeDisplay: 'related' };
  expect(CanvasView.parse(view)).toEqual(view);
  expect(CanvasView.safeParse({ ...view, viewport: { x: 0, y: 0, zoom: 5 } }).success).toBe(false);
  expect(CanvasView.safeParse({ ...view, edgeDisplay: 'none' }).success).toBe(false);
});

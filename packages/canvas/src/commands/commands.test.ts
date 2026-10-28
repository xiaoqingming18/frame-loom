import { describe, expect, it } from 'vitest';
import { CanvasDocument } from '@frame-loom/contracts';
import { createBuiltinRegistry } from '../nodes/builtin';
import { doc, edge, group, media } from '../test-utils';
import { createCanvasStore } from '../store/store';
import type { CanvasMediaData } from '@frame-loom/contracts';
import {
  deleteElements,
  fitGroup,
  GROUP_PADDING,
  groupNodes,
  nudge,
  reparentAfterDrag,
  reorder,
  setLocked,
  setTag,
  isTaggable,
  ungroup,
  insertImageReference,
  createImageEditChild,
} from './commands';

const registry = createBuiltinRegistry();

it('参考连线与标签一步撤销；参考上限、成环、锁定错误不留下部分修改', () => {
  const source = media('source');
  source.data = {
    ...(source.data as CanvasMediaData),
    versions: [
      {
        sha256: 'a'.repeat(64),
        mime: 'image/png',
        width: 1,
        height: 1,
        createdAt: '2026-10-26T00:00:00.000Z',
      },
    ],
  };
  const store = createCanvasStore(doc([source, media('target')]));
  expect(
    store
      .getState()
      .apply((document) =>
        insertImageReference(registry, document, 'target', 'source', '@{source}', 1),
      ),
  ).toBe(true);
  expect(store.getState().document.edges).toHaveLength(1);
  expect((store.getState().document.nodes[1].data as CanvasMediaData).prompt).toBe('@{source}');
  expect(store.getState().past).toHaveLength(1);
  store.getState().undo();
  const original = store.getState().document;
  expect(original.edges).toHaveLength(0);
  expect((original.nodes[1].data as CanvasMediaData).prompt).toBe('');
  expect(() =>
    insertImageReference(registry, original, 'target', 'source', '@{source}', 0),
  ).toThrow('最多 0');
  expect(() =>
    insertImageReference(
      registry,
      { ...original, edges: [edge('reverse', 'target', 'source')] },
      'target',
      'source',
      '@{source}',
      1,
    ),
  ).toThrow('循环依赖');
  expect(() =>
    insertImageReference(
      registry,
      setLocked(original, new Set(['target']), true),
      'target',
      'source',
      '@{source}',
      1,
    ),
  ).toThrow('锁定');
  expect(store.getState().document).toBe(original);
});

it('创建图片编辑子节点和来源连线是一个撤销事务并固定活动源哈希', () => {
  const source = media('source');
  source.data = {
    ...(source.data as CanvasMediaData),
    versions: [
      {
        sha256: 'a'.repeat(64),
        mime: 'image/png',
        width: 10,
        height: 10,
        createdAt: '2026-10-26T00:00:00.000Z',
      },
    ],
  };
  const store = createCanvasStore(doc([source]));
  const recipe = {
    version: 1 as const,
    operation: 'angle' as const,
    source: { nodeId: 'source', sha256: 'a'.repeat(64) },
    horizontalAngle: 45,
    pitchAngle: 0,
    cameraDistance: 4.8,
    lens: 'standard' as const,
  };
  expect(
    store
      .getState()
      .apply((document) => createImageEditChild(registry, document, 'source', recipe, '提示')),
  ).toBe(true);
  expect(store.getState().document.nodes).toHaveLength(2);
  expect(store.getState().document.edges).toHaveLength(1);
  expect(store.getState().past).toHaveLength(1);
  store.getState().undo();
  expect(store.getState().document.nodes).toHaveLength(1);
  expect(store.getState().document.edges).toHaveLength(0);
});

describe('分组', () => {
  const base = doc([
    media('a', 'image', { position: { x: 100, y: 100 } }),
    media('b', 'image', { position: { x: 300, y: 200 } }),
    media('c', 'image', { position: { x: 900, y: 900 } }),
  ]);

  it('分组后子节点换算为相对坐标，分组框包住成员且父节点在前', () => {
    const { document, groupId } = groupNodes(registry, base, new Set(['a', 'b']));
    expect(CanvasDocument.safeParse(document).success).toBe(true);
    const groupNode = document.nodes[0];
    expect(groupNode.id).toBe(groupId);
    expect(groupNode.position).toEqual({ x: 100 - GROUP_PADDING.x, y: 100 - GROUP_PADDING.top });
    expect(groupNode.size).toEqual({
      width: 300 + GROUP_PADDING.x * 2,
      height: 200 + GROUP_PADDING.top + GROUP_PADDING.bottom,
    });
    const a = document.nodes.find((node) => node.id === 'a')!;
    expect(a.parentId).toBe(groupId);
    expect(a.position).toEqual({ x: GROUP_PADDING.x, y: GROUP_PADDING.top });
  });

  it('解组恢复绝对坐标；删除分组保留子节点', () => {
    const { document, groupId } = groupNodes(registry, base, new Set(['a', 'b']));
    for (const next of [ungroup(document, new Set([groupId])), ungroup(document, new Set(['a']))]) {
      expect(next.nodes.map((node) => node.id).sort()).toEqual(['a', 'b', 'c']);
      expect(next.nodes.find((node) => node.id === 'a')).toMatchObject({
        position: { x: 100, y: 100 },
      });
      expect(next.nodes.some((node) => 'parentId' in node)).toBe(false);
    }
  });

  it('选中分组再分组时合并成员，仍只有一层', () => {
    const first = groupNodes(registry, base, new Set(['a', 'b']));
    const second = groupNodes(registry, first.document, new Set([first.groupId, 'c']));
    expect(CanvasDocument.safeParse(second.document).success).toBe(true);
    expect(second.document.nodes.filter((node) => node.type === 'group')).toHaveLength(1);
    expect(second.document.nodes.filter((node) => node.parentId === second.groupId)).toHaveLength(
      3,
    );
  });

  it('拖入分组框中心时入组，拖出时脱离', () => {
    let document = doc([
      group('g', { position: { x: 0, y: 0 }, size: { width: 400, height: 300 } }),
      media('a', 'image', { position: { x: 50, y: 50 } }),
    ]);
    document = reparentAfterDrag(document, new Set(['a']));
    expect(document.nodes[1]).toMatchObject({ parentId: 'g', position: { x: 50, y: 50 } });
    document = {
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === 'a' ? { ...node, position: { x: 600, y: 0 } } : node,
      ),
    };
    document = reparentAfterDrag(document, new Set(['a']));
    expect(document.nodes[1]).toMatchObject({ position: { x: 600, y: 0 } });
    expect('parentId' in document.nodes[1]).toBe(false);
  });

  it('适应内容收紧组框且子节点绝对位置不变', () => {
    const document = doc([
      group('g', { position: { x: 0, y: 0 }, size: { width: 1000, height: 1000 } }),
      media('a', 'image', { parentId: 'g', position: { x: 200, y: 300 } }),
    ]);
    const next = fitGroup(document, 'g');
    const g = next.nodes[0];
    const a = next.nodes[1];
    expect(g.position.x + a.position.x).toBe(200);
    expect(g.position.y + a.position.y).toBe(300);
    expect(g.size.width).toBe(100 + GROUP_PADDING.x * 2);
  });

  it('拖动整组不把子节点重新归属到重叠分组', () => {
    const document = doc([
      group('g'),
      group('overlap'),
      media('a', 'image', { parentId: 'g', position: { x: 30, y: 60 } }),
    ]);
    expect(reparentAfterDrag(document, new Set(['g', 'a']))).toBe(document);
  });

  it('锁定组阻止成员移动、删除、重新分组和拖入', () => {
    const document = doc([
      group('g', { locked: true }),
      media('a', 'image', { parentId: 'g' }),
      media('b', 'image', { position: { x: 30, y: 60 } }),
    ]);
    expect(nudge(document, new Set(['a']), { x: 10, y: 10 })).toBe(document);
    expect(deleteElements(document, new Set(['a', 'g']))).toBe(document);
    expect(ungroup(document, new Set(['a']))).toBe(document);
    expect(fitGroup(document, 'g')).toBe(document);
    expect(reparentAfterDrag(document, new Set(['b']))).toBe(document);
    expect(() => groupNodes(registry, document, new Set(['a', 'g']))).toThrow('请选择');
  });

  it('置顶置底保持父节点顺序与子级归属，锁定节点不参与', () => {
    const document = doc([
      group('g'),
      media('a', 'image', { parentId: 'g' }),
      media('b', 'image', { parentId: 'g' }),
      media('c'),
    ]);
    const next = reorder(document, new Set(['a']), 'front');
    expect(next.nodes.map((node) => node.id)).toEqual(['g', 'b', 'a', 'c']);
    expect(CanvasDocument.safeParse(next).success).toBe(true);
    expect(reorder(next, new Set(['a']), 'back').nodes.map((node) => node.id)).toEqual([
      'g',
      'a',
      'b',
      'c',
    ]);
  });
});

describe('删除、锁定与微移', () => {
  it('删除节点时同时删除相关连线与 inputOrder 引用，锁定节点不被删除', () => {
    let document = doc(
      [media('a'), media('b'), media('c')],
      [edge('e1', 'a', 'b'), edge('e2', 'c', 'b')],
    );
    document.nodes[1] = {
      ...document.nodes[1],
      data: { ...(document.nodes[1].data as object), inputOrder: ['e1', 'e2'] },
    };
    document = deleteElements(document, new Set(['a']));
    expect(document.edges.map((item) => item.id)).toEqual(['e2']);
    expect(
      (document.nodes.find((node) => node.id === 'b')!.data as { inputOrder: string[] }).inputOrder,
    ).toEqual(['e2']);
    const locked = setLocked(document, new Set(['c']), true);
    expect(deleteElements(locked, new Set(['c']))).toBe(locked);
    expect(
      nudge(locked, new Set(['c', 'b']), { x: 10, y: 0 }).nodes.map((node) => node.position.x),
    ).toEqual([10, 0]);
  });
});

it('批量标签跳过不可打标签、自身与分组锁定的节点，一步撤销且重复操作不记历史', () => {
  const document = doc([
    group('g', { locked: true }),
    media('child', 'image', { parentId: 'g' }),
    media('locked', 'video', { locked: true }),
    media('a'),
    media('b', 'video'),
  ]);
  const store = createCanvasStore(document);
  const ids = new Set(document.nodes.map((node) => node.id));
  expect(isTaggable(document.nodes[0])).toBe(false);
  store.getState().apply((current) => setTag(current, ids, 'builtin-prop'));
  expect(store.getState().document.nodes.map((node) => node.tagId)).toEqual([
    undefined,
    undefined,
    undefined,
    'builtin-prop',
    'builtin-prop',
  ]);
  store.getState().apply((current) => setTag(current, ids, 'builtin-prop'));
  expect(store.getState().past).toHaveLength(1);
  store.getState().undo();
  expect(store.getState().document).toBe(document);
  store.getState().redo();
  store.getState().apply((current) => setTag(current, ids, null));
  expect(store.getState().document.nodes.every((node) => !('tagId' in node))).toBe(true);
});

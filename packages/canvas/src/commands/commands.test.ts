import { describe, expect, it } from 'vitest';
import { CanvasDocument } from '@frame-loom/contracts';
import { createBuiltinRegistry } from '../nodes/builtin';
import { doc, edge, group, media } from '../test-utils';
import {
  deleteElements,
  fitGroup,
  GROUP_PADDING,
  groupNodes,
  nudge,
  reparentAfterDrag,
  reorder,
  setLocked,
  ungroup,
} from './commands';

const registry = createBuiltinRegistry();

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

import { expect, it } from 'vitest';
import { doc, edge, group, media } from '../test-utils';
import { reorder } from '../commands/commands';
import { createNodeMapper, toFlowEdges } from './flow-mapping';

it('三档连线显示只控制可见性，悬停、拖线焦点和选中边可临时显示', () => {
  const document = doc(
    [media('a'), media('b'), media('c')],
    [edge('ab', 'a', 'b'), edge('bc', 'b', 'c')],
  );
  const edges = (
    display: 'all' | 'related' | 'hidden',
    focus = new Set<string>(),
    selected = new Set<string>(),
  ) => toFlowEdges(document, selected, display, focus, new Map());
  expect(edges('all').map((edge) => edge.hidden)).toEqual([false, false]);
  expect(edges('related', new Set(['a'])).map((edge) => edge.hidden)).toEqual([false, true]);
  expect(edges('hidden').every((edge) => edge.hidden)).toBe(true);
  expect(edges('hidden', new Set(['c']), new Set(['ab'])).map((edge) => edge.hidden)).toEqual([
    false,
    false,
  ]);
  expect(document.edges).toHaveLength(2);
});

it('选择变化只重建相关节点映射，切换抓手禁用拖拽与选择', () => {
  const map = createNodeMapper();
  const document = doc([media('a'), media('b')]);
  const before = map(document, new Set(), false);
  const after = map(document, new Set(['a']), false);
  expect(after[0]).not.toBe(before[0]);
  expect(after[1]).toBe(before[1]);
  expect(
    map(document, new Set(['a']), true).every((node) => !node.draggable && !node.selectable),
  ).toBe(true);
});

it('调整层级更新缓存中的 zIndex；组框始终低于普通节点，组锁定覆盖成员', () => {
  const map = createNodeMapper();
  const document = doc([
    group('g', { locked: true }),
    media('a', 'image', { parentId: 'g' }),
    media('b'),
    media('c'),
  ]);
  const before = map(document, new Set(), false);
  const after = map(reorder(document, new Set(['b']), 'front'), new Set(), false);
  const z = (id: string) => after.find((node) => node.id === id)!.zIndex!;
  expect(z('b')).toBeGreaterThan(z('c'));
  expect(z('g')).toBeLessThan(z('a'));
  expect(after.find((node) => node.id === 'b')).not.toBe(before.find((node) => node.id === 'b'));
  expect(after.find((node) => node.id === 'a')).toMatchObject({
    draggable: false,
    connectable: false,
  });
});

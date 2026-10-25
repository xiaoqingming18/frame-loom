import { expect, it } from 'vitest';
import { doc, edge, media } from '../test-utils';
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

import { describe, expect, it } from 'vitest';
import { doc, group, media } from '../test-utils';
import { arrange, arrangeBoxes, ARRANGE_GAP } from './layout';
import { absolutePosition } from '../commands/commands';
import { createCanvasStore } from '../store/store';

const box = (id: string, width = 100, height = 100) => ({ id, width, height });

describe('arrangeBoxes', () => {
  it('水平、垂直按尺寸加间距排列', () => {
    expect([...arrangeBoxes([box('a', 50), box('b')], 'horizontal').values()]).toEqual([
      { x: 0, y: 0 },
      { x: 50 + ARRANGE_GAP, y: 0 },
    ]);
    expect([...arrangeBoxes([box('a', 100, 30), box('b')], 'vertical').values()]).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 30 + ARRANGE_GAP },
    ]);
  });

  it('宫格按每列最宽、每行最高对齐，节点不重叠', () => {
    const result = arrangeBoxes([box('a', 200, 50), box('b'), box('c', 80, 300), box('d')], 'grid');
    expect(result.get('b')).toEqual({ x: 200 + ARRANGE_GAP, y: 0 });
    expect(result.get('c')).toEqual({ x: 0, y: 100 + ARRANGE_GAP });
    expect(result.get('d')).toEqual({ x: 200 + ARRANGE_GAP, y: 100 + ARRANGE_GAP });
  });
});

describe('arrange', () => {
  it.each(['grid', 'horizontal', 'vertical', 'type'] as const)(
    '选组或全图时整理组内成员，%s 整体只撤销一步',
    (mode) => {
      const document = doc([
        group('g', { position: { x: 50, y: 20 }, size: { width: 2000, height: 2000 } }),
        media('a', 'image', { parentId: 'g', position: { x: 80, y: 100 } }),
        media('b', 'video', { parentId: 'g', position: { x: 500, y: 800 } }),
        media('c', 'image', { locked: true, position: { x: 4000, y: 0 } }),
      ]);
      for (const selected of [new Set<string>(), new Set(['g', 'a', 'b'])]) {
        const store = createCanvasStore(document);
        store.getState().apply((current) => arrange(current, selected, mode));
        const next = store.getState().document;
        expect(absolutePosition(next, next.nodes[1])).toEqual({ x: 130, y: 120 });
        expect(next.nodes[0].size.width).toBeLessThan(2000);
        expect(next.nodes[0].size.height).toBeLessThan(2000);
        expect(next.nodes[3]).toBe(document.nodes[3]);
        expect(store.getState().past).toHaveLength(1);
        store.getState().undo();
        expect(store.getState().document).toBe(document);
      }
    },
  );

  it('锁定组的成员不参与整理', () => {
    const document = doc([
      group('g', { locked: true }),
      media('a', 'image', { parentId: 'g' }),
      media('b', 'image', { parentId: 'g' }),
    ]);
    expect(arrange(document, new Set(), 'horizontal')).toBe(document);
  });
  it('锚点保持在原包围盒左上角，按类型每类一行', () => {
    const document = doc([
      media('v', 'video', { position: { x: 500, y: 40 } }),
      media('a', 'image', { position: { x: 300, y: 900 } }),
      media('b', 'image', { position: { x: 20, y: 600 } }),
    ]);
    const next = arrange(document, new Set(), 'type');
    const at = (id: string) => next.nodes.find((node) => node.id === id)!.position;
    expect(at('v')).toEqual({ x: 20, y: 40 });
    expect(at('a')).toEqual({ x: 20, y: 40 + 100 + ARRANGE_GAP });
    expect(at('b')).toEqual({ x: 20 + 100 + ARRANGE_GAP, y: 40 + 100 + ARRANGE_GAP });
  });

  it('按标题数字感知排序；组内整理后收紧组框；锁定节点不动', () => {
    const document = doc([
      group('g', { position: { x: 0, y: 0 }, size: { width: 2000, height: 2000 } }),
      media('n10', 'image', { parentId: 'g', title: '镜头10', position: { x: 500, y: 500 } }),
      media('n2', 'image', { parentId: 'g', title: '镜头2', position: { x: 100, y: 100 } }),
      media('x', 'image', { locked: true, position: { x: 3000, y: 0 } }),
    ]);
    const next = arrange(document, new Set(['n10', 'n2', 'x']), 'horizontal', 'title');
    const g = next.nodes.find((node) => node.id === 'g')!;
    const abs = (id: string) => {
      const node = next.nodes.find((item) => item.id === id)!;
      return { x: g.position.x + node.position.x, y: g.position.y + node.position.y };
    };
    expect(abs('n2')).toEqual({ x: 100, y: 100 });
    expect(abs('n10')).toEqual({ x: 100 + 100 + ARRANGE_GAP, y: 100 });
    expect(g.size.width).toBeLessThan(2000);
    expect(next.nodes.find((node) => node.id === 'x')!.position).toEqual({ x: 3000, y: 0 });
  });
});

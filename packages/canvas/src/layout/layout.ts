import type { CanvasDocument, CanvasNode } from '@frame-loom/contracts';
import { absolutePosition, boundsOf, fitGroup, moveNodes, type Point } from '../commands/commands';

export type ArrangeMode = 'grid' | 'horizontal' | 'vertical' | 'type';
export type ArrangeOrder = 'title' | 'created';
export const ARRANGE_GAP = 40;

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

type Box = { id: string; width: number; height: number };

/** 计算相对锚点的位置，纯函数，不依赖 DOM。 */
export function arrangeBoxes(
  boxes: Box[],
  mode: Exclude<ArrangeMode, 'type'>,
  gap = ARRANGE_GAP,
  columns = Math.ceil(Math.sqrt(boxes.length)),
): Map<string, Point> {
  const result = new Map<string, Point>();
  if (mode === 'horizontal') {
    let x = 0;
    for (const box of boxes) {
      result.set(box.id, { x, y: 0 });
      x += box.width + gap;
    }
  } else if (mode === 'vertical') {
    let y = 0;
    for (const box of boxes) {
      result.set(box.id, { x: 0, y });
      y += box.height + gap;
    }
  } else {
    const cols = Math.max(1, columns);
    // 每列取最宽、每行取最高，保证节点尺寸不同时也不重叠。
    const widths = Array.from({ length: cols }, (_, c) =>
      Math.max(0, ...boxes.filter((_, i) => i % cols === c).map((box) => box.width)),
    );
    const rows = Math.ceil(boxes.length / cols);
    const heights = Array.from({ length: rows }, (_, r) =>
      Math.max(0, ...boxes.slice(r * cols, r * cols + cols).map((box) => box.height)),
    );
    boxes.forEach((box, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      result.set(box.id, {
        x: widths.slice(0, c).reduce((sum, w) => sum + w + gap, 0),
        y: heights.slice(0, r).reduce((sum, h) => sum + h + gap, 0),
      });
    });
  }
  return result;
}

/** 按类型分桶，每桶一行。 */
export function arrangeByType(boxes: (Box & { type: string })[], gap = ARRANGE_GAP) {
  const result = new Map<string, Point>();
  const types = [...new Set(boxes.map((box) => box.type))];
  let y = 0;
  for (const type of types) {
    const row = boxes.filter((box) => box.type === type);
    for (const [id, point] of arrangeBoxes(row, 'horizontal', gap))
      result.set(id, { x: point.x, y });
    y += Math.max(...row.map((box) => box.height)) + gap;
  }
  return result;
}

function sortNodes(nodes: CanvasNode[], order: ArrangeOrder, original: CanvasNode[]) {
  if (order === 'created')
    return [...nodes].sort((a, b) => original.indexOf(a) - original.indexOf(b));
  return [...nodes].sort((a, b) => collator.compare(a.title ?? '', b.title ?? ''));
}

/**
 * 整理选中节点；没有选中时整理全部顶层节点。整理在各自父级内进行，
 * 锚点保持在原包围盒左上角，分组随后收紧组框。
 */
export function arrange(
  document: CanvasDocument,
  selected: ReadonlySet<string>,
  mode: ArrangeMode,
  order: ArrangeOrder = 'created',
): CanvasDocument {
  const scope = selected.size
    ? document.nodes.filter((node) => selected.has(node.id) && !node.locked)
    : document.nodes.filter((node) => !node.parentId && !node.locked);
  const byParent = new Map<string | undefined, CanvasNode[]>();
  for (const node of scope)
    byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node]);
  let next = document;
  for (const [parentId, siblings] of byParent) {
    if (siblings.length < 2 && !parentId) continue;
    const nodes = sortNodes(siblings, order, document.nodes);
    const anchor = boundsOf(
      nodes.map((node) => ({ ...absolutePosition(document, node), ...node.size })),
    )!;
    const boxes = nodes.map((node) => ({ id: node.id, type: node.type, ...node.size }));
    const relative = mode === 'type' ? arrangeByType(boxes) : arrangeBoxes(boxes, mode);
    const parent = parentId ? document.nodes.find((node) => node.id === parentId) : undefined;
    const offset = parent ? parent.position : { x: 0, y: 0 };
    const positions = new Map<string, Point>();
    for (const [id, point] of relative)
      positions.set(id, {
        x: Math.round(anchor.x + point.x - offset.x),
        y: Math.round(anchor.y + point.y - offset.y),
      });
    next = moveNodes(next, positions);
    if (parentId) next = fitGroup(next, parentId);
  }
  return next;
}

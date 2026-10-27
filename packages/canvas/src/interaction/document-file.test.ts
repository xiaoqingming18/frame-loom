import { expect, it } from 'vitest';
import { CANVAS_LIMITS } from '@frame-loom/contracts';
import { createBuiltinRegistry } from '../nodes/builtin';
import { createCanvasStore } from '../store/store';
import { doc, edge, group, media } from '../test-utils';
import { parseDocument } from './document-file';

const registry = createBuiltinRegistry();

it.each(['image', 'video'] as const)('导入旧 %s 节点迁移任务引用且其余数据保留', (kind) => {
  const pendingJobId = '11111111-1111-4111-8111-111111111111';
  const node = media('old', kind, { typeVersion: 1 });
  node.data = { ...(node.data as object), pendingJobId, params: { size: '1024x1024' } };
  const migrated = parseDocument(JSON.stringify(doc([node])), registry).nodes[0];
  const { pendingJobId: oldId, ...rest } = node.data as Record<string, unknown>;
  expect(migrated).toEqual({ ...node, typeVersion: 2, data: { ...rest, pendingJobIds: [oldId] } });
});

it('JSON 往返保留分组、层级、锁定与连线，整份替换可撤销重做', () => {
  const document = doc(
    [
      group('g', { data: { color: 'blue' } }),
      media('a', 'image', { parentId: 'g', locked: true }),
      media('b'),
    ],
    [edge('ab', 'a', 'b')],
  );
  const store = createCanvasStore();
  const original = store.getState().document;
  const parsed = parseDocument(JSON.stringify(document), registry);
  store.getState().apply(() => parsed);
  expect(store.getState().document).toEqual(document);
  store.getState().undo();
  expect(store.getState().document).toBe(original);
  store.getState().redo();
  expect(store.getState().document).toEqual(document);
});

it('拒绝非法 JSON、超限、非法分组、内置数据、重复连线与环，原文档不变', () => {
  const store = createCanvasStore(doc([media('kept')]));
  const original = store.getState().document;
  const invalid = [
    '{',
    ' '.repeat(CANVAS_LIMITS.bytes + 1),
    JSON.stringify(doc([media('a', 'image', { parentId: 'missing' })])),
    JSON.stringify(doc([media('a', 'image', { data: {} })])),
    JSON.stringify(doc([media('a'), media('b')], [edge('a1', 'a', 'b'), edge('a2', 'a', 'b')])),
    JSON.stringify(doc([media('a'), media('b')], [edge('ab', 'a', 'b'), edge('ba', 'b', 'a')])),
    JSON.stringify(
      doc(
        [media('a'), media('b', 'video')],
        [{ ...edge('ab', 'a', 'b'), targetHandle: 'unknown' }],
      ),
    ),
  ];
  for (const text of invalid) {
    expect(store.getState().apply(() => parseDocument(text, registry))).toBe(false);
    expect(store.getState().document).toBe(original);
    expect(store.getState().past).toHaveLength(0);
  }
});

it('切换模式后保留的不活跃视频端口可以导入，生成时另行检查能力', () => {
  const document = doc([media('a'), media('b', 'video')], [edge('ab', 'a', 'b')]);
  expect(parseDocument(JSON.stringify(document), registry)).toEqual(document);
});

it('未知类型与未来版本的节点、data 和连线原样保留', () => {
  const document = doc(
    [media('a', 'image', { type: 'future', data: { opaque: '保留' } }), media('b')],
    [edge('ab', 'a', 'b')],
  );
  expect(parseDocument(JSON.stringify(document), registry)).toEqual(document);
  document.nodes[0] = media('a', 'image', { typeVersion: 3 });
  expect(parseDocument(JSON.stringify(document), registry)).toEqual(document);
});

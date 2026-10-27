import { expect, it } from 'vitest';
import { BUILTIN_TAGS, type ProjectTag } from '@frame-loom/contracts';
import { doc, media } from '../test-utils';
import { createBuiltinRegistry } from '../nodes/builtin';
import { copySelection, deserialize, instantiate, serialize } from './clipboard';
import { parseDocument } from './document-file';
import { resolveTags } from './tags';

const target: ProjectTag = { id: 'target', name: 'NAME', color: 'blue', builtin: false };
it('同项目优先 id，跨项目按名称忽略大小写匹配，无同名或旧载荷清空', () => {
  const nodes = [
    media('same', 'image', { tagId: 'target' }),
    media('match', 'video', { tagId: 'source' }),
    media('missing', 'image', { tagId: 'absent' }),
  ];
  const resolved = resolveTags(nodes, [{ id: 'source', name: 'name' }], [target]);
  expect(resolved.map((node) => node.tagId)).toEqual(['target', 'target', undefined]);
  expect(resolved[0]).toBe(nodes[0]);
  expect(resolveTags(nodes, undefined, [target]).map((node) => node.tagId)).toEqual([
    'target',
    undefined,
    undefined,
  ]);
  expect(nodes[1].tagId).toBe('source');
});

it('剪贴板旁表只包含用到的标签，经序列化和实例化保留供名称映射', () => {
  const document = doc([media('a', 'image', { tagId: target.id })]);
  const copied = copySelection(document, new Set(['a']), [target, ...BUILTIN_TAGS])!;
  expect(copied.tags).toEqual([{ id: target.id, name: target.name }]);
  const payload = deserialize(serialize(copied), createBuiltinRegistry())!;
  expect(payload.tags).toEqual(copied.tags);
  const instantiated = instantiate(payload, { x: 0, y: 0 });
  expect(instantiated.nodes[0].tagId).toBe(target.id);
  expect(resolveTags(instantiated.nodes, payload.tags, [{ ...target, id: 'other' }])[0].tagId).toBe(
    'other',
  );
  const legacy = deserialize(serialize({ nodes: document.nodes, edges: [] }))!;
  expect(legacy.tags).toBeUndefined();
});

it('导入剥离标签旁表再校验文档，同名映射且旧文件可读，非法旁表拒绝', () => {
  const registry = createBuiltinRegistry();
  const document = doc([media('a', 'image', { tagId: 'source' })]);
  const file = { ...document, tags: [{ id: 'source', name: 'name' }] };
  expect(parseDocument(JSON.stringify(file), registry, [target]).nodes[0].tagId).toBe(target.id);
  expect(parseDocument(JSON.stringify(file), registry, []).nodes[0].tagId).toBeUndefined();
  expect(
    parseDocument(JSON.stringify(document), registry, [target]).nodes[0].tagId,
  ).toBeUndefined();
  expect(() =>
    parseDocument(JSON.stringify({ ...file, tags: [{ id: 'source', name: 1 }] }), registry),
  ).toThrow('标签结构无效');
});

import { describe, expect, it } from 'vitest';
import { CanvasDocument } from '@frame-loom/contracts';
import { doc, edge, group, media } from '../test-utils';
import {
  CLIPBOARD_MAX_BYTES,
  CLIPBOARD_PREFIX,
  copySelection,
  deserialize,
  instantiate,
  serialize,
} from './clipboard';
import { shortcutFor, shouldIgnore } from './keys';
import { createBuiltinRegistry } from '../nodes/builtin';

const key = (
  key: string,
  extra: Partial<KeyboardEvent> = {},
  target: EventTarget | null = document.body,
) =>
  ({
    key,
    code: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    keyCode: 0,
    target,
    ...extra,
  }) as KeyboardEvent;

it('旧剪贴板节点迁移到 v2，任务引用保留', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const node = media('old', 'image', { typeVersion: 1 });
  node.data = { ...(node.data as object), pendingJobId: id };
  const next = deserialize(serialize({ nodes: [node], edges: [] }), createBuiltinRegistry());
  expect(next?.nodes[0]).toMatchObject({ typeVersion: 2, data: { pendingJobIds: [id] } });
  expect(next?.nodes[0].data).not.toHaveProperty('pendingJobId');
});

describe('快捷键', () => {
  it('映射工具、编辑与视图快捷键', () => {
    expect(shortcutFor(key('v'))).toBe('tool-pointer');
    expect(shortcutFor(key('B', { shiftKey: false }))).toBe('tool-select');
    expect(shortcutFor(key('z', { ctrlKey: true }))).toBe('undo');
    expect(shortcutFor(key('Z', { ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(shortcutFor(key('y', { ctrlKey: true }))).toBe('redo');
    expect(shortcutFor(key('g', { ctrlKey: true, shiftKey: true }))).toBe('ungroup');
    expect(shortcutFor(key('!', { shiftKey: true, code: 'Digit1' }))).toBe('fit-view');
    expect(shortcutFor(key('=', { ctrlKey: true }))).toBe('zoom-in');
    expect(shortcutFor(key('?', { shiftKey: true }))).toBe('help');
    expect(shortcutFor(key('Delete'))).toBe('delete');
    expect(shortcutFor(key('ArrowLeft', { shiftKey: true }))).toBe('nudge-left');
    expect(shortcutFor(key('c', { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(key('v', { altKey: true }))).toBeNull();
  });

  it('可编辑元素内和输入法组字时不处理', () => {
    const input = document.createElement('input');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    editable.append(child);
    expect(shouldIgnore(key('Backspace', {}, input))).toBe(true);
    expect(shouldIgnore(key('Backspace', {}, child))).toBe(true);
    expect(shouldIgnore(key(' ', { isComposing: true }))).toBe(true);
    expect(shouldIgnore(key('Process', { keyCode: 229 }))).toBe(true);
    expect(shouldIgnore(key('Delete'))).toBe(false);
  });
});

describe('剪贴板', () => {
  const source = doc(
    [
      group('g', { position: { x: 100, y: 100 } }),
      media('a', 'image', { parentId: 'g', position: { x: 10, y: 10 } }),
      media('b', 'image', { position: { x: 500, y: 500 } }),
      media('c', 'image', { position: { x: 900, y: 900 } }),
    ],
    [edge('e1', 'a', 'b'), edge('e2', 'c', 'b')],
  );

  it('复制分组连带子节点，只保留内部连线，粘贴时重写 id 并定位', () => {
    const payload = copySelection(source, new Set(['g', 'b']))!;
    expect(payload.nodes.map((node) => node.id)).toEqual(['g', 'a', 'b']);
    expect(payload.edges.map((item) => item.id)).toEqual(['e1']);
    const parsed = deserialize(serialize(payload))!;
    const { nodes, edges } = instantiate(parsed, { x: 0, y: 0 });
    const ids = new Set(nodes.map((node) => node.id));
    expect(['g', 'a', 'b'].some((id) => ids.has(id))).toBe(false);
    expect(nodes[1].parentId).toBe(nodes[0].id);
    expect(nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(nodes[2].position).toEqual({ x: 400, y: 400 });
    expect(edges[0]).toMatchObject({ source: nodes[1].id, target: nodes[2].id });
    expect(
      CanvasDocument.safeParse(doc([...source.nodes, ...nodes], [...source.edges, ...edges]))
        .success,
    ).toBe(true);
  });

  it('只复制子节点时转为绝对坐标', () => {
    const payload = copySelection(source, new Set(['a']))!;
    expect(payload.nodes[0]).toMatchObject({ position: { x: 110, y: 110 } });
    expect('parentId' in payload.nodes[0]).toBe(false);
  });

  it('拒绝无前缀、非法结构、重复 id 和超限内容', () => {
    const payload = copySelection(source, new Set(['b']))!;
    expect(deserialize(JSON.stringify(payload))).toBeNull();
    expect(deserialize(`${CLIPBOARD_PREFIX}{"nodes":[]}`)).toBeNull();
    expect(deserialize(`${CLIPBOARD_PREFIX}not json`)).toBeNull();
    expect(
      deserialize(serialize({ nodes: [payload.nodes[0], payload.nodes[0]], edges: [] })),
    ).toBeNull();
    expect(deserialize(CLIPBOARD_PREFIX + ' '.repeat(CLIPBOARD_MAX_BYTES))).toBeNull();
    expect(
      deserialize(
        serialize({ nodes: [{ ...payload.nodes[0], title: '画'.repeat(500_000) }], edges: [] }),
      ),
    ).toBeNull();
  });

  it('按 UTF-8 大小限制复制，校验内置 data、父子顺序与重复边', () => {
    const payload = copySelection(source, new Set(['b']))!;
    expect(() =>
      serialize({ nodes: [{ ...payload.nodes[0], title: '画'.repeat(1_500_000) }], edges: [] }),
    ).toThrow('4 MiB');
    const groupPayload = { nodes: [media('a', 'image', { parentId: 'g' }), group('g')], edges: [] };
    expect(deserialize(serialize(groupPayload))).toBeNull();
    expect(
      deserialize(serialize({ nodes: [{ ...payload.nodes[0], data: {} }], edges: [] })),
    ).toBeNull();
    expect(
      deserialize(
        serialize({
          nodes: [payload.nodes[0], media('c')],
          edges: [edge('e', 'b', 'c'), edge('e', 'b', 'c')],
        }),
      ),
    ).toBeNull();
  });

  it('按注册表拒绝伪造端口和循环，重写 inputOrder', () => {
    const registry = createBuiltinRegistry();
    const nodes = [
      media('a'),
      media('b', 'image', {
        data: { versions: [], activeVersion: 0, prompt: '', inputOrder: ['e1', 'external'] },
      }),
    ];
    const payload = { nodes, edges: [edge('e1', 'a', 'b')] };
    const parsed = deserialize(serialize(payload), registry)!;
    expect(parsed).not.toBeNull();
    const result = instantiate(parsed, { x: 10, y: 10 });
    expect(result.nodes[1].data).toMatchObject({ inputOrder: [result.edges[0].id] });
    expect(
      deserialize(serialize({ nodes, edges: [edge('e1', 'a', 'b', 'missing')] }), registry),
    ).toBeNull();
    expect(
      deserialize(
        serialize({ nodes, edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'a')] }),
        registry,
      ),
    ).toBeNull();
  });
});

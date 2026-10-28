import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { CanvasMediaData } from '@frame-loom/contracts';
import { createBuiltinRegistry } from '../nodes/builtin';
import { changeDataDroppingEdges, connect, CanvasCommandError } from '../commands/commands';
import { doc, edge, group, media } from '../test-utils';
import { checkConnection } from './connections';

const registry = createBuiltinRegistry().register({
  type: 'audio',
  version: 1,
  label: '音频',
  icon: null,
  defaultSize: { width: 100, height: 100 },
  minSize: { width: 50, height: 50 },
  dataSchema: z.object({}),
  createData: () => ({}),
  inputs: () => [{ id: 'reference', label: '参考音频', accepts: ['audio'], max: 1 }],
  outputs: () => [{ id: 'out', label: '音频', dataType: 'audio' }],
  View: () => null,
});
const video = (id: string, mode: CanvasMediaData['mode']) => ({
  ...media(id, 'video'),
  data: { ...(media(id, 'video').data as CanvasMediaData), mode },
});
const attempt = (source: string, target: string, targetHandle = 'reference') => ({
  source,
  sourceHandle: 'out',
  target,
  targetHandle,
});

describe('checkConnection', () => {
  const nodes = [
    media('img'),
    media('img2'),
    video('first_last', 'first_last'),
    video('text', 't2v'),
    video('ref', 'reference'),
    { ...media('aud'), type: 'audio', typeVersion: 1, data: {} },
    group('g'),
  ];

  it('未知、未来版本和非法数据节点保留数据但不暴露端口', () => {
    for (const node of [
      media('future', 'image', { typeVersion: 4 }),
      media('invalid', 'image', { data: {} }),
      media('unknown', 'image', { type: 'plugin:new' }),
    ]) {
      expect(registry.supports(node)).toBe(false);
      expect(registry.inputs(node)).toEqual([]);
      expect(registry.outputs(node)).toEqual([]);
    }
    expect(registry.supports(media('current'))).toBe(true);
  });

  it('图片可作为图片参考、首帧、尾帧和全模态参考', () => {
    const document = doc(nodes);
    expect(checkConnection(registry, document, attempt('img', 'img2')).ok).toBe(true);
    expect(
      checkConnection(registry, document, attempt('img', 'first_last', 'first_frame')).ok,
    ).toBe(true);
    expect(checkConnection(registry, document, attempt('img', 'first_last', 'last_frame')).ok).toBe(
      true,
    );
    expect(checkConnection(registry, document, attempt('img', 'ref')).ok).toBe(true);
    expect(checkConnection(registry, document, attempt('aud', 'ref')).ok).toBe(true);
  });

  it.each([
    ['图片连到音频端口', attempt('img', 'aud'), '不接受图片'],
    ['视频作为图片参考', attempt('ref', 'img'), '不接受视频'],
    ['文生视频没有媒体输入', attempt('img', 'text'), '端口不存在'],
    ['首尾帧没有参考口', attempt('img', 'first_last'), '端口不存在'],
    ['自连', attempt('img', 'img'), '不能连接自己'],
    ['分组参与连线', attempt('img', 'g'), '不支持连线'],
    ['节点不存在', attempt('img', 'missing'), '节点不存在'],
  ])('拒绝%s', (_name, value, reason) => {
    const verdict = checkConnection(registry, doc(nodes), value);
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.reason).toContain(reason);
  });

  it('拒绝重复连线、超过端口条数和循环依赖', () => {
    const document = doc(nodes, [
      edge('e1', 'img', 'img2'),
      edge('e2', 'img', 'first_last', 'first_frame'),
    ]);
    expect(checkConnection(registry, document, attempt('img', 'img2'))).toMatchObject({
      ok: false,
      reason: '这两个端口已经连接',
    });
    expect(
      checkConnection(registry, document, attempt('img2', 'first_last', 'first_frame')),
    ).toMatchObject({
      ok: false,
      reason: '「首帧」最多 1 条连线',
    });
    expect(checkConnection(registry, document, attempt('img2', 'img'))).toMatchObject({
      ok: false,
      reason: '连线会形成循环依赖',
    });
    // 重连时忽略被替换的那条边。
    expect(
      checkConnection(registry, document, attempt('img2', 'first_last', 'first_frame'), 'e2').ok,
    ).toBe(true);
  });
});

describe('连线命令', () => {
  it('连线追加到目标的 inputOrder，非法连线抛出中文原因', () => {
    const next = connect(registry, doc([media('a'), media('b')]), attempt('a', 'b'));
    const target = next.nodes.find((node) => node.id === 'b')!;
    expect((target.data as CanvasMediaData).inputOrder).toEqual([next.edges[0].id]);
    expect(() => connect(registry, next, attempt('b', 'a'))).toThrow(CanvasCommandError);
  });

  it('切换视频方式时删除不兼容连线并清理 inputOrder', () => {
    let document = doc([media('a'), media('b'), video('v', 'first_last')]);
    document = connect(registry, document, attempt('a', 'v', 'first_frame'));
    document = connect(registry, document, attempt('b', 'v', 'last_frame'));
    const toReference = changeDataDroppingEdges<CanvasMediaData>(
      registry,
      document,
      'v',
      (data) => ({
        ...data,
        mode: 'reference',
      }),
    );
    expect(toReference.dropped).toBe(2);
    expect(toReference.document.edges).toEqual([]);
    expect(
      (toReference.document.nodes.find((node) => node.id === 'v')!.data as CanvasMediaData)
        .inputOrder,
    ).toEqual([]);
    const same = changeDataDroppingEdges<CanvasMediaData>(registry, document, 'v', (data) => data);
    expect(same.dropped).toBe(0);
  });
});

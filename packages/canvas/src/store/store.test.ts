import { describe, expect, it } from 'vitest';
import type { CanvasMediaData } from '@frame-loom/contracts';
import { addNodes, moveNodes, updateData } from '../commands/commands';
import { doc, media } from '../test-utils';
import { createCanvasStore, HISTORY_LIMIT } from './store';

describe('canvas store 历史', () => {
  it('记录、撤销、重做，新操作清空重做栈', () => {
    const store = createCanvasStore(doc([]));
    const state = store.getState();
    state.apply((d) => addNodes(d, [media('a')]));
    state.apply((d) => addNodes(d, [media('b')]));
    expect(store.getState().document.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    state.undo();
    expect(store.getState().document.nodes.map((n) => n.id)).toEqual(['a']);
    state.redo();
    expect(store.getState().document.nodes).toHaveLength(2);
    state.undo();
    state.apply((d) => addNodes(d, [media('c')]));
    expect(store.getState().future).toEqual([]);
  });

  it('拖拽等连续操作合并为一步，未变化不记录', () => {
    const store = createCanvasStore(doc([media('a')]));
    const state = store.getState();
    state.begin();
    for (let x = 1; x <= 5; x++) state.apply((d) => moveNodes(d, new Map([['a', { x, y: 0 }]])));
    state.commit();
    expect(store.getState().past).toHaveLength(1);
    state.apply((d) => d);
    state.begin();
    state.commit();
    expect(store.getState().past).toHaveLength(1);
    state.undo();
    expect(store.getState().document.nodes[0].position).toEqual({ x: 0, y: 0 });
  });

  it('系统写回改写全部快照且不形成历史步骤', () => {
    const store = createCanvasStore(doc([media('a')]));
    const state = store.getState();
    state.apply((d) => moveNodes(d, new Map([['a', { x: 10, y: 0 }]])));
    const write = (d: ReturnType<typeof store.getState>['document']) =>
      updateData<CanvasMediaData>(d, 'a', (data) => ({ ...data, prompt: '生成结果' }));
    state.applySystem(write);
    expect(store.getState().past).toHaveLength(1);
    state.undo();
    // 撤销移动后，系统写回的结果仍在。
    const node = store.getState().document.nodes[0];
    expect(node.position.x).toBe(0);
    expect((node.data as CanvasMediaData).prompt).toBe('生成结果');
  });

  it('历史上限与删除后清理选择', () => {
    const store = createCanvasStore(doc([]));
    const state = store.getState();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) state.apply((d) => addNodes(d, [media(`n${i}`)]));
    expect(store.getState().past).toHaveLength(HISTORY_LIMIT);
    state.select(['n0']);
    state.reset(doc([]));
    expect(store.getState().selectedNodes.size).toBe(0);
    expect(store.getState().past).toEqual([]);
  });

  it('拒绝超过文档字节上限的提交且不污染历史', () => {
    const store = createCanvasStore(doc([media('a')]));
    expect(
      store.getState().apply((document) =>
        updateData<CanvasMediaData>(document, 'a', (data) => ({
          ...data,
          prompt: '画'.repeat(3_000_000),
        })),
      ),
    ).toBe(false);
    expect(store.getState().notice?.text).toContain('8 MiB');
    expect(store.getState().document.nodes[0].data).toMatchObject({ prompt: '' });
    expect(store.getState().past).toEqual([]);
  });
});

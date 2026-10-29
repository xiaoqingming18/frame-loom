import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScriptDocument } from '@frame-loom/contracts';
import { EngineRequestError } from '@/lib/engine-client';
import { createScriptPersistence } from './script-persistence';
const doc = (text: string): ScriptDocument => ({
  schemaVersion: 1,
  blocks: [{ id: 'a', type: 'action', text }],
});
afterEach(() => vi.useRealTimers());
describe('剧本保存', () => {
  it('连续输入只保存一次', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue({ revision: 2, addedElements: 0 });
    const p = createScriptPersistence({ revision: 1, document: doc('') }, save, vi.fn());
    p.change(doc('一'));
    await vi.advanceTimersByTimeAsync(500);
    p.change(doc('二'));
    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(await p.flush()).toBe(true);
  });
  it('保存中输入接续保存，使用新 revision', async () => {
    let resolve!: (value: { revision: number; addedElements: number }) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue({ revision: 3, addedElements: 1 });
    const saved = vi.fn();
    const p = createScriptPersistence({ revision: 1, document: doc('') }, save, saved);
    p.change(doc('一'));
    const pending = p.flush();
    p.change(doc('二'));
    resolve({ revision: 2, addedElements: 0 });
    expect(await pending).toBe(true);
    expect(save).toHaveBeenLastCalledWith(2, doc('二'));
    expect(p.getRevision()).toBe(3);
    expect(saved).toHaveBeenCalledTimes(2);
    p.stop();
  });
  it('冲突停止自动保存，重载恢复；flush 反映失败', async () => {
    vi.useFakeTimers();
    const save = vi
      .fn()
      .mockRejectedValueOnce(
        new EngineRequestError(409, 'SCRIPT_REVISION_CONFLICT', '已被外部修改'),
      )
      .mockResolvedValue({ revision: 4, addedElements: 0 });
    const p = createScriptPersistence({ revision: 1, document: doc('') }, save, vi.fn());
    p.change(doc('一'));
    expect(await p.flush()).toBe(false);
    p.change(doc('二'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(p.getSnapshot().document).toEqual(doc('二'));
    p.reset({ revision: 3, document: doc('三') });
    p.change(doc('四'));
    expect(await p.flush()).toBe(true);
  });
  it('转换冲突保留内容，其他失败可重试', async () => {
    const save = vi
      .fn()
      .mockRejectedValue(new EngineRequestError(409, 'SCRIPT_CONVERTING', '转换中'));
    const p = createScriptPersistence({ revision: 1, document: doc('') }, save, vi.fn());
    p.change(doc('一'));
    expect(await p.flush()).toBe(false);
    expect(p.getSnapshot().status).toBe('converting');
    expect(p.hasPendingChanges()).toBe(true);
    p.stop();
  });
});

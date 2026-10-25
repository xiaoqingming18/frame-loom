import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_VIEW, type CanvasHost } from '@frame-loom/canvas';
import { emptyCanvasDocument, type CanvasRecord } from '@frame-loom/contracts';
import { EngineRequestError } from '@/lib/engine-client';
import { createCanvasPersistence } from './canvas-persistence';

const document = () => ({
  ...emptyCanvasDocument(),
  nodes: [
    {
      id: 'one',
      type: 'image',
      typeVersion: 1,
      position: { x: 10, y: 20 },
      size: { width: 280, height: 180 },
      data: { versions: [], activeVersion: 0, prompt: '第一版', inputOrder: [] },
    },
  ],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(record: CanvasRecord | null = null) {
  const host = {
    load: vi.fn<NonNullable<CanvasHost['documents']>['load']>().mockResolvedValue(record),
    save: vi
      .fn<NonNullable<CanvasHost['documents']>['save']>()
      .mockImplementation((_id, revision) => Promise.resolve({ revision: revision + 1 })),
    saveView: vi.fn<NonNullable<CanvasHost['documents']>['saveView']>().mockResolvedValue(),
  };
  const session = createCanvasPersistence(host, 'lab');
  return { host, session, store: session.store };
}
afterEach(() => vi.useRealTimers());

it('加载后恢复文档与视图，加载失败不变成可编辑空画布，也不自动写入', async () => {
  const record: CanvasRecord = {
    id: 'lab',
    revision: 4,
    document: document(),
    view: { ...DEFAULT_VIEW, minimap: false },
    updatedAt: '2026-10-25T00:00:00Z',
  };
  const { host, session, store } = setup(record);
  host.load.mockRejectedValueOnce(new Error('读取失败'));
  await session.reload();
  expect(session.getSnapshot()).toMatchObject({ ready: false, status: 'error' });
  await session.flush();
  expect(host.save).not.toHaveBeenCalled();
  await session.reload();
  expect(store.getState()).toMatchObject({
    document: record.document,
    view: record.view,
    past: [],
  });
  await session.flush();
  expect(host.save).not.toHaveBeenCalled();
});

it('防抖 1 秒保存，选择与工具不触发请求；离开时 flush 立即保存最新内容', async () => {
  vi.useFakeTimers();
  const { host, session, store } = setup();
  session.start();
  await vi.advanceTimersByTimeAsync(0);
  store.getState().select(['one']);
  store.getState().setTool('hand');
  await vi.advanceTimersByTimeAsync(1500);
  expect(host.save).not.toHaveBeenCalled();
  store.getState().apply(() => document());
  await vi.advanceTimersByTimeAsync(999);
  expect(host.save).not.toHaveBeenCalled();
  store.getState().apply((doc) => ({ ...doc, nodes: [{ ...doc.nodes[0], title: '最新标题' }] }));
  await vi.advanceTimersByTimeAsync(999);
  expect(host.save).not.toHaveBeenCalled();
  expect(await session.flush()).toBe(true);
  expect(host.save).toHaveBeenCalledExactlyOnceWith('lab', 0, store.getState().document);
  expect(session.getSnapshot().status).toBe('saved');
  store.getState().apply((doc) => ({ ...doc, nodes: [{ ...doc.nodes[0], title: '自动保存' }] }));
  await vi.advanceTimersByTimeAsync(1000);
  expect(host.save).toHaveBeenCalledTimes(2);
  expect(host.save).toHaveBeenLastCalledWith('lab', 1, store.getState().document);
  session.stop();
  await vi.advanceTimersByTimeAsync(1000);
  expect(host.save).toHaveBeenCalledTimes(2);
});

it('保存中继续编辑按序使用新 revision 续存，旧响应不能把新编辑标为已保存', async () => {
  const { host, session, store } = setup();
  await session.reload();
  const first = deferred<{ revision: number }>();
  host.save.mockReturnValueOnce(first.promise);
  store.getState().apply(() => document());
  const firstDocument = store.getState().document;
  const pending = session.flush();
  store
    .getState()
    .apply((doc) => ({ ...doc, nodes: [{ ...doc.nodes[0], title: '保存期间编辑' }] }));
  expect(session.flush()).toBe(pending);
  expect(session.getSnapshot().status).toBe('saving');
  expect(host.save).toHaveBeenCalledTimes(1);
  first.resolve({ revision: 1 });
  await pending;
  expect(host.save.mock.calls).toEqual([
    ['lab', 0, firstDocument],
    ['lab', 1, store.getState().document],
  ]);
  expect(session.hasPendingChanges()).toBe(false);
});

it('防抖期间撤销回已保存内容，恢复已保存状态且不发送写入', async () => {
  vi.useFakeTimers();
  const { host, session, store } = setup();
  session.start();
  await vi.advanceTimersByTimeAsync(0);
  store.getState().apply(() => document());
  expect(session.getSnapshot().status).toBe('saving');
  store.getState().undo();
  await vi.advanceTimersByTimeAsync(1000);
  expect(host.save).not.toHaveBeenCalled();
  expect(session.getSnapshot().status).toBe('saved');
  session.stop();
});

it('首次只改视图时先创建文档，后续视图保存不增加文档 revision', async () => {
  const { host, session, store } = setup();
  await session.reload();
  store.getState().setView({ minimap: false });
  await session.flush();
  expect(host.save).toHaveBeenCalledExactlyOnceWith('lab', 0, emptyCanvasDocument());
  expect(host.saveView).toHaveBeenCalledExactlyOnceWith('lab', store.getState().view);
  expect(host.save.mock.invocationCallOrder[0]).toBeLessThan(
    host.saveView.mock.invocationCallOrder[0],
  );
  store.getState().setEdgeDisplay('hidden');
  await session.flush();
  expect(host.save).toHaveBeenCalledTimes(1);
  expect(host.saveView).toHaveBeenCalledTimes(2);
});

it('视图保存失败后重试不重复提交已经成功的文档', async () => {
  const { host, session, store } = setup();
  await session.reload();
  store.getState().apply(() => document());
  store.getState().setView({ minimap: false });
  host.saveView.mockRejectedValueOnce(new Error('暂时断开'));
  expect(await session.flush()).toBe(false);
  expect(session.getSnapshot().status).toBe('error');
  expect(await session.flush()).toBe(true);
  expect(host.save).toHaveBeenCalledTimes(1);
  expect(host.saveView).toHaveBeenCalledTimes(2);
});

it('409 后保留内容、暂停保存；重载失败仍保留，成功才清空历史并恢复 revision', async () => {
  const { host, session, store } = setup();
  await session.reload();
  store.getState().apply(() => document());
  host.save.mockRejectedValueOnce(
    new EngineRequestError(409, 'CANVAS_REVISION_CONFLICT', '其他窗口已修改'),
  );
  expect(await session.flush()).toBe(false);
  store.getState().apply((doc) => ({ ...doc, nodes: [{ ...doc.nodes[0], title: '本地保留' }] }));
  const local = store.getState().document;
  expect(await session.flush()).toBe(false);
  expect(host.save).toHaveBeenCalledTimes(1);
  host.load.mockRejectedValueOnce(new Error('读取失败'));
  await session.reload();
  expect(store.getState().document).toBe(local);
  expect(session.getSnapshot()).toMatchObject({ ready: true, status: 'conflict' });
  host.load.mockResolvedValueOnce({
    id: 'lab',
    revision: 7,
    document: document(),
    view: DEFAULT_VIEW,
    updatedAt: '2026-10-25T00:00:00Z',
  });
  await session.reload();
  expect(store.getState().past).toEqual([]);
  expect(store.getState().future).toEqual([]);
  store.getState().apply(() => emptyCanvasDocument());
  await session.flush();
  expect(host.save).toHaveBeenLastCalledWith('lab', 7, emptyCanvasDocument());
});

it('普通保存失败可按原 revision 重试；退出后忽略过期加载结果', async () => {
  const { host, session, store } = setup();
  await session.reload();
  store.getState().apply(() => document());
  host.save.mockRejectedValueOnce(new Error('网络错误'));
  expect(await session.flush()).toBe(false);
  expect(store.getState().document.nodes).toHaveLength(1);
  expect(await session.flush()).toBe(true);
  expect(host.save.mock.calls.map((call) => call[1])).toEqual([0, 0]);
  const delayed = deferred<CanvasRecord | null>();
  host.load.mockReturnValueOnce(delayed.promise);
  const loading = session.reload();
  session.stop();
  delayed.resolve(null);
  await loading;
  expect(store.getState().document.nodes).toHaveLength(1);
});

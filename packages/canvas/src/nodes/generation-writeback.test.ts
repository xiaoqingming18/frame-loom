import { expect, it } from 'vitest';
import { GenerationJob } from '@frame-loom/contracts';
import { doc, media } from '../test-utils';
import { createCanvasStore } from '../store/store';
import { writeGenerationJob } from './generation-writeback';
import type { CanvasMediaData } from '@frame-loom/contracts';

const id = '11111111-1111-4111-8111-111111111111';
const date = '2026-10-25T00:00:00.000Z';
const job = GenerationJob.parse({
  id,
  kind: 'image',
  channelModelId: '22222222-2222-4222-8222-222222222222',
  profileId: 'openai-images-default',
  status: 'succeeded',
  request: {
    modelId: '22222222-2222-4222-8222-222222222222',
    mode: 'text',
    prompt: '生成画面',
    params: {},
    inputs: [],
    source: 'canvas',
  },
  remoteTaskId: null,
  remoteStatus: null,
  attempts: 0,
  nextPollAt: null,
  errorCategory: null,
  errorCode: null,
  errorMessage: null,
  outputs: [
    {
      sha256: 'a'.repeat(64),
      mime: 'image/png',
      bytes: 12,
      width: 256,
      height: 256,
      durationMs: null,
      createdAt: date,
    },
  ],
  createdAt: date,
  updatedAt: date,
  finishedAt: date,
});

it('成功只写一次为新版本，系统写回在撤销后仍保留', () => {
  const node = media('one');
  node.data = { ...(node.data as object), pendingJobIds: [id] };
  const store = createCanvasStore(doc([node]));
  store.getState().apply((document) => ({
    ...document,
    nodes: document.nodes.map((item) => ({ ...item, position: { x: 1, y: 0 } })),
  }));
  store.getState().applySystem((document) => writeGenerationJob(document, job));
  store.getState().applySystem((document) => writeGenerationJob(document, job));
  store.getState().undo();
  const data = store.getState().document.nodes[0].data as {
    versions: { jobId?: string }[];
    pendingJobIds?: string[];
  };
  expect(data.pendingJobIds).toEqual([]);
  expect(data.versions).toHaveLength(1);
  expect(data.versions[0].jobId).toBe(id);
});

it('多个节点引用同任务时全部写回；提交结果不明保留引用，失败和取消保留旧版本', () => {
  const one = media('one');
  one.data = { ...(one.data as CanvasMediaData), pendingJobIds: [id] };
  const document = doc([one, { ...one, id: 'copy' }]);
  expect(writeGenerationJob(document, { ...job, status: 'submit_unknown', outputs: [] })).toBe(
    document,
  );
  for (const status of ['failed', 'cancelled', 'succeeded'] as const) {
    const nextJob = { ...job, status, outputs: status === 'succeeded' ? job.outputs : [] };
    const next = writeGenerationJob(document, nextJob);
    for (const node of next.nodes) {
      expect((node.data as CanvasMediaData).pendingJobIds).toEqual(status === 'failed' ? [id] : []);
      expect((node.data as CanvasMediaData).versions).toHaveLength(status === 'succeeded' ? 1 : 0);
    }
    expect(writeGenerationJob(next, nextJob)).toBe(next);
  }
});

it('三个任务乱序完成、部分失败与重复事件不覆盖结果，并同步全部历史快照', () => {
  const second = { ...job, id: '22222222-2222-4222-8222-222222222222' };
  const third = {
    ...job,
    id: '33333333-3333-4333-8333-333333333333',
    status: 'failed' as const,
    outputs: [],
  };
  const node = media('one');
  node.data = { ...(node.data as CanvasMediaData), pendingJobIds: [id, second.id, third.id] };
  const store = createCanvasStore(doc([node]));
  store.getState().apply((document) => ({ ...document, nodes: [{ ...node, title: '移动前' }] }));
  store.getState().apply((document) => ({ ...document, nodes: [{ ...node, title: '移动后' }] }));
  store.getState().undo();
  store.getState().begin();
  for (const next of [second, third, job, second])
    store.getState().applySystem((document) => writeGenerationJob(document, next));
  const state = store.getState();
  for (const document of [state.document, ...state.past, ...state.future, state.transaction!]) {
    const data = document.nodes[0].data as CanvasMediaData;
    expect(data.pendingJobIds).toEqual([third.id]);
    expect(data.versions.map((version) => version.jobId)).toEqual([second.id, id]);
  }
});

it('下载失败先写回部分结果，恢复增加其余版本且重复事件不覆盖用户选择', () => {
  const node = media('one');
  node.data = { ...(node.data as CanvasMediaData), pendingJobIds: [id] };
  const partial = { ...job, status: 'download_failed' as const };
  const first = writeGenerationJob(doc([node]), partial);
  expect((first.nodes[0].data as CanvasMediaData).pendingJobIds).toEqual([id]);
  expect((first.nodes[0].data as CanvasMediaData).versions).toHaveLength(1);
  expect(writeGenerationJob(first, partial)).toBe(first);
  const full = writeGenerationJob(first, {
    ...job,
    outputs: [...job.outputs, { ...job.outputs[0], sha256: 'b'.repeat(64) }],
  });
  expect((full.nodes[0].data as CanvasMediaData).pendingJobIds).toEqual([]);
  expect((full.nodes[0].data as CanvasMediaData).versions.map((version) => version.sha256)).toEqual(
    ['a'.repeat(64), 'b'.repeat(64)],
  );
});

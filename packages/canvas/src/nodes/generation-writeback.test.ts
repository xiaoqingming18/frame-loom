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
  node.data = { ...(node.data as object), pendingJobId: id };
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
    pendingJobId?: string;
  };
  expect(data.pendingJobId).toBeUndefined();
  expect(data.versions).toHaveLength(1);
  expect(data.versions[0].jobId).toBe(id);
});

it('多个节点引用同任务时全部写回；提交结果不明保留引用，失败和取消保留旧版本', () => {
  const one = media('one');
  one.data = { ...(one.data as CanvasMediaData), pendingJobId: id };
  const document = doc([one, { ...one, id: 'copy' }]);
  expect(writeGenerationJob(document, { ...job, status: 'submit_unknown' })).toBe(document);
  for (const status of ['failed', 'cancelled', 'succeeded'] as const) {
    const next = writeGenerationJob(document, { ...job, status });
    for (const node of next.nodes) {
      expect((node.data as CanvasMediaData).pendingJobId).toBeUndefined();
      expect((node.data as CanvasMediaData).versions).toHaveLength(status === 'succeeded' ? 1 : 0);
    }
    expect(writeGenerationJob(next, { ...job, status })).toBe(next);
  }
});

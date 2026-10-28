import { expect, it } from 'vitest';
import { CanvasDocument } from '@frame-loom/contracts';
import { documentReferences } from './project-media.service.js';

it('音频版本及待处理任务属于项目引用，保留全部音频元数据', () => {
  const hash = 'a'.repeat(64);
  const jobId = '11111111-1111-4111-8111-111111111111';
  const document = CanvasDocument.parse({
    schemaVersion: 1,
    nodes: [
      {
        id: 'audio',
        type: 'audio',
        typeVersion: 1,
        position: { x: 0, y: 0 },
        size: { width: 320, height: 160 },
        data: {
          versions: [
            {
              sha256: hash,
              mime: 'audio/wav',
              bytes: 48044,
              width: null,
              height: null,
              durationMs: 1000,
              sampleRate: 24000,
              channels: 1,
              codec: 'pcm_s16le',
              createdAt: '2026-10-29T00:00:00Z',
            },
          ],
          activeVersion: 0,
          prompt: '文本',
          inputOrder: [],
          pendingJobIds: [jobId],
        },
      },
    ],
    edges: [],
  });
  expect(documentReferences(document)).toEqual({ hashes: new Set([hash]), jobs: new Set([jobId]) });
});

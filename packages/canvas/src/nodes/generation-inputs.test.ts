import { expect, it } from 'vitest';
import { emptyCanvasDocument, type CanvasDocument } from '@frame-loom/contracts';
import { generationInputs } from './generation-inputs';

it('按节点输入顺序映射当前版本和目标端口角色', () => {
  const document: CanvasDocument = {
    ...emptyCanvasDocument(),
    nodes: [
      {
        id: 'image1',
        type: 'image',
        typeVersion: 1,
        position: { x: 0, y: 0 },
        size: { width: 10, height: 10 },
        data: {
          versions: [
            {
              sha256: 'a'.repeat(64),
              mime: 'image/png',
              width: 1,
              height: 1,
              createdAt: '2026-10-25T00:00:00.000Z',
            },
          ],
          activeVersion: 0,
          prompt: '',
          inputOrder: [],
        },
      },
      {
        id: 'image2',
        type: 'image',
        typeVersion: 1,
        position: { x: 0, y: 0 },
        size: { width: 10, height: 10 },
        data: {
          versions: [
            {
              sha256: 'b'.repeat(64),
              mime: 'image/png',
              width: 1,
              height: 1,
              createdAt: '2026-10-25T00:00:00.000Z',
            },
          ],
          activeVersion: 0,
          prompt: '',
          inputOrder: [],
        },
      },
      {
        id: 'video1',
        type: 'video',
        typeVersion: 1,
        position: { x: 0, y: 0 },
        size: { width: 10, height: 10 },
        data: {
          versions: [],
          activeVersion: 0,
          prompt: '',
          mode: 'frames',
          inputOrder: ['edge2', 'edge1'],
        },
      },
    ],
    edges: [
      {
        id: 'edge1',
        source: 'image1',
        target: 'video1',
        sourceHandle: 'out',
        targetHandle: 'first_frame',
      },
      {
        id: 'edge2',
        source: 'image2',
        target: 'video1',
        sourceHandle: 'out',
        targetHandle: 'last_frame',
      },
    ],
  };
  expect(generationInputs(document, 'video1')).toEqual([
    { kind: 'image', role: 'last_frame', sha256: 'b'.repeat(64) },
    { kind: 'image', role: 'first_frame', sha256: 'a'.repeat(64) },
  ]);
});

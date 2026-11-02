import { expect, it } from 'vitest';
import { ImportBoundaryBatch, ImportSceneBatch } from './script-import-protocol.js';

it('定位协议拒绝漏区间、重叠、越界和无效续场', () => {
  const batch = {
    batchId: 'b1',
    responsible: { start: 2, end: 4 },
    context: { start: 1, end: 5 },
    parts: [
      { range: { start: 2, end: 4 }, kind: 'scene', sceneKey: 2, continuation: false, reason: '' },
    ],
  };
  expect(ImportBoundaryBatch.parse(batch)).toEqual(batch);
  for (const parts of [
    [{ ...batch.parts[0], range: { start: 3, end: 4 } }],
    [...batch.parts, ...batch.parts],
    [{ ...batch.parts[0], range: { start: 2, end: 5 } }],
    [{ ...batch.parts[0], sceneKey: 0 }],
    [{ ...batch.parts[0], kind: 'meta', continuation: true, sceneKey: null }],
  ])
    expect(ImportBoundaryBatch.safeParse({ ...batch, parts }).success).toBe(false);
  expect(ImportBoundaryBatch.safeParse({ ...batch, context: { start: 3, end: 4 } }).success).toBe(
    false,
  );
});
it('解析片段不能输出第三类型或内部 ID', () => {
  const batch = {
    batchId: 's1',
    responsible: { start: 0, end: 1 },
    sceneKey: 0,
    continuation: false,
    scene: {
      location: '',
      time_of_day: '夜',
      interior: true,
      characters: [],
      atmosphere: '',
      beats: [],
    },
    mappings: [],
  };
  expect(ImportSceneBatch.parse(batch)).toEqual(batch);
  expect(
    ImportSceneBatch.safeParse({ ...batch, scene: { ...batch.scene, id: crypto.randomUUID() } })
      .success,
  ).toBe(false);
  expect(
    ImportSceneBatch.safeParse({
      ...batch,
      scene: { ...batch.scene, beats: [{ type: 'sound', content: '风声' }] },
    }).success,
  ).toBe(false);
});

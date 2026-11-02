import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ScriptDocument, type ImportSceneBatch } from '@frame-loom/contracts';
import { sourceUnits, partitionSource, validateSource } from './script-source-validation.js';
const units = sourceUnits('△ 不要开门。\n林夏（低声）：别动！');
const batch: ImportSceneBatch = {
  batchId: 'b',
  responsible: { start: 0, end: 2 },
  sceneKey: 0,
  continuation: false,
  scene: {
    location: '',
    time_of_day: '夜',
    interior: true,
    characters: ['林夏'],
    atmosphere: '',
    beats: [
      { type: 'action', content: '不要开门。' },
      { type: 'dialogue', speaker: '林夏', emotion: '低声', line: '别动！' },
    ],
  },
  mappings: [
    { unit: 0, start: 2, end: 7, path: 'beats.0.content' },
    { unit: 1, start: 0, end: 2, path: 'beats.1.speaker' },
    { unit: 1, start: 3, end: 5, path: 'beats.1.emotion' },
    { unit: 1, start: 7, end: 10, path: 'beats.1.line' },
  ],
};
it('M07 逐字段校验原文，否定词、标点、漏句、补写和未知位置拒绝', () => {
  expect(() => validateSource(batch, units)).not.toThrow();
  for (const content of ['要开门。', '不要开门！', '不要开门。后来他跑了。']) {
    const changed = structuredClone(batch);
    changed.scene.beats[0] = { type: 'action', content };
    expect(() => validateSource(changed, units)).toThrow();
  }
  expect(() => validateSource({ ...batch, mappings: batch.mappings.slice(1) }, units)).toThrow();
  expect(() =>
    validateSource(
      { ...batch, mappings: [...batch.mappings, { unit: 9, start: 0, end: 1, path: 'location' }] },
      units,
    ),
  ).toThrow();
});
it('M03 容量边界完整分片、非零起始编号，不截断超大单行', () => {
  const source = sourceUnits('甲\n乙\n丙\n丁');
  const bytes = Buffer.byteLength(JSON.stringify(source[0]));
  expect(partitionSource(source, bytes * 2)).toEqual([
    { start: 0, end: 2 },
    { start: 2, end: 4 },
  ]);
  expect(partitionSource(source.slice(2), bytes * 2)).toEqual([{ start: 2, end: 4 }]);
  expect(() => partitionSource(source, bytes - 1)).toThrow('超出最小片段容量');
});
it('M07 来源重复、乱序、标题吞正文、只漏标点均拒绝', () => {
  const duplicate = structuredClone(batch);
  duplicate.scene.beats.push({ type: 'action', content: '不要开门。' });
  duplicate.mappings.push({ unit: 0, start: 2, end: 7, path: 'beats.2.content' });
  expect(() => validateSource(duplicate, units)).toThrow('重复');
  const reversed = structuredClone(batch);
  reversed.scene.beats.reverse();
  reversed.mappings = reversed.mappings.map((mapping) => ({
    ...mapping,
    path: mapping.path.replace(
      /^beats\.(\d+)/u,
      (_, index: string) => `beats.${1 - Number(index)}`,
    ),
  }));
  expect(() => validateSource(reversed, units)).toThrow('乱序');
  expect(() =>
    validateSource(
      { ...batch, responsible: { start: 0, end: 3 } },
      sourceUnits('△ 不要开门。\n林夏（低声）：别动！\n# 他没有回答。'),
    ),
  ).toThrow('遗漏');
  const punctuation = structuredClone(batch);
  punctuation.scene.beats[0] = { type: 'action', content: '不要开门' };
  punctuation.mappings[0].end = 6;
  expect(() => validateSource(punctuation, units)).toThrow('遗漏');
});
it('M05 跨批对白仅继承已验证的人物情绪，多行台词保持换行', () => {
  const source = sourceUnits('林夏（低声）：\n不要开门。\n请等一等。');
  const partial: ImportSceneBatch = {
    ...batch,
    responsible: { start: 0, end: 1 },
    scene: {
      ...batch.scene,
      beats: [{ type: 'dialogue', speaker: '林夏', emotion: '低声', line: '' }],
    },
    mappings: [
      { unit: 0, start: 0, end: 2, path: 'beats.0.speaker' },
      { unit: 0, start: 3, end: 5, path: 'beats.0.emotion' },
    ],
  };
  expect(() => validateSource(partial, source)).not.toThrow();
  const next: ImportSceneBatch = {
    ...partial,
    continuation: true,
    firstBeatContinuation: true,
    responsible: { start: 1, end: 3 },
    scene: {
      ...partial.scene,
      beats: [
        { type: 'dialogue', speaker: '林夏', emotion: '低声', line: '不要开门。\n请等一等。' },
      ],
    },
    mappings: [
      { unit: 1, start: 0, end: 5, path: 'beats.0.line' },
      { unit: 2, start: 0, end: 5, path: 'beats.0.line' },
    ],
  };
  expect(() =>
    validateSource(next, source, {
      location: '',
      atmosphere: '',
      lastBeat: partial.scene.beats[0],
    }),
  ).not.toThrow();
  expect(() => validateSource(next, source)).toThrow('缺少字段来源');
});
it('M02 人工短样例的元信息、重复台词、动作独有人物逐段覆盖', () => {
  const input = sourceUnits(
    readFileSync(
      new URL(
        '../../../../../packages/contracts/fixtures/standard-script-short.md',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const expected = ScriptDocument.parse(
    JSON.parse(
      readFileSync(
        new URL(
          '../../../../../packages/contracts/fixtures/standard-script-short.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ),
  );
  expect(() =>
    validateSource(
      {
        batchId: 'meta',
        responsible: { start: 0, end: 4 },
        source_authority: { series: '夜班便利店', episode: '第1集', title: '陌生来客' },
        core_conflict: expected.meta.core_conflict,
        hook_start: expected.meta.hook_start,
        hook_end: '',
        mappings: [
          { unit: 0, start: 2, end: 7, path: 'source_authority.series' },
          { unit: 0, start: 8, end: 11, path: 'source_authority.episode' },
          { unit: 0, start: 12, end: 16, path: 'source_authority.title' },
          { unit: 2, start: 5, end: 17, path: 'core_conflict' },
          { unit: 3, start: 5, end: 14, path: 'hook_start' },
        ],
      },
      input,
    ),
  ).not.toThrow();
  const { scene_id: firstNumber, ...first } = expected.scenes[0];
  void firstNumber;
  expect(() =>
    validateSource(
      {
        batchId: 'first',
        responsible: { start: 4, end: 12 },
        sceneKey: 5,
        continuation: false,
        scene: first,
        mappings: [
          { unit: 5, start: 3, end: 6, path: 'location' },
          { unit: 7, start: 3, end: 5, path: 'characters.0' },
          { unit: 8, start: 3, end: 10, path: 'atmosphere' },
          { unit: 9, start: 2, end: 16, path: 'beats.0.content' },
          { unit: 10, start: 0, end: 3, path: 'beats.1.speaker' },
          { unit: 10, start: 4, end: 9, path: 'beats.1.line' },
          { unit: 11, start: 0, end: 2, path: 'beats.2.speaker' },
          { unit: 11, start: 3, end: 5, path: 'beats.2.emotion' },
          { unit: 11, start: 7, end: 12, path: 'beats.2.line' },
        ],
      },
      input,
    ),
  ).not.toThrow();
  const { scene_id: secondNumber, ...second } = expected.scenes[1];
  void secondNumber;
  expect(() =>
    validateSource(
      {
        batchId: 'second',
        responsible: { start: 12, end: 18 },
        sceneKey: 13,
        continuation: false,
        scene: second,
        mappings: [
          { unit: 13, start: 3, end: 6, path: 'location' },
          { unit: 15, start: 3, end: 5, path: 'characters.0' },
          { unit: 16, start: 3, end: 7, path: 'atmosphere' },
          { unit: 17, start: 2, end: 10, path: 'beats.0.content' },
        ],
      },
      input,
    ),
  ).not.toThrow();
  expect(() =>
    validateSource(
      {
        batchId: 'end',
        responsible: { start: 18, end: 19 },
        core_conflict: '',
        hook_start: '',
        hook_end: expected.meta.hook_end,
        mappings: [{ unit: 18, start: 5, end: 17, path: 'hook_end' }],
      },
      input,
    ),
  ).not.toThrow();
});

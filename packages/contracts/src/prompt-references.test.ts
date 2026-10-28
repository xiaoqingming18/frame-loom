import { expect, it } from 'vitest';
import { parsePromptReferences, resolvePromptReferences } from './prompt-references.js';

const inputs = [
  { id: 'a', kind: 'image' },
  { id: 'b', kind: 'video' },
  { id: 'c', kind: 'audio' },
  { id: 'd', kind: 'image' },
] as const;
it('引用按素材类别计数，中英文与编号起点独立', () => {
  expect(parsePromptReferences('x @{a}')).toEqual([{ nodeId: 'a', start: 2, end: 6 }]);
  expect(resolvePromptReferences('参考 @{a} @{b} @{c} @{d}', inputs, 'ordinal', 1).prompt).toBe(
    '参考 图1 视频1 音频1 图2',
  );
  expect(resolvePromptReferences('@{a} @{b} @{c}', inputs, 'ordinal', 0).prompt).toBe(
    'Image 0 Video 0 Audio 0',
  );
  expect(resolvePromptReferences('@{a} @{b} @{c} @{d}', inputs, '@image_n', 1).prompt).toBe(
    '@image_1 @video_1 @audio_1 @image_2',
  );
  expect(resolvePromptReferences('@{a} @{b} @{c}', inputs, '<IMAGE_n>', 0).prompt).toBe(
    '<IMAGE_0> <VIDEO_0> <AUDIO_0>',
  );
  expect(resolvePromptReferences('@{missing} @{missing}', inputs, 'ordinal', 1)).toEqual({
    prompt: '@{missing} @{missing}',
    missingNodeIds: ['missing'],
  });
});

import { describe, expect, it } from 'vitest';
import { parseImageReferences, resolveImagePrompt } from './index.js';

describe('图片参考标记', () => {
  it('解析合法字符与 UTF-16 位置，忽略不合法标记', () => {
    expect(parseImageReferences('😀@{node-1} @{a_b} @{a.b} @{}')).toEqual([
      { nodeId: 'node-1', start: 2, end: 11 },
      { nodeId: 'a_b', start: 12, end: 18 },
    ]);
  });
  it('按已排序的 inputs 编号，同一节点多次引用一致，未引用输入也占编号', () => {
    expect(resolveImagePrompt('Use @{b} and @{a}, then @{b}', ['unmentioned', 'a', 'b'])).toEqual({
      prompt: 'Use Image 3 and Image 2, then Image 3',
      missingNodeIds: [],
    });
    expect(resolveImagePrompt('Use @{b}', ['b', 'a']).prompt).toBe('Use Image 1');
  });
  it.each(['参考', '𠀀'])('替换前含汉字 %s 时使用图N', (text) => {
    expect(resolveImagePrompt(`${text} @{a}`, ['a']).prompt).toBe(`${text} 图1`);
  });
  it('日文假名、标点与 emoji 不当作汉字', () => {
    expect(resolveImagePrompt('かな，😀 @{a}', ['a']).prompt).toBe('かな，😀 Image 1');
  });
  it('失效引用去重并保留原文，合法引用仍替换', () => {
    expect(resolveImagePrompt('@{gone} @{ok} @{gone} @{missing}', ['ok'])).toEqual({
      prompt: '@{gone} Image 1 @{gone} @{missing}',
      missingNodeIds: ['gone', 'missing'],
    });
  });
  it.each(['', '普通提示词', 'plain prompt', '@{invalid.id}'])(
    '无合法引用原样返回：%s',
    (prompt) => {
      expect(resolveImagePrompt(prompt, [])).toEqual({ prompt, missingNodeIds: [] });
    },
  );
});

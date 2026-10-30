import { expect, it } from 'vitest';
import sample1 from '../fixtures/script-sample-01.txt?raw';
import sample2 from '../fixtures/script-sample-02.txt?raw';
import { ScriptDocument } from './scripts.js';
import { parseScriptText } from './script-parse.js';
import { applyMarkdownEdit, renderScriptMarkdown } from './script-markdown.js';
const documentOf = (text: string) => {
  const parsed = parseScriptText(text);
  return ScriptDocument.parse({
    schemaVersion: 2,
    preface: parsed.preface,
    appendix: parsed.appendix,
    blocks: parsed.blocks,
  });
};
const content = (doc: ScriptDocument) => ({
  preface: doc.preface,
  appendix: doc.appendix,
  blocks: doc.blocks.map((block) => ({
    type: block.type,
    text: block.text,
    ...(block.attrs ? { attrs: block.attrs } : {}),
  })),
});
const withoutSource = (doc: ScriptDocument) => ({
  ...doc,
  blocks: doc.blocks.map((block) => {
    const result = { ...block };
    delete result.src;
    return result;
  }),
});
it.each([sample1, sample2])('样例渲染、解析和编辑无损往返', (sample) => {
  const doc = documentOf(sample);
  const markdown = renderScriptMarkdown(doc);
  expect(content(documentOf(markdown.text))).toEqual(content(doc));
  expect(applyMarkdownEdit(doc, markdown.text, markdown.text).document).toEqual(withoutSource(doc));
  expect(markdown.text.endsWith('\n')).toBe(true);
  expect(markdown.lineBlocks).toHaveLength(markdown.text.split('\n').length);
  for (const block of doc.blocks)
    expect(markdown.lineBlocks.filter((id) => id === block.id)).toHaveLength(1);
  const dialogue = doc.blocks.find((block) => block.type === 'dialogue')!;
  const changed = markdown.text.replace(dialogue.text, '修改后的台词');
  const result = applyMarkdownEdit(doc, markdown.text, changed).document;
  expect(result.blocks.find((block) => block.id === dialogue.id)?.text).toBe('修改后的台词');
  expect(result.blocks.filter((block) => block.id !== dialogue.id)).toEqual(
    withoutSource(doc).blocks.filter((block) => block.id !== dialogue.id),
  );
  const second = markdown.text.indexOf('**2.');
  const inserted =
    markdown.text.slice(0, second) +
    '**2. 外景　新场地 — 夜**\n\n新动作。\n\n---\n\n' +
    markdown.text.slice(second);
  const added = applyMarkdownEdit(doc, markdown.text, inserted).document;
  expect(added.blocks.filter((block) => doc.blocks.some((old) => old.id === block.id))).toEqual(
    withoutSource(doc).blocks,
  );
  expect(
    added.blocks.find((block) => block.type === 'scene' && block.text === '新场地'),
  ).toBeTruthy();
  expect(renderScriptMarkdown(added).text).toContain('**3.');
});
it('区域标记、对白组和分隔格式固定', () => {
  const doc = documentOf(
    '说明\n1-1 夜 内 书房\n影娘（画外）：你好\n（停顿）\n\n2-1 日 外 门口\n字幕：再见\n### 附录\n说明',
  );
  expect(renderScriptMarkdown(doc).text).toBe(
    '说明\n\n<!-- 正文 -->\n\n**1. 内景　书房 — 夜**\n\n**影娘**（画外）\n你好\n（停顿）\n\n---\n\n**2. 外景　门口 — 日**\n\n字幕：再见\n\n<!-- 附录 -->\n\n### 附录\n说明\n',
  );
});
it('修改角色属性沿用 id，未知对白存疑，删除组保持其他 id', () => {
  const doc = documentOf(sample2);
  const md = renderScriptMarkdown(doc).text;
  const character = doc.blocks.find(
    (block) =>
      block.type === 'character' &&
      block.text === '影娘' &&
      !(block.attrs && 'extension' in block.attrs && block.attrs.extension),
  )!;
  const result = applyMarkdownEdit(doc, md, md.replace('**影娘**\n', '**影娘**（画外）\n'));
  expect(result.document.blocks.find((block) => block.id === character.id)?.attrs).toEqual({
    delivery: 'os',
    extension: '画外',
  });
  const unknown = applyMarkdownEdit(
    doc,
    md,
    md.replace('<!-- 附录 -->', '影娘 你好\n\n<!-- 附录 -->'),
  );
  expect(unknown.document.blocks.find((block) => block.text === '影娘 你好')?.review).toBeTruthy();
  const removed = applyMarkdownEdit(doc, md, md.replace('**孩童们**\n卢木头——卢木头——\n\n', ''));
  expect(removed.document.blocks).toEqual(
    withoutSource(doc).blocks.filter(
      (block) => block.text !== '孩童们' && block.text !== '卢木头——卢木头——',
    ),
  );
});
it('自动保存后保留原文本行映射，超过段落上限拒绝回写', () => {
  const doc = documentOf(sample2);
  const md = renderScriptMarkdown(doc).text;
  const firstText = md.replace('我不是妖怪。', '我不是妖怪呀。');
  const first = applyMarkdownEdit(doc, md, firstText).document;
  const second = applyMarkdownEdit(
    first,
    firstText,
    firstText.replace('我不是妖怪呀。', '我真的不是妖怪。'),
  ).document;
  expect(second.blocks.map((block) => block.id)).toEqual(first.blocks.map((block) => block.id));
  expect(() =>
    applyMarkdownEdit(documentOf(''), '', Array(5001).fill('动作。').join('\n')),
  ).toThrow();
});
it('连续保存沿用一行拆出的全部角色和对白段落', () => {
  const doc = documentOf('1-1 日 内 书房\n动作。');
  const md = renderScriptMarkdown(doc).text;
  const text = md + '\n影娘：你好\n';
  const first = applyMarkdownEdit(doc, md, text).document;
  const second = applyMarkdownEdit(first, text, text.replace('动作。', '新动作。')).document;
  expect(second.blocks.slice(-2)).toEqual(first.blocks.slice(-2));
  expect(second.blocks.slice(-2).map((block) => block.type)).toEqual(['character', 'dialogue']);
});

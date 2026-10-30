import {
  ScriptDocument,
  type ScriptBlock,
  type CharacterAttrs,
  type TagAttrs,
  type SceneAttrs,
} from './scripts.js';
import { parseScriptText, sceneText } from './script-parse.js';

export function renderScriptMarkdown(document: ScriptDocument): {
  text: string;
  lineBlocks: (string | null)[];
} {
  const lines: string[] = [];
  const lineBlocks: (string | null)[] = [];
  const add = (text: string, id: string | null = null) => {
    for (const line of text.split('\n')) {
      lines.push(line);
      lineBlocks.push(id);
    }
  };
  if (document.preface) {
    add(document.preface);
    add('');
  }
  add('<!-- 正文 -->');
  add('');
  let sceneNumber = 0;
  for (const [index, block] of document.blocks.entries()) {
    if (index) {
      const previous = document.blocks[index - 1];
      if (block.type === 'scene' || block.type === 'act') {
        add('');
        add('---');
        add('');
      } else if (!(
        ['character', 'parenthetical', 'dialogue'].includes(previous.type) &&
        ['parenthetical', 'dialogue'].includes(block.type)
      ))
        add('');
    }
    let text = block.text;
    switch (block.type) {
      case 'act':
        text = `## ${text}`;
        break;
      case 'scene': {
        const attrs = block.attrs as SceneAttrs;
        text =
          `**${++sceneNumber}. ${sceneText(block)}**` +
          (attrs.timecode ? `　\`${attrs.timecode}\`` : '');
        break;
      }
      case 'cast':
        text = `人物：${text}`;
        break;
      case 'character': {
        const attrs = block.attrs as CharacterAttrs;
        text = `**${text}**` + (attrs.extension ? `（${attrs.extension}）` : '');
        break;
      }
      case 'parenthetical':
        text = `（${text}）`;
        break;
      case 'sound':
      case 'production':
        text = `【${(block.attrs as TagAttrs).label}】${text}`;
        break;
      case 'text':
        text = `字幕：${text}`;
        break;
      case 'note':
        text = `> ${text}`;
        break;
    }
    add(text, block.id);
  }
  if (document.appendix) {
    add('');
    add('<!-- 附录 -->');
    add('');
    add(document.appendix);
  }
  if (lines.at(-1) !== '') add('');
  return { text: lines.join('\n'), lineBlocks };
}
const lineKey = (text: string) => text.replace(/^\*\*\d+\.\s*/u, '**');
function matchLines(oldLines: string[], newLines: string[]): [number, number][] {
  // shortcut: 朴素 LCS，单集超过 5000 行时改用 Myers diff
  const width = newLines.length + 1;
  const lcs = new Uint32Array((oldLines.length + 1) * width);
  for (let i = oldLines.length - 1; i >= 0; i--)
    for (let j = newLines.length - 1; j >= 0; j--)
      lcs[i * width + j] =
        lineKey(oldLines[i]) === lineKey(newLines[j])
          ? 1 + lcs[(i + 1) * width + j + 1]
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
  const matches: [number, number][] = [[-1, -1]];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (lineKey(oldLines[i]) === lineKey(newLines[j])) matches.push([i++, j++]);
    else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) i++;
    else j++;
  }
  matches.push([oldLines.length, newLines.length]);
  return matches;
}
function mapOldLines(document: ScriptDocument, text: string): ScriptBlock[][] {
  const rendered = renderScriptMarkdown(document);
  const byId = new Map(document.blocks.map((block) => [block.id, block]));
  if (rendered.text === text) {
    return rendered.lineBlocks.map((id) => (id ? [byId.get(id)!] : []));
  }
  // 先匹配规范化后仍相同的行，避免手工纠正过的类型被重新解析后错位。
  const parsed = parseScriptText(text);
  const byLine: ScriptBlock[][] = [];
  const matches = matchLines(rendered.text.split('\n'), text.split('\n'));
  for (let k = 1; k < matches.length; k++) {
    const [oldIndex, newIndex] = matches[k];
    const [oldStart, newStart] = matches[k - 1];
    const id = rendered.lineBlocks[oldIndex];
    if (id) byLine[newIndex] = [byId.get(id)!];
    const blocks = rendered.lineBlocks
      .slice(oldStart + 1, oldIndex)
      .flatMap((id) => (id ? [byId.get(id)!] : []));
    let offset = 0;
    for (const block of parsed.blocks) {
      const line = block.src!.line;
      if (line > newStart && line < newIndex && offset < blocks.length)
        (byLine[line] ??= []).push(blocks[offset++]);
    }
  }
  return byLine;
}
export function applyMarkdownEdit(
  oldDoc: ScriptDocument,
  oldText: string,
  newText: string,
  newId: () => string = () => crypto.randomUUID(),
) {
  const parsed = parseScriptText(newText, newId);
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const previous = mapOldLines(oldDoc, oldText);
  const byLine = new Map<number, ScriptBlock[]>();
  for (const block of parsed.blocks) {
    const line = block.src!.line;
    byLine.set(line, [...(byLine.get(line) ?? []), block]);
  }
  const matches = matchLines(oldLines, newLines);
  for (let k = 1; k < matches.length; k++) {
    const [oldIndex, newIndex] = matches[k];
    const [oldStart, newStart] = matches[k - 1];
    if (previous[oldIndex]?.length) byLine.set(newIndex, previous[oldIndex]);
    if (oldIndex - oldStart === newIndex - newStart)
      for (let offset = 1; offset < oldIndex - oldStart; offset++) {
        const oldBlock = previous[oldStart + offset];
        const current = byLine.get(newStart + offset);
        if (oldBlock?.length === 1 && current?.length === 1) {
          const block = { ...current[0] };
          delete block.review;
          byLine.set(newStart + offset, [{ ...block, id: oldBlock[0].id }]);
        }
      }
  }
  const blocks = [...byLine.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([, blocks]) => blocks)
    .map((block) => {
      const result = { ...block };
      delete result.src;
      return result;
    });
  const document = ScriptDocument.parse({
    schemaVersion: 2,
    preface: parsed.preface,
    appendix: parsed.appendix,
    blocks,
  });
  return {
    document,
    unsure: [...byLine.entries()]
      .filter(([, blocks]) => blocks.some((block) => block.review))
      .map(([line]) => line),
  };
}

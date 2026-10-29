import type {
  CharacterAttrs,
  ElementKind,
  ReviewOption,
  SceneAttrs,
  ScriptBlock,
} from './scripts.js';

const numeral = '[0-9一二三四五六七八九十百]+';
const episodeHeading = new RegExp(`^第\\s*${numeral}\\s*集`, 'u');
const scenePrefix = new RegExp(
  `^(?:\\d+[-－—.]\\d+|第\\s*${numeral}\\s*场|(?:场景|场)\\s*${numeral}[:：]?|INT\\./EXT\\.?|INT\\.?|EXT\\.?)`,
  'iu',
);
const timeWords: Record<string, SceneAttrs['time']> = {
  日: 'day',
  白天: 'day',
  夜: 'night',
  夜晚: 'night',
  晨: 'dawn',
  清晨: 'dawn',
  昏: 'dusk',
  黄昏: 'dusk',
  傍晚: 'dusk',
};
const spaceWords: Record<string, SceneAttrs['space']> = { 内: 'int', 外: 'ext', 内外: 'intext' };

export function parseSceneHeading(
  line: string,
): (SceneAttrs & { location: string; confident: boolean }) | null {
  const text = line.trim();
  const prefix =
    text.match(scenePrefix)?.[0] ??
    text.match(/^\d+[.、](?=\s*(?:日|白天|夜|夜晚|晨|清晨|昏|黄昏|傍晚|内|外))/u)?.[0];
  if (!prefix) return null;
  let time: SceneAttrs['time'] = null;
  let space: SceneAttrs['space'] = /^INT\.\/EXT/iu.test(prefix)
    ? 'intext'
    : /^INT/iu.test(prefix)
      ? 'int'
      : /^EXT/iu.test(prefix)
        ? 'ext'
        : null;
  const location: string[] = [];
  for (const word of text
    .slice(prefix.length)
    .replace(/^[:：]\s*/u, '')
    .split(/\s+/u)) {
    if (word in timeWords) time = timeWords[word];
    else if (word in spaceWords) space = spaceWords[word];
    else if (word && word !== '-') location.push(word);
  }
  return { time, space, location: location.join(' '), confident: time !== null || space !== null };
}

export function parseCharacter(text: string): {
  name: string;
  delivery: CharacterAttrs['delivery'];
} {
  const match = text.match(/^(.*?)\s*[（(](OS|VO|画外音|旁白|内心)[）)]$/iu);
  const suffix = match?.[2].toLowerCase();
  return {
    name: (match?.[1] ?? text).trim(),
    delivery:
      suffix === 'os' || suffix === '画外音'
        ? 'os'
        : suffix === 'vo' || suffix === '旁白'
          ? 'vo'
          : suffix === '内心'
            ? 'inner'
            : null,
  };
}

export function parseScriptText(
  text: string,
  newId: () => string = () => crypto.randomUUID(),
): { blocks: ScriptBlock[]; coveredLines: number[]; unsure: number[] } {
  const lines = text.split(/\r\n?|\n/u);
  const blocks: ScriptBlock[] = [];
  const coveredLines: number[] = [];
  const unsure: number[] = [];
  let cast = new Set<string>();
  const speakers = new Set<string>();
  let markedActions = false;
  function add(
    type: ScriptBlock['type'],
    value: string,
    line: number,
    extra: Partial<ScriptBlock> = {},
  ) {
    blocks.push({ id: newId(), type, text: value, src: { line }, ...extra });
  }
  function review(
    type: ScriptBlock['type'],
    value: string,
    line: number,
    reason: string,
    options: ReviewOption[],
  ) {
    unsure.push(line);
    add(type, value, line, { review: { reason, options } });
  }
  for (let line = 0; line < lines.length; line++) {
    const value = lines[line].trim();
    if (!value) continue;
    coveredLines.push(line);
    if (episodeHeading.test(value)) continue;
    if (/^(?:第[0-9一二三四五六七八九十]+幕|ACT\s+\S+)/iu.test(value)) {
      add('act', value, line);
      cast = new Set();
      markedActions = false;
      continue;
    }
    const heading = parseSceneHeading(value);
    if (heading) {
      cast = new Set();
      markedActions = false;
      for (let next = line + 1; next < lines.length; next++) {
        if (
          parseSceneHeading(lines[next]) ||
          /^(?:第[0-9一二三四五六七八九十]+幕|ACT\s+\S+)/iu.test(lines[next].trim())
        )
          break;
        if (/^[△▲※]/u.test(lines[next].trim())) markedActions = true;
      }
      const { time, space, location } = heading;
      add('scene', location, line, {
        attrs: { time, space },
        ...(!heading.confident
          ? {
              review: {
                reason: '场标题缺少时间或内外标记',
                options: [{ type: 'scene' }, { type: 'action', text: value }],
              },
            }
          : {}),
      });
      if (!heading.confident) unsure.push(line);
      continue;
    }
    const castMatch = value.match(/^(?:人物|出场人物|角色)[:：](.*)$/u);
    if (castMatch) {
      cast = new Set(castMatch[1].split(/[、，,/／\s]+/u).filter(Boolean));
      add('cast', castMatch[1].trim(), line);
      continue;
    }
    if (/^[△▲※]/u.test(value)) {
      add('action', value.slice(1).trim(), line);
      continue;
    }
    const sound = value.match(/^(?:【(?:音效|音乐|BGM|音)】|\[(?:音效|SFX)\])(.*)$/iu);
    if (sound) {
      add('sound', sound[1].trim(), line);
      continue;
    }
    const subtitle = value.match(/^(?:字幕|画面字幕|屏幕文字|黑屏字幕)[:：](.*)$/u);
    if (subtitle) {
      add('text', subtitle[1].trim(), line);
      continue;
    }
    if (/^(?:切至|切到|叠化|淡入|淡出|转场|CUT TO|FADE IN|FADE OUT)/iu.test(value)) {
      add('transition', value, line);
      continue;
    }
    if (/^[（(](?:闪回|回忆|切至|切到|叠化|淡入|淡出|转场)[）)]$/u.test(value)) {
      review('transition', value, line, '括号中的内容可能是转场或动作', [
        { type: 'transition' },
        { type: 'action' },
        { type: 'note' },
      ]);
      continue;
    }
    const dialogue = value.match(/^([^\s:：（）()]{1,12})([（(][^）)]*[）)])?[:：](.*)$/u);
    if (dialogue && !['时间', '地点', '人物', '字幕', '备注', '注'].includes(dialogue[1])) {
      const { name, delivery } = parseCharacter(dialogue[1] + (dialogue[2] ?? ''));
      if (name.length > 4 && !cast.has(name) && !speakers.has(name)) {
        review('action', value, line, '说话人尚未出现，可能是动作', [
          { type: 'dialogue', character: name, text: dialogue[3].trim() },
          { type: 'action' },
        ]);
      } else {
        speakers.add(name);
        add('character', name, line, { attrs: { delivery } });
        const parenthetical = dialogue[3].trim().match(/^[（(]([^）)]*)[）)](.*)$/u);
        if (parenthetical) add('parenthetical', parenthetical[1], line);
        add('dialogue', (parenthetical?.[2] ?? dialogue[3]).trim(), line);
      }
      continue;
    }
    const parenthetical = value.match(/^[（(]([^）)]*)[）)]$/u);
    if (parenthetical && ['character', 'dialogue'].includes(blocks.at(-1)?.type ?? '')) {
      add('parenthetical', parenthetical[1], line);
      continue;
    }
    const known = [...new Set([...cast, ...speakers])]
      .sort((a, b) => b.length - a.length)
      .find((name) => value.startsWith(name) && /^\s/u.test(value.slice(name.length)));
    if (known) {
      review('action', value, line, '可能是省略冒号的对白', [
        { type: 'dialogue', character: known, text: value.slice(known.length).trim() },
        { type: 'action' },
      ]);
    } else if (markedActions) {
      review('action', value, line, '本场动作使用标记，此行没有标记', [
        { type: 'dialogue' },
        { type: 'action' },
        { type: 'note' },
      ]);
    } else add('action', value, line);
  }
  return { blocks, coveredLines, unsure };
}

export function checkSourceIntegrity(
  text: string,
  blocks: ScriptBlock[],
): { missingLines: number[]; invalidBlocks: string[] } {
  const lines = text.split(/\r\n?|\n/u);
  const covered = new Set(blocks.map((block) => block.src?.line));
  const body = new Set(['action', 'parenthetical', 'dialogue', 'sound', 'text', 'note']);
  return {
    missingLines: lines.flatMap((line, index) =>
      line.trim() && !episodeHeading.test(line.trim()) && !covered.has(index) ? [index] : [],
    ),
    invalidBlocks: blocks
      .filter(
        (block) =>
          body.has(block.type) &&
          (block.src === undefined || !lines[block.src.line]?.includes(block.text)),
      )
      .map((block) => block.id),
  };
}

export type MentionTerm = { elementId: string; name: string; kind: ElementKind };
export type Mention = MentionTerm & { from: number; to: number };
// shortcut: 逐词 indexOf，元素 × 段落规模实测卡顿时改为 Aho-Corasick
export function findMentions(
  text: string,
  terms: MentionTerm[],
  type?: ScriptBlock['type'],
): Mention[] {
  const matches: Mention[] = [];
  const lower = text.toLowerCase();
  for (const term of [...terms].sort((a, b) => b.name.length - a.name.length)) {
    if (
      !term.name ||
      (term.name.length < 2 && !(type === 'character' && lower === term.name.toLowerCase()))
    )
      continue;
    let start = 0;
    while (start < text.length) {
      const from = lower.indexOf(term.name.toLowerCase(), start);
      if (from < 0) break;
      const to = from + term.name.length;
      if (!matches.some((match) => from < match.to && to > match.from))
        matches.push({ ...term, from, to });
      start = to;
    }
  }
  return matches.sort((a, b) => a.from - b.from);
}

export function syncCandidates(blocks: ScriptBlock[]): { kind: ElementKind; name: string }[] {
  const candidates = new Map<string, { kind: ElementKind; name: string }>();
  for (const block of blocks) {
    const kind = block.type === 'scene' ? 'location' : 'character';
    const names =
      block.type === 'scene'
        ? [block.text]
        : block.type === 'character'
          ? [parseCharacter(block.text).name]
          : block.type === 'cast'
            ? block.text.split(/[、，,/／\s]+/u)
            : [];
    for (const name of names.map((name) => name.trim()).filter(Boolean))
      candidates.set(`${kind}:${name.toLowerCase()}`, { kind, name });
  }
  return [...candidates.values()];
}

export function deriveScenes(blocks: ScriptBlock[], episodeNumber: number) {
  const scenes: {
    id: string;
    number: string;
    actId: string | null;
    time: SceneAttrs['time'];
    space: SceneAttrs['space'];
    location: string;
    start: number;
    end: number;
    characters: string[];
  }[] = [];
  let actId: string | null = null;
  let current: (typeof scenes)[number] | undefined;
  for (const [index, block] of blocks.entries()) {
    if (block.type === 'act' || block.type === 'scene') {
      if (current) current.end = index;
      current = undefined;
    }
    if (block.type === 'act') actId = block.id;
    if (block.type === 'scene') {
      const attrs = block.attrs as SceneAttrs | undefined;
      current = {
        id: block.id,
        number: `${episodeNumber}-${scenes.length + 1}`,
        actId,
        time: attrs?.time ?? null,
        space: attrs?.space ?? null,
        location: block.text,
        start: index,
        end: blocks.length,
        characters: [],
      };
      scenes.push(current);
    }
    if (current && (block.type === 'character' || block.type === 'cast')) {
      for (const { name } of syncCandidates([block]))
        if (!current.characters.includes(name)) current.characters.push(name);
    }
  }
  return scenes;
}

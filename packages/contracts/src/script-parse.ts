import {
  ElementName,
  type BlockType,
  type CharacterAttrs,
  type ElementKind,
  type ReviewOption,
  type SceneAttrs,
  type ScriptBlock,
} from './scripts.js';

const numeral = '[0-9一二三四五六七八九十百]+';
const episodeHeading = new RegExp(`^第\\s*${numeral}\\s*集`, 'u');
const actHeading = /^(?:第[0-9一二三四五六七八九十]+幕|ACT\s+\S+)/iu;
const scenePrefix = new RegExp(
  `^(?:\\d+[-－—.]\\d+|第\\s*${numeral}\\s*场|(?:场景|场)\\s*${numeral}[:：]?|INT\\./EXT\\.?|INT\\.?|EXT\\.?)`,
  'iu',
);
const timeWords = new Set(
  '日 白天 夜 夜晚 晨 清晨 昏 黄昏 傍晚 正午 中午 上午 下午 午后 拂晓 黎明 凌晨 深夜 阴天'.split(
    ' ',
  ),
);
const spaceWords: Record<string, SceneAttrs['space']> = {
  内景: 'int',
  内: 'int',
  外景: 'ext',
  外: 'ext',
  '内景／外景': 'intext',
  '外景／内景': 'intext',
  内外: 'intext',
  'INT./EXT': 'intext',
  INT: 'int',
  EXT: 'ext',
};
const transitionWords =
  '切至|切到|切入|硬切|叠化|淡入|淡出|划入|划出|转场|黑场|CUT TO|FADE IN|FADE OUT|DISSOLVE TO';
const transition = new RegExp(`^(?:${transitionWords})`, 'iu');
const stopWords = new Set([
  ...'时间 地点 人物 字幕 备注 注 反打 特写 近景 中景 远景 全景 镜头 画面 场景 片名 景别'.split(
    ' ',
  ),
  ...transitionWords.split('|'),
]);
const wholeParen = /^[（(]([^（）()]*)[）)]$/u;
const inlineDialogue = /^([^\s:：（）()]{1,12})([（(][^）)]*[）)])?[:：]\s*(\S.*)$/u;
const validName = (name: string) =>
  /^[^\s:：（）()，。！？、；“”"'…—·]{1,12}$/u.test(name) && !stopWords.has(name);

export type NormalizedLine = {
  kind: 'empty' | 'structure' | 'heading' | 'quote' | 'list' | 'table' | 'plain';
  content: string;
  boldHead: string | null;
  boldRest: string | null;
};
export function normalizeLine(line: string): NormalizedLine {
  let content = line.trim();
  let kind: NormalizedLine['kind'] = content ? 'plain' : 'empty';
  if (
    /^(?:-{3,}|\*{3,}|_{3,})$/u.test(content) ||
    (/^[|:\-\s]+$/u.test(content) && content.includes('---')) ||
    /^<!-- (?:正文|附录) -->$/u.test(content)
  )
    kind = 'structure';
  else if (/^#{1,6}\s+/u.test(content)) {
    kind = 'heading';
    content = content.replace(/^#{1,6}\s+/u, '');
  } else if (/^>\s?/u.test(content)) {
    kind = 'quote';
    content = content.replace(/^>\s?/u, '');
  } else if (/^[-*+]\s+/u.test(content)) {
    kind = 'list';
    content = content.replace(/^[-*+]\s+/u, '');
  } else if (/^\|.*\|$/u.test(content)) kind = 'table';
  const bold = content.match(/^\*\*([^*]+)\*\*(.*)$/u);
  return {
    kind,
    content: content.replace(/\*\*|__|`/gu, '').trim(),
    boldHead: bold?.[1].trim() ?? null,
    boldRest: bold ? bold[2].replace(/`/gu, '').trim() : null,
  };
}
function sceneTime(text: string | null): SceneAttrs['time'] {
  if (!text) return null;
  if (/夜/u.test(text)) return 'night';
  if (/黄昏|傍晚|日落|昏/u.test(text)) return 'dusk';
  if (/拂晓|黎明|清晨|凌晨|晨|早/u.test(text)) return 'dawn';
  return /日|白天|正午|中午|午|上午|下午|阴天|晴/u.test(text) ? 'day' : null;
}
export function parseCharacter(text: string): CharacterAttrs & { name: string } {
  const match = text.trim().match(/^(.*?)[（(]([^（）()]*)[）)]$/u);
  const extension = match?.[2] ?? null;
  return {
    name: (match?.[1] ?? text).trim(),
    extension,
    delivery:
      extension && /画外|OS/iu.test(extension)
        ? 'os'
        : extension && /旁白|VO/iu.test(extension)
          ? 'vo'
          : extension && /内心|心声/u.test(extension)
            ? 'inner'
            : null,
  };
}
function standalone(line: NormalizedLine, known: Set<string>) {
  if (line.kind !== 'plain') return null;
  if (
    line.boldHead &&
    validName(line.boldHead) &&
    (!line.boldRest || wholeParen.test(line.boldRest))
  )
    return parseCharacter(line.boldHead + line.boldRest);
  if (!line.boldHead) {
    const character = parseCharacter(line.content);
    if (known.has(character.name)) return character;
  }
  return null;
}
export function parseSceneHeading(
  line: string,
): (SceneAttrs & { location: string; confident: boolean }) | null {
  const normalized = normalizeLine(line);
  if (['empty', 'structure', 'list', 'quote', 'table'].includes(normalized.kind)) return null;
  const code = /\d{1,2}:\d{2}(?::\d{2})?\s*[–—\-~～至]\s*\d{1,2}:\d{2}(?::\d{2})?$/u;
  const timecode =
    normalized.boldRest?.match(code)?.[0] ?? normalized.content.match(code)?.[0] ?? null;
  let heading = normalized.boldHead ?? normalized.content.replace(code, '').trim();
  if (new RegExp(`^【第\\s*${numeral}\\s*场.*】$`, 'u').test(heading))
    heading = heading.slice(1, -1);
  const prefix = heading.match(scenePrefix)?.[0];
  const numbered = heading.match(/^\d+[.、．]\s*/u)?.[0];
  const words = heading
    .slice(numbered?.length ?? 0)
    .replace(/[（(][^（）()]*[）)]$/u, '')
    .split(/[\s—–－]+/u);
  const formB =
    numbered &&
    words.some((word) => Object.hasOwn(spaceWords, word.toUpperCase()) || timeWords.has(word));
  const formC = normalized.boldHead && (numbered || timecode) && !standalone(normalized, new Set());
  if (!prefix && !formB && !formC) return null;
  heading = heading
    .slice((prefix ?? numbered ?? '').length)
    .replace(/^[:：]\s*/u, '')
    .trim();
  const suffix = heading.match(/[（(]([^（）()]*)[）)]$/u);
  const note = suffix?.[1] ?? null;
  if (suffix) heading = heading.slice(0, suffix.index).trim();
  let space: SceneAttrs['space'] = /^INT\.\/EXT/iu.test(prefix ?? '')
    ? 'intext'
    : /^INT/iu.test(prefix ?? '')
      ? 'int'
      : /^EXT/iu.test(prefix ?? '')
        ? 'ext'
        : null;
  let timeText: string | null = null;
  const halves = heading.split(/\s*[—–－]+\s*| - /u);
  if (halves.length > 1) timeText = halves.slice(1).join(' — ').trim() || null;
  const location: string[] = [];
  for (const word of halves[0].split(/\s+/u)) {
    if (Object.hasOwn(spaceWords, word.toUpperCase())) space = spaceWords[word.toUpperCase()];
    else if (halves.length === 1 && timeWords.has(word)) timeText = word;
    else if (word) location.push(word);
  }
  const time = sceneTime(timeText);
  return {
    time,
    space,
    timeText,
    note,
    timecode,
    location: location.join(' '),
    confident: time !== null || space !== null,
  };
}

export type RosterEntry = { name: string; status: 'confirmed' | 'pending'; description: string };
export function parseRoster(preface: string): RosterEntry[] {
  const result: RosterEntry[] = [];
  let active = false;
  for (const raw of preface.split(/\r\n?|\n/u)) {
    const line = normalizeLine(raw);
    if (line.kind === 'structure') continue;
    if (line.kind !== 'table') {
      active = false;
      continue;
    }
    const cells = raw
      .trim()
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.replace(/\*\*/gu, '').trim());
    if (['角色', '人物', '姓名', '角色名'].includes(cells[0])) {
      active = true;
      continue;
    }
    if (!active) continue;
    const other = ['其他', '其它', '其余'].includes(cells[0]);
    for (const name of other
      ? (cells[1] ?? '').split(/[、，,；;]/u).map((name) => name.replace(/[。．.\s]+$/u, '').trim())
      : [cells[0]]) {
      const parsed = ElementName.safeParse(name);
      if (parsed.success)
        result.push({
          name: parsed.data,
          status: other ? 'pending' : 'confirmed',
          description: other ? '' : (cells[1] ?? '').slice(0, 2000),
        });
    }
  }
  return result;
}
export function parseScriptText(text: string, newId: () => string = () => crypto.randomUUID()) {
  const lines = text.split(/\r\n?|\n/u);
  const normalized = lines.map(normalizeLine);
  const isBoundary = (i: number) =>
    actHeading.test(normalized[i].content) || !!parseSceneHeading(lines[i]);
  const bodyMarker = lines.findIndex((line) => line.trim() === '<!-- 正文 -->');
  const appendixMarker = lines.findIndex((line) => line.trim() === '<!-- 附录 -->');
  const firstBoundary = lines.findIndex((_, i) => isBoundary(i));
  const start = bodyMarker >= 0 ? bodyMarker + 1 : Math.max(firstBoundary, 0);
  let end = appendixMarker >= start ? appendixMarker : lines.length;
  if (appendixMarker < 0) {
    let lastBoundary = -1;
    for (let i = start; i < lines.length; i++) if (isBoundary(i)) lastBoundary = i;
    const appendixStart = normalized.findIndex(
      (line, i) => i >= start && i > lastBoundary && line.kind === 'heading' && !isBoundary(i),
    );
    if (lastBoundary >= start && appendixStart >= 0) end = appendixStart;
  }
  const preface = lines
    .slice(0, bodyMarker >= 0 ? bodyMarker : start)
    .join('\n')
    .replace(/(?:\n[ \t]*)+$/u, '');
  const appendix = lines
    .slice(appendixMarker >= 0 ? appendixMarker + 1 : end)
    .join('\n')
    .replace(/^\n/u, '');
  const roster = parseRoster(preface);
  const known = new Set(roster.map((entry) => entry.name));
  for (let i = start; i < end; i++) {
    const cast = normalized[i].content.match(/^(?:人物|出场人物|角色)[:：](.*)$/u);
    if (cast) for (const name of cast[1].split(/[、，,/／\s]+/u).filter(Boolean)) known.add(name);
    const character = standalone(normalized[i], new Set());
    if (character && lines[i + 1]?.trim()) known.add(character.name);
  }
  const independent =
    normalized
      .slice(start, end)
      .filter((line, i) => line.boldHead && standalone(line, known) && lines[start + i + 1]?.trim())
      .length >= 3;
  const blocks: ScriptBlock[] = [];
  const coveredLines = lines.flatMap((line, i) =>
    line.trim() && (i < start || i >= end) ? [i] : [],
  );
  const unsure: number[] = [];
  const speakers = new Set<string>();
  let markedActions = false;
  function add(type: BlockType, value: string, line: number, extra: Partial<ScriptBlock> = {}) {
    blocks.push({ id: newId(), type, text: value, src: { line }, ...extra });
  }
  function review(
    type: BlockType,
    value: string,
    line: number,
    reason: string,
    options: ReviewOption[],
  ) {
    unsure.push(line);
    add(type, value, line, { review: { reason, options } });
  }
  for (let line = start; line < end; line++) {
    const n = normalized[line];
    const value = n.content;
    if (!value) continue;
    coveredLines.push(line);
    if (n.kind === 'structure' || episodeHeading.test(value)) continue;
    if (actHeading.test(value)) {
      add('act', value, line);
      markedActions = false;
      continue;
    }
    const heading = parseSceneHeading(lines[line]);
    if (heading) {
      markedActions = false;
      for (let next = line + 1; next < end && !isBoundary(next); next++)
        if (/^[△▲※]/u.test(normalized[next].content)) markedActions = true;
      const { location, confident, ...attrs } = heading;
      add('scene', location, line, {
        attrs,
        ...(!confident
          ? {
              review: {
                reason: '场标题缺少时间或内外标记',
                options: [{ type: 'scene' }, { type: 'action', text: value }, { type: 'note' }],
              },
            }
          : {}),
      });
      if (!confident) unsure.push(line);
      continue;
    }
    if (['quote', 'table', 'heading'].includes(n.kind)) {
      add('note', value, line);
      continue;
    }
    const cast = value.match(/^(?:人物|出场人物|角色)[:：](.*)$/u);
    if (cast) {
      add('cast', cast[1].trim(), line);
      continue;
    }
    const subtitle = value.match(/^(?:字幕|画面字幕|屏幕文字|黑屏字幕)[:：](.*)$/u);
    if (subtitle) {
      add('text', subtitle[1].trim(), line);
      continue;
    }
    if (/^[△▲※]/u.test(value)) {
      add('action', value.slice(1).trim(), line);
      continue;
    }
    const sound =
      value.match(/^【(音效|音乐|BGM|音|配乐)】(.*)$/u) ?? value.match(/^\[(音效|SFX)\]\s*(.*)$/u);
    if (sound) {
      add('sound', sound[2].trim(), line, {
        attrs: { label: value.startsWith('[') ? '音效' : sound[1] },
      });
      continue;
    }
    const production = value.match(/^【([^】]{1,8})】(.*)$/u);
    if (production) {
      add('production', production[2].trim(), line, { attrs: { label: production[1] } });
      continue;
    }
    const character = standalone(n, known);
    if (character && lines[line + 1]?.trim()) {
      const { name, ...attrs } = character;
      add('character', name, line, { attrs });
      speakers.add(name);
      while (
        line + 1 < end &&
        normalized[line + 1].kind !== 'empty' &&
        normalized[line + 1].kind !== 'structure' &&
        !isBoundary(line + 1)
      ) {
        line++;
        coveredLines.push(line);
        const paren = normalized[line].content.match(wholeParen);
        add(paren ? 'parenthetical' : 'dialogue', paren?.[1] ?? normalized[line].content, line);
      }
      continue;
    }
    if (transition.test(value) && value.length <= 12) {
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
    if (n.kind === 'list') {
      add('action', value, line);
      continue;
    }
    const dialogue = n.kind === 'plain' ? value.match(inlineDialogue) : null;
    if (dialogue && validName(dialogue[1])) {
      const { name, ...attrs } = parseCharacter(dialogue[1] + (dialogue[2] ?? ''));
      if (!known.has(name) && !speakers.has(name) && (independent || name.length > 4))
        review('action', value, line, '说话人尚未出现，可能是动作', [
          { type: 'dialogue', character: name, text: dialogue[3].trim() },
          { type: 'action' },
        ]);
      else {
        speakers.add(name);
        add('character', name, line, { attrs });
        const paren = dialogue[3].trim().match(/^[（(]([^）)]*)[）)](.*)$/u);
        if (paren) add('parenthetical', paren[1], line);
        add('dialogue', (paren?.[2] ?? dialogue[3]).trim(), line);
      }
      continue;
    }
    const paren = value.match(wholeParen);
    if (paren) {
      const follows = ['character', 'parenthetical', 'dialogue'].includes(
        blocks.at(-1)?.type ?? '',
      );
      add(follows ? 'parenthetical' : 'note', follows ? paren[1] : value, line);
      continue;
    }
    const name = [...new Set([...known, ...speakers])]
      .sort((a, b) => b.length - a.length)
      .find((name) => value.startsWith(name) && /^\s/u.test(value.slice(name.length)));
    if (name)
      review('action', value, line, '可能是省略冒号的对白', [
        { type: 'dialogue', character: name, text: value.slice(name.length).trim() },
        { type: 'action' },
      ]);
    else if (markedActions)
      review('action', value, line, '本场动作使用标记，此行没有标记', [
        { type: 'dialogue' },
        { type: 'action' },
        { type: 'note' },
      ]);
    else add('action', value, line);
  }
  return {
    preface,
    appendix,
    blocks,
    coveredLines: coveredLines.sort((a, b) => a - b),
    unsure,
    roster,
  };
}

export const SPACE_LABELS = { int: '内景', ext: '外景', intext: '内景／外景' } as const;
export const TIME_LABELS = { day: '日', night: '夜', dawn: '清晨', dusk: '黄昏' } as const;
export function sceneText(block: ScriptBlock) {
  const attrs = block.attrs as SceneAttrs;
  return (
    [attrs.space ? SPACE_LABELS[attrs.space] : '', block.text].filter(Boolean).join('　') +
    ((attrs.timeText ?? (attrs.time ? TIME_LABELS[attrs.time] : null))
      ? ` — ${attrs.timeText ?? TIME_LABELS[attrs.time!]}`
      : '') +
    (attrs.note ? `（${attrs.note}）` : '')
  );
}
export function retypeLine(
  normalized: NormalizedLine,
  type: BlockType,
  character?: string,
  newId: () => string = () => crypto.randomUUID(),
): ScriptBlock[] {
  const block: ScriptBlock = { id: newId(), type, text: normalized.content };
  if (type === 'scene') {
    const heading = parseSceneHeading(
      normalized.boldHead
        ? `**${normalized.boldHead}**${normalized.boldRest ?? ''}`
        : normalized.content,
    );
    block.text = heading?.location ?? normalized.content;
    block.attrs = heading
      ? {
          time: heading.time,
          space: heading.space,
          timeText: heading.timeText,
          note: heading.note,
          timecode: heading.timecode,
        }
      : { time: null, space: null, timeText: null, note: null, timecode: null };
  } else if (type === 'character' || type === 'dialogue') {
    const inline = normalized.content.match(inlineDialogue);
    const spaced =
      character &&
      normalized.content.startsWith(character) &&
      /^\s/u.test(normalized.content.slice(character.length))
        ? [null, character, '', normalized.content.slice(character.length).trim()]
        : null;
    const match = inline ?? (type === 'dialogue' ? spaced : null);
    if (match) {
      const { name, ...attrs } = parseCharacter(match[1]! + (match[2] ?? ''));
      return [
        { id: newId(), type: 'character', text: name, attrs },
        { ...block, type: 'dialogue', text: match[3]!.trim() },
      ];
    }
    if (type === 'character') {
      const { name, ...attrs } = parseCharacter(normalized.content);
      block.text = name;
      block.attrs = attrs;
    }
  } else if (type === 'sound' || type === 'production') {
    const tag = normalized.content.match(/^【([^】]{1,8})】(.*)$/u);
    block.attrs = { label: tag?.[1] ?? (type === 'sound' ? '音效' : '提示') };
    block.text = tag?.[2].trim() ?? normalized.content;
  } else if (type === 'parenthetical')
    block.text = normalized.content.match(wholeParen)?.[1] ?? normalized.content;
  else if (type === 'action') block.text = normalized.content.replace(/^[△▲※]\s*/u, '');
  else if (type === 'text')
    block.text = normalized.content.replace(/^(?:字幕|画面字幕|屏幕文字|黑屏字幕)[:：]\s*/u, '');
  return [block];
}
export function retypeBlock(
  block: ScriptBlock,
  type: BlockType,
  newId: () => string = () => crypto.randomUUID(),
): ScriptBlock[] {
  if (block.type === type && block.attrs) {
    const unchanged = { ...block };
    delete unchanged.review;
    return [unchanged];
  }
  const text =
    block.type === 'scene'
      ? sceneText(block)
      : block.type === 'character'
        ? block.text +
          ((block.attrs as CharacterAttrs).extension
            ? `（${(block.attrs as CharacterAttrs).extension}）`
            : '')
        : block.text;
  const blocks = retypeLine(normalizeLine(text), type, undefined, newId);
  blocks[blocks.length - 1].id = block.id;
  return blocks.map((value) => ({ ...value, ...(block.src ? { src: block.src } : {}) }));
}
export function checkSourceIntegrity(text: string, blocks: ScriptBlock[]) {
  const lines = text.split(/\r\n?|\n/u);
  const parsed = parseScriptText(text);
  const covered = new Set(blocks.map((block) => block.src?.line));
  const bodyLines = new Set(parsed.blocks.map((block) => block.src!.line));
  const body = new Set([
    'action',
    'parenthetical',
    'dialogue',
    'sound',
    'text',
    'note',
    'production',
  ]);
  return {
    missingLines: lines.flatMap((line, i) =>
      line.trim() && bodyLines.has(i) && !covered.has(i) ? [i] : [],
    ),
    invalidBlocks: blocks
      .filter(
        (block) =>
          body.has(block.type) &&
          (block.src === undefined ||
            lines[block.src.line] === undefined ||
            !normalizeLine(lines[block.src.line]).content.includes(block.text)),
      )
      .map((block) => block.id),
  };
}
export type MentionTerm = { elementId: string; name: string; kind: ElementKind };
export type Mention = MentionTerm & { from: number; to: number };
// shortcut: 逐词 indexOf，元素 × 段落规模实测卡顿时改为 Aho-Corasick
export function findMentions(text: string, terms: MentionTerm[], type?: BlockType): Mention[] {
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
    if (block.review) continue;
    const kind = block.type === 'scene' ? 'location' : 'character';
    const names =
      block.type === 'scene' || block.type === 'character'
        ? [block.text]
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
    timeText: string | null;
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
        timeText: attrs?.timeText ?? null,
        space: attrs?.space ?? null,
        location: block.text,
        start: index,
        end: blocks.length,
        characters: [],
      };
      scenes.push(current);
    }
    if (current && (block.type === 'character' || block.type === 'cast'))
      for (const { name } of syncCandidates([block]))
        if (!current.characters.includes(name)) current.characters.push(name);
  }
  return scenes;
}

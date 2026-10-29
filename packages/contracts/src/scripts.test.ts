import sample from '../fixtures/script-sample-01.txt?raw';
import { describe, expect, it } from 'vitest';
import {
  BLOCK_TYPES,
  ScriptBlock,
  ScriptDocument,
  ScriptFile,
  StoryFile,
  type StoryElement,
} from './scripts.js';
import {
  checkSourceIntegrity,
  deriveScenes,
  findMentions,
  parseSceneHeading,
  parseScriptText,
  syncCandidates,
} from './script-parse.js';
import {
  EpisodeSummary,
  ProjectManifest,
  ProjectProfile,
  episodeLabel,
  formatProfile,
  isProfileComplete,
} from './projects.js';

const randomUUID = () => crypto.randomUUID();
const now = new Date().toISOString();
const episode = {
  id: randomUUID(),
  number: 1,
  title: '',
  createdAt: now,
  updatedAt: now,
  scenes: 0,
  chars: 0,
  draft: false,
};
const profile = {
  form: 'short',
  medium: 'live',
  genres: ['都市', '悬疑'],
  aspect: '9:16',
} as const;
const element: StoryElement = {
  id: randomUUID(),
  name: '林夏',
  kind: 'character',
  aliases: [],
  status: 'pending',
  description: '',
  attrs: {},
  createdAt: now,
  updatedAt: now,
};

it('项目设定、剧集上限和旧清单兼容', () => {
  const manifest = {
    format: 'frame-loom-project',
    formatVersion: 1,
    id: randomUUID(),
    name: '项目',
    createdAt: now,
    updatedAt: now,
    pages: [],
    unknown: true,
  };
  expect(ProjectManifest.parse(manifest)).toEqual(manifest);
  for (const episodes of [
    [episode, episode],
    [episode, { ...episode, id: randomUUID() }],
    Array.from({ length: 501 }, (_, index) => ({
      ...episode,
      id: randomUUID(),
      number: index + 1,
    })),
  ])
    expect(ProjectManifest.safeParse({ ...manifest, episodes }).success).toBe(false);
  for (const genres of [Array(6).fill('都市'), ['a', ' A '], [''], ['x'.repeat(11)], ['x\nx']])
    expect(ProjectProfile.safeParse({ ...profile, genres }).success).toBe(false);
  expect(ProjectProfile.parse({ ...profile, genres: [' 都市 '] }).genres).toEqual(['都市']);
  for (const [form, medium, genres, expected] of [
    [null, 'live', ['都市'], false],
    ['short', null, ['都市'], false],
    ['short', 'live', [], false],
    ['short', 'live', ['都市'], true],
  ] as const)
    expect(isProfileComplete(ProjectProfile.parse({ form, medium, genres, aspect: null }))).toBe(
      expected,
    );
  expect(isProfileComplete()).toBe(false);
  expect(formatProfile(ProjectProfile.parse(profile))).toBe('短剧 · 真人实拍 · 都市/悬疑 · 9:16');
  expect(episodeLabel(episode)).toBe('第 1 集');
  expect(episodeLabel({ ...episode, title: '重逢' })).toBe('第 1 集 重逢');
  for (const patch of [
    { number: 0 },
    { number: 10000 },
    { title: 'x'.repeat(81) },
    { title: 'a\n' },
  ])
    expect(EpisodeSummary.safeParse({ ...episode, ...patch }).success).toBe(false);
});

it('剧本验证唯一 id、纯文本和 attrs，文件大小和未知字段', () => {
  const block = { id: 'a', type: 'action', text: '' };
  expect(ScriptDocument.parse({ schemaVersion: 1, blocks: [block] }).blocks).toHaveLength(1);
  for (const blocks of [
    [block, block],
    [{ ...block, text: '\n' }],
    [{ ...block, text: '\r' }],
    [{ ...block, text: 'x'.repeat(4001) }],
    [{ ...block, attrs: { time: null, space: null } }],
    Array.from({ length: 5001 }, (_, i) => ({ ...block, id: `a${i}` })),
  ])
    expect(ScriptDocument.safeParse({ schemaVersion: 1, blocks }).success).toBe(false);
  for (const type of BLOCK_TYPES)
    expect(ScriptBlock.safeParse({ ...block, type }).success).toBe(true);
  const file = {
    format: 'frame-loom-script',
    formatVersion: 1,
    id: episode.id,
    revision: 1,
    source: null,
    pendingImport: null,
    convertedAt: null,
    document: { schemaVersion: 1, blocks: [] },
    unknown: '保留',
  };
  expect(ScriptFile.parse(file)).toEqual(file);
  expect(ScriptFile.safeParse({ ...file, unknown: 'x'.repeat(4 * 1024 * 1024) }).success).toBe(
    false,
  );
  const story = {
    format: 'frame-loom-story',
    formatVersion: 1,
    revision: 0,
    elements: [element],
    ignored: [],
  };
  expect(StoryFile.parse(story)).toEqual(story);
  expect(
    StoryFile.safeParse({
      ...story,
      elements: [element, { ...element, id: randomUUID(), name: '别名', aliases: ['林夏'] }],
    }).success,
  ).toBe(false);
  expect(
    StoryFile.safeParse({
      ...story,
      elements: Array.from({ length: 2001 }, (_, i) => ({
        ...element,
        id: randomUUID(),
        name: `人${i}`,
      })),
    }).success,
  ).toBe(false);
});

describe('场标题', () => {
  it.each([
    '1-8 夜 外 天台',
    '第3场 日 内 客厅',
    'INT. 客厅 - 夜',
    'EXT. 码头 - 日',
    'INT./EXT. 门口 夜',
    '12. 夜 外 码头',
    '1、日 内 客厅',
    '1－2 晨 内外 街道',
    '1—2 黄昏 外 街道',
  ])('识别 %s', (line) => expect(parseSceneHeading(line)?.confident).toBe(true));
  it('缺失时间和内外时存疑，动作不误判', () => {
    expect(parseSceneHeading('场景2：天台')).toEqual({
      time: null,
      space: null,
      location: '天台',
      confident: false,
    });
    expect(parseSceneHeading('她走进天台')).toBeNull();
  });
});

it('样例逐字保留，统计符合验收规格', () => {
  const result = parseScriptText(sample);
  const counts = Object.fromEntries(
    BLOCK_TYPES.map((type) => [type, result.blocks.filter((block) => block.type === type).length]),
  );
  expect(sample.split('\n').filter((line) => line.trim())).toHaveLength(47);
  expect(result.blocks).toHaveLength(60);
  expect(counts).toEqual({
    act: 2,
    scene: 7,
    cast: 7,
    action: 14,
    character: 11,
    dialogue: 11,
    parenthetical: 3,
    sound: 2,
    text: 1,
    transition: 2,
    note: 0,
  });
  expect(result.blocks.filter((block) => block.review).map((block) => block.text)).toEqual([
    '周屿 你这几年还好吗',
    '小林啊，别想了，睡吧。',
    '（闪回）',
  ]);
  expect(checkSourceIntegrity(sample, result.blocks)).toEqual({
    missingLines: [],
    invalidBlocks: [],
  });
  expect(
    syncCandidates(result.blocks).filter((candidate) => candidate.kind === 'character'),
  ).toHaveLength(4);
  expect(
    syncCandidates(result.blocks).filter((candidate) => candidate.kind === 'location'),
  ).toHaveLength(6);
  const missing = result.blocks.filter((block) => block.src?.line !== 6);
  expect(checkSourceIntegrity(sample, missing).missingLines).toContain(6);
  const dialogue = result.blocks.find((block) => block.type === 'dialogue')!;
  dialogue.text = '不是原文';
  expect(checkSourceIntegrity(sample, result.blocks).invalidBlocks).toContain(dialogue.id);
  expect(deriveScenes(result.blocks, 1).map((scene) => scene.number)).toEqual([
    '1-1',
    '1-2',
    '1-3',
    '1-4',
    '1-5',
    '1-6',
    '1-7',
  ]);
});

it.each([
  ['第2集 标题', []],
  ['ACT I', ['act']],
  ['人物：甲、乙', ['cast']],
  ['▲走开', ['action']],
  ['[SFX]风声', ['sound']],
  ['屏幕文字：你好', ['text']],
  ['FADE OUT', ['transition']],
  ['（回忆）', ['transition']],
  ['甲：（低声）你好', ['character', 'parenthetical', 'dialogue']],
  ['陌生的长名字：你好', ['action']],
  ['甲：你好\n（低声）', ['character', 'dialogue', 'parenthetical']],
  ['人物：甲\n甲 你好', ['cast', 'action']],
  ['普通的动作', ['action']],
  ['时间：晚上', ['action']],
])('规则表解析 %s', (text, types) =>
  expect(parseScriptText(text).blocks.map((block) => block.type)).toEqual(types),
);

it('长词优先、不重叠、单字仅角色全文命中，场和同步跳过注释', () => {
  const terms = [
    { elementId: 'a', kind: 'character' as const, name: '林夏' },
    { elementId: 'b', kind: 'location' as const, name: '林夏家' },
    { elementId: 'c', kind: 'character' as const, name: '林' },
  ];
  expect(findMentions('林夏家 林夏', terms).map((match) => match.elementId)).toEqual(['b', 'a']);
  expect(findMentions('林', terms)).toEqual([]);
  expect(findMentions('林', terms, 'character')).toHaveLength(1);
  const blocks = parseScriptText('1-1 日 内 客厅\n店主（OS）：你好\n2-1 夜 外 天台').blocks;
  expect(deriveScenes(blocks, 2)[0].actId).toBeNull();
  expect(deriveScenes([blocks.at(-1)!, ...blocks.slice(0, -1)], 2)[0].location).toBe('天台');
  expect(
    syncCandidates([
      { id: 'n', type: 'note', text: '林夏' },
      { id: 'c', type: 'character', text: '店主（OS）' },
    ]),
  ).toEqual([{ kind: 'character', name: '店主' }]);
});

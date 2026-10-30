import { expect, it } from 'vitest';
import sample from '../fixtures/script-sample-02.txt?raw';
import { ScriptBlock, ScriptDocument, BLOCK_TYPES } from './scripts.js';
import { DesktopPreferences } from './desktop.js';
import {
  normalizeLine,
  parseSceneHeading,
  parseScriptText,
  retypeBlock,
  retypeLine,
  checkSourceIntegrity,
  syncCandidates,
} from './script-parse.js';

it('v1 自动迁移，v2 严格校验属性与长度', () => {
  const document = ScriptDocument.parse({
    schemaVersion: 1,
    blocks: [
      { id: 's', type: 'scene', text: '天台', attrs: { time: 'night', space: 'ext' } },
      { id: 'c', type: 'character', text: '甲', attrs: { delivery: 'os' } },
      { id: 'a', type: 'action', text: '走' },
      { id: 'sound', type: 'sound', text: '风声' },
    ],
  });
  expect(document).toMatchObject({
    schemaVersion: 2,
    preface: '',
    appendix: '',
    blocks: [
      { attrs: { time: 'night', space: 'ext', timeText: null, note: null, timecode: null } },
      { attrs: { delivery: 'os', extension: null } },
      {},
      { attrs: { label: '音效' } },
    ],
  });
  expect(ScriptDocument.parse(document)).toEqual(document);
  for (const type of BLOCK_TYPES) {
    const block = retypeLine(normalizeLine('测试'), type)[0];
    expect(ScriptBlock.safeParse(block).success).toBe(true);
    expect(ScriptBlock.safeParse({ ...block, attrs: { wrong: true } }).success).toBe(false);
    if (['scene', 'character', 'sound', 'production'].includes(type))
      expect(ScriptBlock.safeParse({ ...block, attrs: undefined }).success).toBe(false);
  }
  expect(ScriptDocument.safeParse({ ...document, preface: '字'.repeat(50001) }).success).toBe(
    false,
  );
  expect(
    DesktopPreferences.parse({
      version: 1,
      theme: 'system',
      scriptView: 'markdown',
      scriptMentions: false,
    }).scriptView,
  ).toBe('markdown');
  for (const patch of [{ scriptView: 'raw' }, { scriptMentions: 1 }])
    expect(DesktopPreferences.safeParse({ version: 1, theme: 'light', ...patch }).success).toBe(
      false,
    );
});
it.each([
  ['', 'empty', ''],
  ['---', 'structure', '---'],
  ['***', 'structure', '*'],
  ['___', 'structure', '_'],
  ['| :--- | --- |', 'structure', '| :--- | --- |'],
  ['<!-- 正文 -->', 'structure', '<!-- 正文 -->'],
  ['<!-- 附录 -->', 'structure', '<!-- 附录 -->'],
  ['## __标题__', 'heading', '标题'],
  ['> **引文**', 'quote', '引文'],
  ['- `内容`', 'list', '内容'],
  ['| 甲 | 乙 |', 'table', '| 甲 | 乙 |'],
  ['**影娘**（画外）', 'plain', '影娘（画外）'],
  ['**片名** `00:00–00:10`', 'plain', '片名 00:00–00:10'],
])('预处理 %s', (raw, kind, content) =>
  expect(normalizeLine(raw)).toMatchObject({ kind, content }),
);
it.each([
  [
    '**1. 内景　城西卢宅·正屋 — 清晨（多年以后）**　`00:00–00:35`',
    '城西卢宅·正屋',
    'int',
    'dawn',
    '清晨',
    '多年以后',
    '00:00–00:35',
  ],
  ['**14. 内景／外景　卢宅 — 日**', '卢宅', 'intext', 'day', '日', null, null],
  [
    '**19. 外景／内景　街巷 · 城东张宅洞房 — 阴天／夜**',
    '街巷 · 城东张宅洞房',
    'intext',
    'night',
    '阴天／夜',
    null,
    null,
  ],
  ['**24. 内景　卢宅正屋 — 冬，拂晓**', '卢宅正屋', 'int', 'dawn', '冬，拂晓', null, null],
  ['**片名** `00:00–00:10`', '片名', null, null, null, null, '00:00–00:10'],
])('解析真实场标题 %s', (raw, location, space, time, timeText, note, timecode) =>
  expect(parseSceneHeading(raw)).toEqual({
    location,
    space,
    time,
    timeText,
    note,
    timecode,
    confident: !!(space || time),
  }),
);
it('列表和动作不识别为场标题', () => {
  expect(parseSceneHeading('- 第一任新主人刷了一遍石灰')).toBeNull();
  expect(parseSceneHeading('他走到门口。')).toBeNull();
});
it('没有场或幕时，Markdown 标题不会把全文吞入附录', () => {
  const text = '## 第一集完整剧本\n\n### 开始\n张扬：作业呢？\n\n动作。';
  const result = parseScriptText(text);
  expect(result.preface).toBe('');
  expect(result.appendix).toBe('');
  expect(result.blocks.some((block) => block.text === '作业呢？')).toBe(true);
  expect(result.blocks.at(-1)?.text).toBe('动作。');
  checkSourceIntegrity(text, result.blocks);
  const marked = parseScriptText('## 正文标题\n动作。\n<!-- 附录 -->\n补充说明');
  expect(marked.appendix).toBe('补充说明');
  expect(marked.blocks.some((block) => block.text === '动作。')).toBe(true);
});
it('中文场标题允许外层方头括号，普通制作标签仍不是场', () => {
  const text =
    '## 第一集完整剧本\n\n### 【第一场：人间炼狱早自习】\n**时间**：清晨 7:15\n**地点**：教室（内景）\n\n**张扬**\n作业呢？\n\n### 【第二场：走廊】\n少年走出门。';
  const result = parseScriptText(text);
  expect(
    result.blocks.filter((block) => block.type === 'scene').map((block) => block.text),
  ).toEqual(['人间炼狱早自习', '走廊']);
  expect(
    result.blocks.some((block) => block.type === 'dialogue' && block.text === '作业呢？'),
  ).toBe(true);
  expect(result.appendix).toBe('');
  expect(parseSceneHeading('**【画面】**')).toBeNull();
  expect(parseSceneHeading('### 普通说明')).toBeNull();
  checkSourceIntegrity(text, result.blocks);
});
it('真实样例逐段对照计划，前言、附录、角色表和元素准确', () => {
  const plan = `| 47 | scene | 城西卢宅·正屋 | time=dawn space=int timeText=清晨 note=多年以后 timecode=00:00–00:35 |  |
| 49 | transition | 黑场。 |  |  |
| 51 | sound | 棕刷蘸进灰浆桶，提起来，往下滴水。 | label=音效 |  |
| 53 | transition | 淡入。 |  |  |
| 55 | action | 一面白墙占满画面。墙皮斑驳，像癞子的头。 |  |  |
| 57 | action | 一把棕刷从画左扫进来，雪白的石灰浆一道一道盖上墙面。 |  |  |
| 59 | action | 刷墙匠四十来岁，哼着小调，退后两步打量。屋里空荡荡的，只剩一张旧书桌，桌上放着一盏干了的油灯。 |  |  |
| 61 | action | 墙正中刚刷过的石灰底下，慢慢洇出一片灰色，像水渍。 |  |  |
| 63 | action | 刷墙匠"啧"了一声，又刷一道，把它盖住，然后转身去提桶。 |  |  |
| 65 | production | 固定机位，不动。 | label=镜头 |  |
| 67 | action | 他身后，那片灰色又浮了上来，比刚才清楚：是一个瘦瘦的女人轮廓，微微弯着腰，一只手抬在半空。 |  |  |
| 69 | action | 刷墙匠回过头。刷子上的灰浆滴到地上。 |  |  |
| 71 | sound | 落尘声。 | label=音效 |  |
| 73 | transition | 硬切黑。 |  |  |
| 75 | scene | 片名 | time=null space=null timeText=null note=null timecode=00:35–00:45 | 存疑 |
| 77 | action | 黑底上落下一滴墨，晕成"影娘"两个字。"影"字最后一撇的墨慢慢往下渗，在字脚积成小小一团影子。 |  |  |
| 79 | sound | 阮，单音，一声。 | label=音乐 |  |
| 83 | scene | 卢宅门口 | time=day space=ext timeText=日 note=null timecode=00:45–00:55 |  |
| 85 | text | 青州府益都县 |  |  |
| 87 | action | 三间破瓦房，院里一棵老槐树。门关着。 |  |  |
| 89 | action | 几个孩童蹲在墙根，往门板上扔石子。 |  |  |
| 91 | character | 孩童们 | extension=null delivery=null |  |
| 92 | dialogue | 卢木头——卢木头—— |  |  |
| 94 | action | 门没开。孩子们哄笑着散了。他们的影子在地上跑跑跳跳，追着各自的主人。 |  |  |
| 97 | scene | 卢宅正屋 | time=night space=int timeText=冬夜 note=续 timecode=02:05–03:05 |  |
| 99 | character | 影娘 | extension=画外，从墙上传来 delivery=os |  |
| 100 | dialogue | 你怕什么？我跟了你二十三年了。 |  |  |
| 102 | character | 卢生 | extension=牙齿打战 delivery=null |  |
| 103 | dialogue | 你……你是什么妖怪？ |  |  |
| 105 | character | 影娘 | extension=null delivery=null |  |
| 106 | dialogue | 我不是妖怪。 |  |  |
| 108 | action | 叠化入回忆。回忆全用墨色，宣纸质感，像墙上演的皮影戏。 |  |  |
| 110 | action | 接生婆点亮一盏灯，婴儿啼哭。灯光一照，一小团影子落到地上。 |  |  |
| 112 | character | 影娘 | extension=画外 delivery=os |  |
| 113 | dialogue | 你娘生你那天，接生婆点了一盏灯，我就落到了地上。 |  |  |
| 115 | action | 学步的孩子摔倒，地上的小影子也跟着摔倒。 |  |  |
| 117 | character | 影娘 | extension=画外 delivery=os |  |
| 118 | dialogue | 你学走路，我跟着你摔跤。 |  |  |
| 120 | action | 雨夜，一盏灯。床上一个女人侧过脸，拉着一个七岁男孩的手，嘴唇在动。 |  |  |
| 122 | sound | 只有雨声，听不见她说什么。 | label=音效 |  |
| 124 | action | 雪地里有一座新坟。男孩跪着，他身后的雪地上，一道影子也跪着。 |  |  |
| 126 | character | 影娘 | extension=画外 delivery=os |  |
| 127 | dialogue | 你娘下葬，我跟着你跪在坟前。你从来没回头看过我一眼。 |  |  |
| 128 | parenthetical | 停顿 |  |  |
| 129 | dialogue | 我也不怪你。谁会回头看自己的影子呢？ |  |  |
| 132 | scene | 卢宅正屋 | time=night space=int timeText=夜 note=蒙太奇 timecode=04:50–05:20 |  |
| 134 | production | 同一机位、同一构图：卢生抬头看影娘。重复五次，每次隔一个季节。窗外依次是雪、桃花、蝉、黄了的槐叶、雪。 | label=镜头 |  |
| 136 | action | 第一次：纱后面没有脸。 |  |  |
| 137 | action | 第二次：长出两道淡淡的眉毛。 |  |  |
| 138 | action | 第三次：有了眼睛，眨了一下。 |  |  |
| 139 | action | 第四次：有了一张小小的嘴。 |  |  |
| 140 | action | 第五次：她笑了，左边嘴角往上翘。 |  |  |
| 142 | action | 反打：卢生也笑了，左边嘴角往上翘，和她一模一样。 |  |  |
| 144 | scene | 片尾字幕卡 | time=null space=null timeText=null note=null timecode=14:35–14:55 | 存疑 |
| 146 | action | 黑底白字，逐行淡入。可以配一段苍老男声旁白，作为"异史氏"。 |  |  |
| 148 | note | 异史氏曰： |  |  |
| 149 | note | 人有影子，就像人有本心。 |  |  |
| 150 | note | 它不说话，也不争功。你跪着，它也跪着。 |  |  |
| 151 | note | 你在光底下风光的时候，它就伏在你脚边，替你贴着泥土。 |  |  |
| 152 | note | 把它钉死了，人倒是轻松了。 |  |  |
| 153 | note | 可一旦站到太阳底下，别人一眼就能看出： |  |  |
| 154 | note | 这个人，已经不算是人了。 |  |  |
| 156 | action | 停一拍。 |  |  |
| 158 | note | 可叹啊。 |  |  |
| 160 | transition | 淡出。 |  |  |
| 162 | action | 演职员表。 |  |  |
| 164 | action | 全剧终 |  |  |`;
  const expected = plan
    .split('\n')
    .filter((line) => /^\| \d+ \|/u.test(line))
    .map((row) => {
      const [line, type, text, attrs, review] = row
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim());
      return {
        line: Number(line),
        type,
        text,
        attrs: attrs
          .split(' ')
          .sort((a, b) => a.localeCompare(b))
          .join(' '),
        review: !!review,
      };
    });
  const parsed = parseScriptText(sample);
  expect(
    parsed.blocks.map((block) => ({
      line: block.src!.line,
      type: block.type,
      text: block.text,
      attrs: block.attrs
        ? Object.entries(block.attrs)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join(' ')
        : '',
      review: !!block.review,
    })),
  ).toEqual(expected);
  expect(parsed.preface).toBe(sample.split('\n').slice(0, 47).join('\n').trimEnd());
  expect(parsed.appendix).toBe(sample.split('\n').slice(168).join('\n'));
  expect(parsed.roster.filter((entry) => entry.status === 'confirmed')).toHaveLength(5);
  expect(parsed.roster.filter((entry) => entry.status === 'pending')).toHaveLength(14);
  expect(checkSourceIntegrity(sample, parsed.blocks)).toEqual({
    missingLines: [],
    invalidBlocks: [],
  });
  expect(syncCandidates(parsed.blocks)).toEqual([
    { kind: 'location', name: '城西卢宅·正屋' },
    { kind: 'location', name: '卢宅门口' },
    { kind: 'character', name: '孩童们' },
    { kind: 'location', name: '卢宅正屋' },
    { kind: 'character', name: '影娘' },
    { kind: 'character', name: '卢生' },
  ]);
});
it.each([
  ['人物：林夏\n林夏：你好', ['cast', 'character', 'dialogue']],
  [
    '**甲**\n你好\n\n**乙**\n你好\n\n**丙**\n你好\n\n丁：你好',
    ['character', 'dialogue', 'character', 'dialogue', 'character', 'dialogue', 'action'],
  ],
  ['（独立说明）', ['note']],
  ['甲：你好\n（轻声）\n（停顿）', ['character', 'dialogue', 'parenthetical', 'parenthetical']],
  ['人物：林夏\n林夏 你好', ['cast', 'action']],
])('规则分支 %s', (text, types) =>
  expect(parseScriptText(text).blocks.map((block) => block.type)).toEqual(types),
);
it.each([
  [
    '**1. 内景 X — 夜**',
    'scene',
    'X',
    { time: 'night', space: 'int', timeText: '夜', note: null, timecode: null },
  ],
  ['**影娘**（画外）', 'character', '影娘', { extension: '画外', delivery: 'os' }],
  ['【镜头】固定机位', 'production', '固定机位', { label: '镜头' }],
  ['【音乐】风声', 'sound', '风声', { label: '音乐' }],
  ['（轻声）', 'parenthetical', '轻声', undefined],
  ['△走', 'action', '走', undefined],
  ['字幕：你好', 'text', '你好', undefined],
])('切换 %s 为 %s', (text, type, value, attrs) => {
  const [block] = retypeBlock({ id: 'old', type: 'action', text }, type as ScriptBlock['type']);
  expect(block).toEqual({ id: 'old', type, text: value, ...(attrs ? { attrs } : {}) });
});
it('切换对白沿用内容 id，场和角色先还原', () => {
  expect(
    retypeBlock({ id: 'old', type: 'action', text: '林夏：你好' }, 'character').map((block) => [
      block.type,
      block.text,
      block.id === 'old',
    ]),
  ).toEqual([
    ['character', '林夏', false],
    ['dialogue', '你好', true],
  ]);
  const scene = retypeLine(normalizeLine('1-1 夜 外 天台'), 'scene')[0];
  expect(retypeBlock(scene, 'action')[0].text).toBe('外景　天台 — 夜');
  const character = retypeLine(normalizeLine('影娘（画外）'), 'character')[0];
  expect(retypeBlock(character, 'note')[0].text).toBe('影娘（画外）');
});

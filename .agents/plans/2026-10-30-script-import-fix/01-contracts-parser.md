# Plan: schema v2 与规则解析器

Status: done
Parent: plan.md

## 目标

`packages/contracts` 完成以下几项，规格见笔记的「数据格式」「行预处理」「前言与附录」「规则解析器」「段落类型切换」五节：

- `ScriptDocument` v2，读取 v1 时自动迁移；
- 新的段落类型 `production`，以及新的 attrs；
- `normalizeLine`；
- 新的规则解析器，包括前言、附录和角色表；
- `parseSceneHeading`；
- `retypeBlock` 和 `retypeLine`；
- 新的原文完整性检查。

另外，`desktop.ts` 中新增两个偏好字段。两份样例的解析结果都必须符合下文的预期。

## 前置条件

- 已完整阅读笔记和父计划的「执行纪律」。
- 已阅读 `packages/contracts/src/scripts.ts`、`script-parse.ts`、`scripts.test.ts`、`desktop.ts`，以及 `canvas.ts` 中 `CanvasDocument` 的 transform 迁移写法。

## 步骤

- [x] T1 修改 `scripts.ts`：
  - `BLOCK_TYPES` 增加 `production`，`BLOCK_LABELS` 为「制作提示」，`BLOCK_SHORT_LABELS` 为「制」；
  - `SceneAttrs` 增加 `timeText`、`note`、`timecode`，`CharacterAttrs` 增加 `extension`，新增 `TagAttrs`；
  - attrs 与类型的对应关系按笔记执行（scene、character、sound、production 的 attrs 必填，其余类型不允许带 attrs）；
  - `ScriptDocument` 用 `z.union` 同时接受 v1 和 v2，再 transform 为 v2，迁移时的缺省值按笔记；
  - 输出类型 `ScriptDocument` 为 v2。

  — 验证：`scripts.test.ts` 覆盖以下几点：
  - 一份 v1 文档（包含 scene、character、sound 和其他类型）迁移后，各项缺省值正确；
  - v2 文档原样通过；
  - attrs 缺失或类型不符时被拒绝（每种类型至少一个反例）；
  - `preface` 超过 50000 个字符时被拒绝。
- [x] T2 修改 `desktop.ts`：`DesktopPreferences` 增加可选字段 `scriptView: 'styled' | 'markdown'` 和 `scriptMentions: boolean`。

  — 验证：`desktop.test.ts` 新增用例，覆盖新字段的正例和非法值的反例。
- [x] T3 修改 `script-parse.ts`：新增 `normalizeLine`，`kind`、结构行、区域标记、`boldHead`、`boldRest` 和 `content` 的规则都按笔记实现。

  — 验证：用表驱动的单测，每种 kind、每种结构行、粗体加括号、粗体加时间码、行内反引号，都至少有一个用例。
- [x] T4 重写 `parseSceneHeading`：按笔记中的第 0–6 步实现。

  — 验证：用表驱动的单测，至少包含以下输入，预期按笔记计算：
  - `**1. 内景　城西卢宅·正屋 — 清晨（多年以后）**　`加时间码；
  - `**14. 内景／外景　卢宅 — 日**`；
  - `**19. 外景／内景　街巷 · 城东张宅洞房 — 阴天／夜**`；
  - `**24. 内景　卢宅正屋 — 冬，拂晓**`；
  - `**片名**`加时间码（存疑）；
  - `1-8 夜 外 天台`、`第3场 日 内 客厅`、`INT. 客厅 - 夜`、`场景2：天台`、`12. 夜 外 码头`；
  - `- 第一任新主人刷了一遍石灰`（返回 null）；
  - `他走到门口。`（返回 null）。
- [x] T5 重写 `parseScriptText(text, newId)`，返回 `{ preface, appendix, blocks, coveredLines, unsure, roster }`：
  - 先预扫描已知名字，判断是否使用独立角色行的写法；
  - 然后按笔记的规则表 1–20 处理每一行，规则 12 按「对白组」把后续行一起处理；
  - 前言、附录和区域标记按笔记处理；
  - `roster` 为角色表解析结果，结构为 `{ name, status: 'confirmed' | 'pending', description }[]`；
  - 重写 `checkSourceIntegrity`，正文类段落的文字改为与 `normalizeLine` 的 content 比较。

  — 验证：
  - `script-sample-01.txt` 的结果为 60 段，各类型数量与原验收相同，3 处存疑，`preface` 为「第1集 重逢」，sound 段落的 label 依次为「音效」「音乐」；
  - `script-sample-02.txt` 的结果逐段符合下文的预期表（比较 `src.line`、type、text、attrs 和是否存疑），`preface` 等于第 0–46 行原样拼接，`appendix` 等于第 168–171 行原样拼接；
  - 两份样例的原文完整性检查都通过；
  - `roster` 中有 5 个已确认、14 个待确认；
  - 规则 16 的三个分支、规则 17 和 18、规则 19 各有一个独立用例。
- [x] T6 新增 `retypeBlock(block, type, newId)` 和 `retypeLine(normalized, type, character?, newId)`，规则按笔记的「段落类型切换」一节；从 scene 和 character 切出去时，先还原成一行文字。

  — 验证：表驱动的单测覆盖以下几点：
  - 「把『**1. 内景 X — 夜**』这一行从 action 切成 scene」得到正确的 attrs；
  - 「『**影娘**（画外）』从 action 切成 character」得到 extension 为「画外」、delivery 为 os；
  - 「『林夏：你好』从 action 切成 character」得到两个段落，dialogue 沿用原 id；
  - 「『【镜头】固定机位』从 action 切成 production」得到 label 为「镜头」；
  - 「场标题切成 action」得到还原后的一行文字；
  - 其余 11 种目标类型，每种至少一个用例。
- [x] T7 修改 `syncCandidates`：跳过带 `review` 的段落；角色名取 `CharacterAttrs` 之外的 text。`deriveScenes` 的 time 字段，改为同时返回 `timeText`。

  — 验证：对 `script-sample-02.txt` 的解析结果调用 `syncCandidates`，得到人物「孩童们」「影娘」「卢生」，场景「城西卢宅·正屋」「卢宅门口」「卢宅正屋」；存疑的「片名」「片尾字幕卡」不在结果中。

### script-sample-02.txt 逐段预期

列依次为：原文行号（从 0 开始）、type、text、attrs、是否存疑。sound 和 production 的 attrs 写作 `label=`，character 写作 `extension`、`delivery`，scene 写全部五个字段。

| 行 | type | text | attrs | 存疑 |
| --- | --- | --- | --- | --- |
| 47 | scene | 城西卢宅·正屋 | time=dawn space=int timeText=清晨 note=多年以后 timecode=00:00–00:35 |  |
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
| 164 | action | 全剧终 |  |  |

共 67 段：scene 6（其中存疑 2）、transition 4、sound 4、production 2、text 1、character 7、dialogue 8、parenthetical 1、note 8、action 26。

## 验证

- 预期：`pnpm --filter @frame-loom/contracts test` 和 `pnpm --filter @frame-loom/contracts typecheck` 通过，`build` 能输出 `dist/`。
- v2 的类型变化会让 engine 和 desktop 中构造 attrs 的代码无法通过类型检查。本子计划只做让它们恢复编译的最小改动：补齐新增的必填字段，sound 补上 label。这部分不改变行为，也不实现 03、04 的功能。改动后，`pnpm --filter @frame-loom/engine typecheck` 和 `pnpm --filter @frame-loom/desktop typecheck` 必须通过，保证每个提交都能编译。不运行 engine 和 desktop 的测试。
- 实际：contracts test 317 项通过，contracts typecheck、build 通过；engine typecheck、desktop typecheck 通过（Node 24.22.0 / pnpm 12.15.0）。

## 进度

- 2026-10-30：创建子计划草稿。
- 2026-10-30：完成 v2 schema、预处理、逐行规则、角色表、类型重解析及定向验证。

## 发现与偏差

- v2 输出类型使现有强类型测试数据需要同步版本与新增属性；同批做机械适配，不运行其他包测试。
- 结构行也执行 content 标记剥离，`***`、`___` 的 content 分别为 `*`、`_`，kind 仍为 structure，不生成段落。

## 交接

无。

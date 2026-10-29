# Plan: 契约与规则解析器

Status: draft
Parent: plan.md

## 目标

本子计划交付两部分：一是 `packages/contracts` 中的全部数据契约，二是纯函数形式的规则解析器、场标题解析、元素匹配与原文完整性检查。规格见功能笔记的「数据格式」「元素匹配与同步」和「转换 → 规则解析器」三节。后续子计划只 import 这里的 schema 和函数，不重复定义任何契约。

## 前置条件

- 已完整阅读两篇笔记，以及父计划的「执行纪律」。
- 已阅读 `packages/contracts/src/projects.ts`、`canvas.ts` 和 `index.ts`，以及 `projects.test.ts` 的写法。

## 步骤

- [ ] T1 `projects.ts`：
  - 新增 `ProjectProfile`、`GENRE_PRESETS`、`Genre`、`isProfileComplete(profile)`，以及 `formatProfile(profile)`（返回「短剧 · 真人实拍 · 都市/悬疑 · 9:16」这样的摘要，空字段跳过）；
  - 新增 `EpisodeSummary`；
  - `ProjectManifest` 增加可选字段 `profile`，以及 `episodes`（最多 500 项），并在 `superRefine` 中检查剧集 id 和集号唯一；
  - `ProjectPageSummary` 增加 `episodeId: uuid | null`，可选；
  - `ProjectCreateRequest` 增加可选字段 `profile`；
  - `ProjectPageCreateRequest` 改为 `{ name, episodeId? }`；
  - `ProjectPageRenameRequest` 改为 `{ name?, episodeId? }`，至少带一个字段；
  - `ProjectSummary` 增加可选字段 `profile`；
  - 新增 `episodeLabel(episode)`，返回「第 N 集 标题」，标题为空时返回「第 N 集」。

  — 验证：`projects.test.ts` 新增用例，覆盖以下几点：旧清单（没有新字段）能解析，未知字段保留；剧集 id 或集号重复时报错；题材超过 5 个、长度超出、去重后重复时报错；`isProfileComplete` 的真值表；`formatProfile` 与 `episodeLabel` 的输出。
- [ ] T2 新建 `scripts.ts`：
  - 数据结构：`BlockId`、`BlockType`（同时导出 `BLOCK_TYPES`，以及中文名和缩写表）、`SceneAttrs`、`CharacterAttrs`、`ReviewOption`、`ScriptBlock`、`ScriptDocument`、`ScriptSource`、`ScriptFile`（整份 4 MiB 上限通过 `superRefine` 检查）；
  - 设定库：`ElementKind`、`StoryElement`、`StoryFile`（同类名称和别名合在一起，忽略大小写唯一）；
  - 转换：`ConversionState`；
  - 笔记「接口」表中所有请求和响应的 schema，命名为 `<名词><动作>Request` 或 `<名词>Result`；
  - 从 `index.ts` 导出这些内容。

  — 验证：`scripts.test.ts` 覆盖以下几点：段落 id 重复、文字含 `\n` 或 `\r`、超过 5000 段、attrs 与 type 不匹配（例如 action 带有 SceneAttrs）都被拒绝；`ScriptFile` 保留未知顶层字段；元素同名或与别名冲突时被拒绝；最多 2000 个元素。
- [ ] T3 新建 `script-parse.ts` 中的 `parseSceneHeading(line)`，返回 `{ time, space, location, confident } | null` — 验证：用表驱动单测，覆盖笔记规则表第 3 行的每一种写法，以及「1-8 夜 外 天台」「第3场 日 内 客厅」「INT. 客厅 - 夜」「场景2：天台」「12. 夜 外 码头」；没有时间或内外词时 `confident` 为 false；普通动作句返回 null。
- [ ] T4 `parseScriptText(text)`：按笔记规则表 1–13 的顺序逐行识别，返回 `{ blocks, coveredLines, unsure }`。
  - 段落 id 用调用方注入的 `newId()` 生成，默认为 `crypto.randomUUID`。
  - 每个段落带 `src.line`。
  - 存疑的段落带 `review`，候选项按规则表填写。
  - 在拆分出 parenthetical 和 dialogue 时，原段落 id 落在承载原文的 dialogue 段落上。

  — 验证：表驱动单测，规则表的每一行至少有一个正例，规则 10、12、13 各有一个反例。
- [ ] T5 新建 `packages/contracts/fixtures/script-sample-01.txt`，使用 UTF-8 编码、LF 换行，内容逐字取自下文「样例剧本」一节，共 47 个非空行。原型附录不入库，这份文件是唯一副本，以后 e2e 也读取它。

  — 验证：`parseScriptText` 对样例得到 60 个段落，各类型数量为：act 2、scene 7、cast 7、action 14、character 11、dialogue 11、parenthetical 3、sound 2、text 1、transition 2；存疑段落恰好是「周屿 你这几年还好吗」「小林啊，别想了，睡吧。」「（闪回）」三行。

  如果数量与笔记不一致，先核对解析器是否按笔记实现。确认笔记中的数字有误时，按父计划「执行纪律」第 2 条处理。
- [ ] T6 `checkSourceIntegrity(text, blocks)`：实现笔记中「原文完整性」的两条规则，返回未覆盖的行号和不是原文子串的段落 id。

  — 验证：样例解析结果通过检查；人为删除一个段落后报告缺失的行；修改一个对白的文字后报告该段落。
- [ ] T7 实现以下三个函数：
  - `findMentions(text, terms)`，规则按笔记描述（长的优先、不重叠、长度小于 2 的词只匹配全文等于该词的角色段落）；
  - `deriveScenes(blocks, episodeNumber)`，返回每一场的 `{ id, number: 'N-k', actId, time, space, location, start, end, characters }`；
  - `syncCandidates(blocks)`，从角色段落、出场人物段落和场景段落提取候选名称，跳过 note 段落。

  — 验证：单测覆盖以下几点：长词优先（「林夏家」优先于「林夏」）、不重叠、单字只在角色段落全文匹配；没有幕时 `actId` 为 null；大纲重排后场号随之重排；样例的候选名称为 4 个人物、6 个地点。

### 样例剧本

```text
第1集 重逢

第一幕

1-1 日 内 旧书店
人物：林夏、周屿、店主
△ 午后的阳光斜照进书架间，灰尘在光里浮动。
△ 林夏抱着一摞旧书走到柜台，抬头，愣住。
林夏：（小声）周屿？
周屿：好久不见。
店主（OS）：这批书下午就要收走了。
【音效】门口风铃响。

1-2 日 外 书店门口
人物：林夏、周屿
△ 两人并肩走出书店，沉默。
周屿 你这几年还好吗
林夏：还行。你呢？
△ 周屿从口袋里掏出一只旧信封，信封边角已经发黄。
字幕：五年前

1-3 夜 内 林夏家·卧室
人物：林夏
△ 林夏坐在床边，反复看着那只旧信封。
林夏（VO）：他为什么现在才回来？
小林啊，别想了，睡吧。
△ 窗外开始下雨。
切至：

第二幕

1-4 夜 外 街道
人物：周屿、陌生男人
△ 周屿撑伞站在路灯下，一个戴帽子的陌生男人走近。
陌生男人：东西给她了？
周屿：（迟疑）给了。
△ 陌生男人转身消失在雨里。
【音乐】低沉的大提琴声渐起。

1-5 日 内 旧书店
人物：林夏、店主
△ 林夏推门进来，书架已经空了一半。
林夏：老板，昨天那个人……
店主：他留了这个给你。
△ 店主递过来一把生锈的钥匙。

1-6 夜 内 林夏家·客厅
人物：林夏
△ 林夏把钥匙和信封并排放在茶几上。
林夏：（自语）五年前那天晚上，到底发生了什么。

1-7 夜 外 天台
人物：林夏、周屿
△ 林夏推开天台的门，周屿背对着她站在栏杆边。
周屿：你终于来了。
（闪回）
```

预期的解析结果中，有几处容易判错：

- 「周屿 你这几年还好吗」命中规则 12，因为「周屿」出现在本场的出场人物中。
- 「小林啊，别想了，睡吧。」命中规则 13，因为本场有以 △ 开头的行，所以判为存疑。
- 「（闪回）」命中规则 9。它也满足规则 11 的条件（上一段是对白），但规则 9 排在前面，所以按规则 9 处理。

## 验证

- 预期：`pnpm --filter @frame-loom/contracts test` 和 `pnpm --filter @frame-loom/contracts typecheck` 通过，`pnpm --filter @frame-loom/contracts build` 能输出 `dist/`。不运行其他包的测试。
- 实际：未执行。

## 进度

- 2026-10-29：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始。

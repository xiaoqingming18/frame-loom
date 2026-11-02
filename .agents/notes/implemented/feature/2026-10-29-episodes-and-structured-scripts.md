# Agent Note: 剧集、项目设定与结构化剧本

Status: implemented

2026-11-01 后续方案见[标准剧本与项目 SQLite 重构](../../proposed/architecture/2026-11-01-standard-script-rebuild.md)。该方案代码已实施并进入最终验收；本篇只记录旧版功能与当时验证事实，不代表旧数据格式／转换／编辑入口仍为当前实现。剧本域当前事实、实施范围与未通过验收项以[新方案及状态](../../proposed/architecture/2026-11-01-standard-script-rebuild.md)为准；本篇的项目／剧集组织历史仍有效。

## Problem

原有项目只有创作页（画布）、项目资产和项目媒体三类内容，缺少剧集与剧本的组织方式。用户需要把一集剧本原文粘贴进来，由系统识别并转成标准结构：幕、场、动作、角色、对白等段落，同时把人物、场景、道具、服装提取到项目级的设定库。稳定的段落 id 为后续故事板、分镜出图、配音和 Agent 流水线提供引用基础，这些后续能力不在本次实现范围内。

用户已确认的取舍：

1. 剧集成为正式概念，是项目下的一等实体。一集持有一份剧本，并可以关联若干创作页。
2. 第一期只支持按集、按场组织的叙事剧本。广告、MV 这类分镜表格以后归入分镜模块。
3. 完整实现剧本编辑器。编辑器里的文档本身就是标准格式，由带类型的段落组成。转换在后台进行，主要目的是识别元素、写入设定库，为后续功能打基础。
4. 编辑器使用 Tiptap 这类内核，选型见[剧本编辑器内核选型](../architecture/2026-10-29-script-editor-tiptap.md)。
5. 题材采用「预设加自定义」。
6. 内容形式、制作媒介、题材、画幅作为项目级的可选设定。新建项目时可以不填，首次导入剧本时必须补齐，补齐后写回项目。
7. 交互以用户确认过的原型为准：项目库 → 新建项目（可选填项目设定）→ 新建剧集 → 粘贴导入 → 后台转换 → 三栏编辑器 → 设定库确认元素。下文「界面」一节是可执行的规格，原型 HTML 不入库。

现状约束：

- 项目文件夹是数据的唯一来源，engine SQLite 只存可重建的本机状态（[项目库](../../implemented/feature/2026-10-26-project-library.md)）。`ProjectManifest` 和 `ProjectPageSummary` 都是 `passthrough`，新增可选字段不需要升级 `formatVersion`，旧版本应用会原样保留这些字段。
- 同一项目的所有写操作都要经过 `ProjectStore.serial(projectId)` 串行队列。页面文件的 revision 冲突检查同时比较 revision、mtime、size 和内容摘要。
- 文本模型只能通过 `apps/engine/src/modules/llm` 调用，pi-ai 也只在这个模块里 import（[Agent 内核选型](../../proposed/architecture/2026-10-24-agent-runtime-pi.md)）。默认文本模型保存在 `model_defaults` 表，接口为 `GET /model-defaults`。
- 界面只能使用 `theme.css` 中的 token、shadcn 和 lucide，并且要检查明暗两种模式（[UI 规范](../../../../docs/ui-guidelines.md)）。

## Decision

### 术语

全文以及代码命名统一使用以下术语，不另造同义词：

| 中文                   | 标识符                      | 含义                                             |
| ---------------------- | --------------------------- | ------------------------------------------------ |
| 剧集                   | episode                     | 项目下的一集，有集号和标题                       |
| 剧本                   | script                      | 一集对应的结构化文档文件                         |
| 段落                   | block                       | 剧本中带类型的一行                               |
| 场                     | scene                       | 由场标题段落开始，到下一个场标题或幕段落之前结束 |
| 幕                     | act                         | 可选的分隔段落，只用于分组                       |
| 原文                   | source                      | 用户粘贴的原始文本                               |
| 待转换导入             | pendingImport               | 已提交、但还没有成功转换的原文                   |
| 转换                   | conversion                  | 后台把原文变成段落并提取元素的过程               |
| 设定库                 | story                       | 项目级的人物、场景、道具、服装集合               |
| 元素                   | element                     | 设定库中的一项                                   |
| 待确认／已确认／已忽略 | pending／confirmed／ignored | 元素的状态                                       |

### 数据格式

```text
.frameloom\
  project.json                     新增可选字段：profile、episodes；pages[] 新增可选字段 episodeId
  scripts\<episodeId>.json         每集一份剧本文件
  story.json                       项目设定库；文件不存在时视为空
  trash\scripts\<episodeId>-<时间戳>-<uuid>.json   删除剧集后剧本移到这里，保留 30 天
```

`formatVersion` 保持为 1。新建项目时创建 `scripts/` 和 `trash/scripts/` 目录。已有项目在第一次写入剧本时用 `mkdir recursive` 补建目录。读取和清理时，目录不存在一律按空目录处理。

**项目设定**（`project.json` 中的 `profile`，可以没有这个字段）：

```ts
ProjectProfile = {
  form: 'series' | 'short' | 'film' | 'other' | null,          // 剧集／短剧／电影／其他
  medium: 'live' | 'anim2d' | 'anim3d' | 'ai' | 'mixed' | null, // 真人实拍／2D 动画／3D 动画／AI 写实／混合
  genres: Genre[],          // 最多 5 个，忽略大小写去重；Genre 去掉首尾空白后为 1–10 个字符，不能含控制字符
  aspect: '16:9' | '9:16' | '2.39:1' | '4:3' | null,
}
GENRE_PRESETS = ['都市','古装','悬疑','爱情','喜剧','科幻','奇幻','武侠','家庭','职场','青春','恐怖','历史','动作']
```

不在 `GENRE_PRESETS` 中的题材就是自定义题材，不另外存一份自定义列表。只有 `form`、`medium` 都不为空，且 `genres` 至少有一项时，才算「设定完整」。`ProjectSummary` 新增可选字段 `profile?: ProjectProfile`，在检查项目时从清单读取。项目不可用或没有设定时，不带这个字段。

**剧集**（`project.json` 中的 `episodes`，可以没有这个字段，缺省视为 `[]`）：

```ts
EpisodeSummary = {
  id: uuid, number: int 1–9999, title: string,   // title 为 0–80 个字符，不能含控制字符
  createdAt, updatedAt,
  scenes: int, chars: int,   // 每次写入剧本时由 engine 回写，chars 是所有段落去掉空白后的字符数
  draft: boolean,            // 剧本文件中是否存在 pendingImport
}
```

- 项目内的 `id` 和 `number` 都必须唯一，最多 500 集，列表一律按 `number` 排序显示。显示名称为「第 N 集 标题」，标题为空时显示「第 N 集」。
- `ProjectPageSummary.episodeId?: uuid | null` 表示创作页属于哪一集，这是页面与剧集关系的唯一来源，剧集本身不保存页面列表。`episodeId` 指向不存在的剧集时，按「未分集」显示。这种情况只会因外部改动出现，所以不专门清理。
- 删除剧集时，把剧本移到 `trash/scripts/`，并把相关页面的 `episodeId` 置空。页面本身不删除。

**剧本文件**（`scripts/<episodeId>.json`，整份文件不超过 4 MiB）：

```ts
ScriptFile = {
  format: 'frame-loom-script', formatVersion: 1,
  id: episodeId, revision: int ≥ 1,
  source: ScriptSource | null,          // 最近一次成功转换所用的原文
  pendingImport: ScriptSource | null,   // 已提交、尚未成功转换的原文
  convertedAt: datetime | null,
  document: ScriptDocument,
}  // passthrough
ScriptSource = { text: string（1–200000 个字符）, importedAt: datetime }
ScriptDocument = { schemaVersion: 2, preface: string, appendix: string, blocks: ScriptBlock[]（最多 5000 个） }  // strict，读取 v1 时迁移
ScriptBlock = {
  id: BlockId,                     // /^[A-Za-z0-9_-]{1,64}$/，在文档内唯一
  type: BlockType,
  text: string,                    // 0–4000 个字符，不能含 \r 或 \n
  attrs?: SceneAttrs | CharacterAttrs | TagAttrs,  // scene、character、sound、production 必填
  src?: { line: int ≥ 0 },         // 转换时对应原文的行号（从 0 开始），编辑后不再维护
  review?: { reason: string（≤ 200 个字符）, options: ReviewOption[]（1–4 个） },
}
BlockType = 'act' | 'scene' | 'cast' | 'action' | 'character' | 'parenthetical'
          | 'dialogue' | 'sound' | 'production' | 'text' | 'transition' | 'note'
SceneAttrs = { time: 'day' | 'night' | 'dawn' | 'dusk' | null, space: 'int' | 'ext' | 'intext' | null, timeText: string | null, note: string | null, timecode: string | null }
CharacterAttrs = { delivery: 'vo' | 'os' | 'inner' | null, extension: string | null }
TagAttrs = { label: string }
ReviewOption = { type: BlockType, character?: string（≤ 40 个字符）, text?: string }
```

| type          | 中文名         | 缩写 | `text` 的含义                                   |
| ------------- | -------------- | ---- | ----------------------------------------------- |
| act           | 幕             | 幕   | 例如「第一幕」                                  |
| scene         | 场标题         | 场   | 地点，例如「林夏家·卧室」；时间和内外放在 attrs |
| cast          | 出场人物       | 人   | 例如「林夏、周屿」，按 `、，,/／` 和空白切分    |
| action        | 动作           | 动   | 动作描写，不含开头的 `△▲※` 标记                 |
| character     | 角色           | 角   | 角色名，不含冒号和（OS）这类后缀                |
| parenthetical | 括注           | 括   | 不含括号，括号由样式显示                        |
| dialogue      | 对白           | 白   | 台词                                            |
| sound         | 音效／音乐     | 音   | 不含【音效】这类标记                            |
| production    | 制作提示       | 制   | 不含标签，标签原文保存在 attrs.label            |
| text          | 字幕／画面文字 | 字   | 不含「字幕：」这类前缀                          |
| transition    | 转场           | 转   | 原样保留，例如「切至：」                        |
| note          | 注释           | 注   | 不进入下游流程                                  |

规则：

- 剧本文件里只存纯文本段落。段落内不存元素 id，也不存行内标记（mark）。元素的高亮和出现位置，都按名称和别名实时匹配得出。这样合并、改名、忽略元素都只需要修改 `story.json`，不必改写任何剧本文件。
- 场号不落盘，显示时按顺序推导为 `<集号>-<本集内的场序号>`。调整场的顺序后，场号自动重排。
- 场的 id 就是它的场标题段落 id。后续的故事板和分镜按段落 id 引用剧本位置。
- 一个段落被拆成「角色 + 对白」时，原段落的 id 保留在承载原文内容的那个段落上（对白段落），新增的角色段落使用新 id。这条规则同样适用于用户选择候选项和 engine 应用模型决定。规则解析器为每个段落生成新 id。
- 写入剧本的顺序是：先写剧本文件，再写清单中的剧集摘要。两步之间如果崩溃，摘要会过时；下次读取剧本时，engine 发现摘要与剧本不一致，就修复摘要，做法与创作页的 `repair` 相同。
- `review` 表示「识别存疑」。用户选择某个候选项、手动修改段落类型，或者手动编辑该段文字后，这个字段被清除。
- 剧本 revision 的冲突检查与创作页一致：比较 revision、mtime、size 和内容摘要。不一致时返回 409 `SCRIPT_REVISION_CONFLICT`。

**设定库**（`story.json`）：

```ts
StoryFile = {
  format: 'frame-loom-story', formatVersion: 1, revision: int ≥ 0,
  elements: StoryElement[]（最多 2000 个）,
  ignored: { kind: ElementKind, name: string }[]（最多 2000 个）,
}  // passthrough
ElementKind = 'character' | 'location' | 'prop' | 'costume'   // 人物／场景／道具／服装
StoryElement = {
  id: uuid, kind, name: string（1–40 个字符）, aliases: string[]（最多 20 个，每个 1–40 个字符）,
  status: 'pending' | 'confirmed',
  description: string（≤ 2000 个字符）,
  attrs: { gender?, ageRange?, appearance?, personality?, space?: 'int' | 'ext' | 'intext', times?: SceneTime[] },
  // attrs 中的字符串字段各不超过 200 个字符
  suggestedMergeInto?: uuid,   // 转换时模型建议「此元素是某元素的别名」
  createdAt, updatedAt,
}
```

- 同一 `kind` 下，所有名称和别名合在一起比较（忽略大小写）必须唯一。
- `story.json` 每次写入，`revision` 加 1，这个值用作出现位置缓存的键。
- 设定库的所有修改都是 engine 端的原子命令，在项目串行队列中「读取、修改、写回」。请求不带 revision，也不会返回 409。

### 元素匹配与同步

- **匹配函数** `findMentions(text, terms)` 放在 contracts，engine 和编辑器共用同一份实现。`terms` 由所有未忽略元素的名称和别名组成，按长度从长到短、从左到右扫描，结果不重叠。长度小于 2 的词只在角色段落「全文等于该词」时才算命中。`shortcut: 逐词 indexOf，元素 × 段落规模实测卡顿时改为 Aho-Corasick`。
- **出现位置**：engine 在内存中缓存每集的匹配结果，不落盘。缓存键是剧本的 revision、mtimeNs、size，加上设定库的 revision。每次先 stat 剧本文件，只有任何一项不一致时才重新读取和匹配。剧集列表中的「待确认」数，是在该集出现过的待确认元素个数，也从这份缓存得出。
- **合并元素**：如果其他元素的 `suggestedMergeInto` 指向被合并的源元素，改为指向目标元素。如果因此指向了自己，就清除这个字段。
- **自动同步**：每次保存剧本、每次转换完成后，engine 收集以下候选名称：
  - 角色段落的文本，去掉（OS）、（VO）这类后缀；
  - 出场人物段落切分出的名字；
  - 场标题段落的文本，作为地点。

  候选名称如果不匹配同类元素的名称或别名，也不在 `ignored` 中，就新建为待确认元素。结果返回「新增数量」。恢复一个已忽略的名称时，对所有剧本执行一次同步。

- 道具和服装只来自转换时文本模型的提取，或者用户手动标记。

### 转换

转换由 engine 的 `modules/scripts` 执行，分四个阶段，阶段名用于显示进度：

1. **split（切分）**：用 contracts 中的 `parseScriptText(text)` 规则解析器，把原文按行解析成段落，每个段落带上 `src.line` 和「确定／存疑」标记。
2. **classify（归类）**：如果配置了默认文本模型，就把原文按行分批交给模型，只请模型对「存疑」的行做决定。没有默认文本模型时跳过这一步，存疑行保持规则解析的猜测，并带上 `review`。

以上「只对存疑行做决定」及下文模型批次与决定范围，已由[导入修正笔记](2026-10-30-script-import-and-markdown-view.md#转换)部分取代：当前全部正文行交给模型，未返回决定视为认可 guess。3. **extract（提取）**：模型在同一批调用中顺带提取元素。没有模型时，这一步只有规则同步。4. **match（匹配）**：写入剧本，执行同步，计算统计数字。

**规则解析器**按以下顺序识别各行（行先去掉首尾空白，空行跳过）：

以下表格保留原有规则决策；当前 Markdown 预处理、独立角色行和前言附录使用[新规则表](2026-10-30-script-import-and-markdown-view.md#规则解析器替换原规则表)。

| 顺序 | 识别条件                                                                                                                                    | 结果                                                                                                                                                        | 置信                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1    | `^第\s*[0-9一二三四五六七八九十百]+\s*集`                                                                                                   | 集标题，不生成段落，只计入覆盖                                                                                                                              | 确定                                                                            |
| 2    | `^第[0-9一二三四五六七八九十]+幕` 或 `^ACT\s+\S+`                                                                                           | act                                                                                                                                                         | 确定                                                                            |
| 3    | `^\d+[-－—.]\d+`、`^第\s*[0-9一二…]+\s*场`、`^(场景\|场)\s*[0-9一二…]+[:：]?`、`^(INT\|EXT\|INT\./EXT)\.?`，或 `^\d+[.、]` 后跟时间／内外词 | scene：时间词（日 白天 → day，夜 夜晚 → night，晨 清晨 → dawn，昏 黄昏 傍晚 → dusk），内外词（内 → int，外 → ext，内外 → intext），其余按空白切分后作为地点 | 至少有一个时间或内外词时为确定，否则存疑                                        |
| 4    | `^(人物\|出场人物\|角色)[:：]`                                                                                                              | cast                                                                                                                                                        | 确定                                                                            |
| 5    | 以 `△▲※` 开头                                                                                                                               | action（去掉标记）                                                                                                                                          | 确定                                                                            |
| 6    | `^【(音效\|音乐\|BGM\|音)】`、`^\[(音效\|SFX)\]`                                                                                            | sound（去掉标记）                                                                                                                                           | 确定                                                                            |
| 7    | `^(字幕\|画面字幕\|屏幕文字\|黑屏字幕)[:：]`                                                                                                | text（去掉前缀）                                                                                                                                            | 确定                                                                            |
| 8    | `^(切至\|切到\|叠化\|淡入\|淡出\|转场\|CUT TO\|FADE IN\|FADE OUT)`                                                                          | transition                                                                                                                                                  | 确定                                                                            |
| 9    | 整行是 `（闪回）`、`（回忆）` 这类括号包着的转场词                                                                                          | transition，候选项为 transition、action、note                                                                                                               | 存疑                                                                            |
| 10   | `名字（后缀）?[:：]内容`，名字为 1–12 个字符，不含空白、冒号或括号，也不在停用词（时间、地点、人物、字幕、备注、注）中                      | character（后缀 OS、画外音 → os；VO、旁白 → vo；内心 → inner）；内容以（…）开头时，先拆出 parenthetical，其余为 dialogue                                    | 名字没有出现在本场出场人物或之前的说话人中，且超过 4 个字符时为存疑，其余为确定 |
| 11   | 整行是（…），且上一段是 character 或 dialogue                                                                                               | parenthetical                                                                                                                                               | 确定                                                                            |
| 12   | `已知角色名 + 空白 + 内容`，没有冒号                                                                                                        | action（全文），候选项为「dialogue（角色＝该名，text＝内容）」和 action                                                                                     | 存疑                                                                            |
| 13   | 其他行                                                                                                                                      | action（全文）。如果本场至少有一行以 △ 开头（说明这份剧本用标记写动作），则为存疑，候选项为 dialogue、action、note；否则为确定                              | 见左                                                                            |

存疑的行只生成一个段落，带 `review`。规则 10 判为存疑时，按规则 12 的方式输出：一个 action 段落（全文），候选项为「dialogue（角色＝该名，text＝冒号后的内容）」和 action。用户选择候选项后，才可能拆成多个段落，例如角色加对白。

note 类型的段落不参与元素同步，也不参与出现位置和高亮的匹配。

**原文完整性**：转换结果必须满足以下两条，engine 在写入前用断言检查，失败时整次转换按「失败」处理，不写入：

1. 原文中每个非空行，至少被一个段落的 `src.line` 引用（集标题行也算被覆盖）。
2. 正文类段落（action、parenthetical、dialogue、sound、text、note）的 `text`，必须是其 `src.line` 对应原文行的子串。

第 2 条已由[行预处理与完整性检查](2026-10-30-script-import-and-markdown-view.md#行预处理)补充：当前校验 normalizeLine 后的子串，并覆盖 production、前言、附录与结构行。

**模型调用入口**：`LlmService` 新增 `complete(modelId, { system, user }, signal): Promise<string>`，复用现有的 `prepare` 和 `run`。它以 `Context.systemPrompt` 加一条 user 消息发起调用，拼接所有 `text_delta` 后返回，不使用工具调用，单次超时沿用 60 秒。provider 错误按现有的 `connectionError` 抛出 `DomainError`。转换时使用 `ModelServicesRepository.defaults().chat` 指定的模型；默认模型为空、被禁用或不是文本模型时，视为「没有模型」，按纯规则转换，并记录一条警告。`maxOutput` 取模型能力卡中的值，没有填写时为 1024。

**文本模型只输出标签，不输出文字**，这一点必须遵守：

- 每批输入为 JSON：`{ profile, knownCharacters, lines: [{ id, text, guess, unsure }] }`。按行累计不超过 6000 个字符为一批。每批需要模型决定的存疑行，不超过 `floor((maxOutput − 400) / 20)` 行，且至少 10 行。
- 输出必须是如下 JSON（允许外面包着 ```json 代码块）：

  ```json
  {
    "decisions": [{ "id": 12, "type": "dialogue", "character": "周屿" }],
    "elements": [{ "kind": "prop", "name": "旧信封", "aliases": [], "sameAs": null }]
  }
  ```

- engine 用 zod 校验输出：
  - 只接受针对存疑行 id 的决定，其他 id 一律丢弃。
  - type 为 dialogue 时，`character` 必须出现在该行开头或 `knownCharacters` 中，否则丢弃该决定。
  - 元素的 `name` 和每个别名必须在本批原文中逐字出现，否则丢弃。每批最多接受 30 个元素。
  - 只有存在存疑行的批次才调用模型，所以没有存疑行的剧本不提取道具和服装。这是为了控制调用次数而接受的取舍，用户可以手动标记道具和服装。
  - match 阶段先执行规则同步，再写入模型提取的元素。`sameAs` 按名称和别名，在同类元素中解析（包括本次同步新建的元素）。解析成功时，新元素写入 `suggestedMergeInto`。模型提取的元素如果与已有元素同名，或者在 `ignored` 中，就跳过。
- 应用决定：type 为 dialogue 时，生成 character 段落（文本为该角色）和 dialogue 段落。如果原文行以「角色名 + 空白或冒号」开头，dialogue 的文本是其后的内容，否则是整行。其他 type 只改变该段的类型。被决定的行清除 `review`。模型的输出永远不会成为段落文字，所以原文完整性不依赖模型的表现。
- 输出不是合法 JSON，或者校验失败时，附上「上次输出不是有效 JSON」的提示，重试一次；仍然失败，就把该批按规则结果处理，并记录一条警告。遇到 provider 错误（鉴权、网络、限流）时，本次转换剩余的批次都不再调用模型，并记录一条警告。
- 模型调用在项目串行队列之外进行，只有最后的写入进入队列。整个 engine 同一时刻只运行一个转换，其他转换排队。

**状态与恢复**：

- 转换状态只存在 engine 内存中，结构为 `ConversionState = { status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled', stage: 'split' | 'classify' | 'extract' | 'match' | null, done, total, warnings: string[], error: string | null, result: { scenes, blocks, unsure, addedElements } | null }`。其中 `done` 和 `total` 是已处理和总共的模型批次数。最近一次状态一直保留，直到下一次导入或 engine 重启。每次状态变化时，通过 EventBus 发布 `{ type: 'script.conversion.updated', projectId, episodeId }`。
- 发起导入时，engine 先把原文写入 `pendingImport`，revision 加 1。转换成功后，在一次写入中完成以下改动：把 `pendingImport` 移到 `source`，替换 `document.blocks`，写入 `convertedAt`，revision 加 1。
- 取消、失败或者 engine 重启后，`pendingImport` 都保留，剧集显示「导入未完成」，可以继续转换或丢弃。这就是转换的持久化方式，不建 SQLite 表。
- 转换运行期间，该集的 `PUT script` 返回 409 `SCRIPT_CONVERTING`。
- 发起导入时，如果项目设定不完整，请求必须带上 `profile`，engine 先写回清单；否则返回 422 `PROJECT_PROFILE_REQUIRED`。

### 接口

所有路径都在 engine 的 `/projects/:id` 下。请求体和响应体的 schema 都放在 `packages/contracts/src/scripts.ts`；项目设定和页面字段的 schema 放在 `projects.ts`。

| 能力           | 接口                                                          | 说明                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新建项目       | `POST /projects`                                              | 请求体新增可选字段 `profile`                                                                                                                                                                      |
| 保存项目设定   | `PUT /projects/:id/profile`                                   | 请求体为 `ProjectProfile`，返回清单                                                                                                                                                               |
| 新建创作页     | `POST /projects/:id/pages`                                    | 请求体新增可选字段 `episodeId`                                                                                                                                                                    |
| 修改创作页     | `PATCH /projects/:id/pages/:pageId`                           | 请求体为 `{ name?, episodeId?: uuid \| null }`，至少带一个字段                                                                                                                                    |
| 剧集列表       | `GET /projects/:id/episodes`                                  | 返回 `EpisodeSummary` 加 `{ conversion: ConversionState \| null, pending: number }`                                                                                                               |
| 新建剧集       | `POST /projects/:id/episodes`                                 | 请求体为 `{ number, title }`，集号重复时返回 409 `EPISODE_NUMBER_CONFLICT`；同时创建空剧本，revision 为 1                                                                                         |
| 修改剧集       | `PATCH /projects/:id/episodes/:episodeId`                     | 请求体为 `{ number?, title? }`                                                                                                                                                                    |
| 删除剧集       | `DELETE /projects/:id/episodes/:episodeId`                    | 转换运行中时返回 409 `SCRIPT_CONVERTING`                                                                                                                                                          |
| 读取剧本       | `GET /projects/:id/episodes/:episodeId/script`                | 返回 `ScriptFile` 加 `{ conversion }`                                                                                                                                                             |
| 保存剧本       | `PUT /projects/:id/episodes/:episodeId/script`                | 请求体为 `{ revision, document }`，返回 `{ revision, addedElements }`                                                                                                                             |
| 导入剧本       | `POST /projects/:id/episodes/:episodeId/script/import`        | 请求体为 `{ revision, text?, profile? }`；不带 `text` 时使用已有的 `pendingImport`，两者都没有时返回 422 `SCRIPT_IMPORT_EMPTY`；revision 不一致时返回 409；返回 202 和 `{ revision, conversion }` |
| 取消转换       | `POST /projects/:id/episodes/:episodeId/script/import/cancel` | 中止转换，保留 `pendingImport`                                                                                                                                                                    |
| 丢弃导入       | `DELETE /projects/:id/episodes/:episodeId/script/import`      | 清空 `pendingImport`；转换运行中时返回 409                                                                                                                                                        |
| 读取设定库     | `GET /projects/:id/story`                                     | 返回 `{ revision, elements, ignored }`。`elements` 中每项额外带两个字段：`mentions`（全部出现次数）和 `episodes: [{ episodeId, scenes }]`（该集内出现的不同场数）                                 |
| 出现位置       | `GET /projects/:id/story/elements/:elementId/occurrences`     | 返回最多 200 条 `{ episodeId, blockId, sceneId, excerpt（≤ 80 个字符） }`                                                                                                                         |
| 新建元素       | `POST /projects/:id/story/elements`                           | 请求体为 `{ kind, name }`，状态为 confirmed；名称冲突时返回 409 `ELEMENT_NAME_CONFLICT`                                                                                                           |
| 修改元素       | `PATCH /projects/:id/story/elements/:elementId`               | 请求体为 `{ name?, aliases?, description?, attrs?, status? }`                                                                                                                                     |
| 合并元素       | `POST /projects/:id/story/elements/:elementId/merge`          | 请求体为 `{ into }`，两者必须同类，否则返回 422；源元素的名称和别名并入目标元素的别名，然后删除源元素                                                                                             |
| 忽略或删除元素 | `DELETE /projects/:id/story/elements/:elementId`              | 删除元素，并把名称和别名写入 `ignored`                                                                                                                                                            |
| 恢复已忽略     | `POST /projects/:id/story/ignored/restore`                    | 请求体为 `{ kind, name }`，恢复后对所有剧本执行一次同步                                                                                                                                           |
| 批量操作       | `POST /projects/:id/story/batch`                              | 请求体为 `{ ids（≤ 500 个）, action: 'confirm' \| 'ignore' }`                                                                                                                                     |

### 界面

**项目库与项目设定**

- 新建项目对话框中加一个默认收起的折叠区「项目设定（可选）」。字段依次为：
  - 内容形式：单选卡片；
  - 制作媒介：单选卡片；
  - 题材：多选 chip，最后一个是「+ 自定义」，点击后变成行内输入框，回车添加；自定义 chip 可以删除；最多 5 个，超出时提示；
  - 画幅：单选。

  折叠区底部说明：「设定用于剧本识别与后续出图风格，可随时在项目设定中修改；未填写时会在首次导入剧本时询问。」

- 同一组字段做成 `ProfileFields` 组件，在三个地方复用：项目卡片菜单「项目设定」、项目详情页标题旁的齿轮按钮「项目设定」，以及导入对话框（精简为必填的内容形式、制作媒介、题材）。
- 项目卡片日期下方显示一行设定摘要，例如「短剧 · 真人实拍 · 都市/悬疑 · 9:16」，空字段跳过；没有设定时显示「未设置项目设定」。

**项目详情**

- 路由为 `/projects/$projectId?tab=episodes|pages|story|assets`，默认 `episodes`。Tab 依次为：剧集、创作页、设定库、项目资产。
- 从项目卡片、侧栏项目行和新建项目后进入时，`tab=episodes`；从画布面包屑返回时，`tab=pages`；从剧本页面包屑返回时，`tab=episodes`。
- 剧集 Tab 使用列表视图，列为：集号、标题、剧本状态、场次、字数、待确认（黄色徽标）、更新时间、「…」菜单（修改集号和标题、在本集新建创作页、删除）。
  - 剧本状态：空、排队中、转换中（带旋转图标）、导入未完成、转换失败、已结构化。
  - 点击一行进入该集的剧本页。
  - 空状态：使用 `Clapperboard` 图标，文案为「还没有剧集」和「新建第一集，粘贴剧本即可自动拆分场次并提取人物、场景」。
- 新建剧集对话框：集号默认为当前最大集号加 1，可以修改，重复时在字段下方报错；标题选填。创建后直接进入剧本页。
- 创作页 Tab 沿用现有实现。新建或重命名创作页的对话框增加「所属剧集」下拉框（含「不属于任何剧集」）；卡片显示所属剧集。
- 设定库 Tab 见下文。删除剧集的确认框写明：「剧本将移入项目回收区保留 30 天，所属创作页保留并改为未分集」。

**侧栏项目树**

项目展开后，先列出剧集「第 N 集 标题」，每一集可以再展开，子项为「剧本」和本集的创作页；然后列出未分集的创作页，样式与现在一致。没有剧集也没有创作页时，显示「无内容」。

**剧本页**

- 路由为 `/projects/$projectId/episodes/$episodeId?block=<BlockId>`。主区不使用点阵背景，由页面自己控制滚动（复用外壳的 fullBleed 判断）。顶部是面包屑「项目库 / 项目 / 第 N 集 标题」。
- 剧本没有任何段落，也没有 `pendingImport` 时，显示两张卡片：「粘贴整集剧本」（主选项）和「从空白开始写」。选择后者时，插入一个空的场标题段落并聚焦。
- 有 `pendingImport`、但没有运行中的转换时，顶部显示一条提示，带「继续转换」「编辑原文」「丢弃」三个按钮；转换失败时，同时显示错误信息。
- **导入对话框**：
  - 宽度 720px，主体是等宽字体的文本框，显示字数，上限 200000 字。
  - 项目设定不完整时，文本框上方显示黄色提示条，内嵌必填的精简设定字段；设定完整时，只显示一行「按『短剧 · 真人实拍』识别」，旁边有「修改」。
  - 显示默认文本模型的名称；没有默认文本模型时，提示「未设置默认文本模型，将仅按规则识别，可在 设置 → 默认模型 中配置」。
  - 已有段落时，「开始转换」前要先确认「将替换本集全部段落，设定库元素保留」。
  - 发起导入前，先完成编辑器的保存。
- **转换进行中**：
  - 编辑区显示骨架屏，并锁定编辑。
  - 顶部显示进度条，阶段文字为切分场次、识别段落类型、提取人物与场景、匹配设定库，附计数「已处理 k / n 批」，并提供「取消」按钮。
  - 进度通过 `/events` 事件刷新，不轮询。
  - 完成后，编辑区上方显示一条提示（`role="status"`，不使用 toast）：「已识别 7 场、60 段，新增 10 个待确认元素」，附「查看」按钮，点击后打开右栏；有警告时显示「部分内容按规则识别」，并可以展开查看原因。
- **编辑器**分三栏，栏宽依据主区容器宽度变化（使用 container query）：
  - **左栏：场次大纲**，宽 220px，可以折叠。
    - 按幕分组，每行显示场号、「日 · 内」、地点，以及最多 3 个人物缩写，多余的显示 +N。
    - 点击某一场，编辑区平滑滚动到该场；编辑区滚动时，大纲同步高亮当前场。
    - 场可以拖拽排序；键盘可以用场菜单中的「上移」「下移」。
    - 底部有「+ 新增场」。
  - **中栏：纸面**，最大宽度 760px，居中，正文 15px、行高 1.8。各类型的排版：
    - 幕：居中、加粗，上下有分隔线；
    - 场标题：加粗，前面依次是场号徽标、可点击切换的时间 chip 和内外 chip，然后是地点；
    - 出场人物：小字，前缀为「人物：」；
    - 角色：居中、加粗，角色名使用人物标签色，后面显示 delivery chip；
    - 括注：居中、斜体，括号由样式补上；
    - 对白：左右各缩进 15%；
    - 音效：以喇叭图标开头；
    - 字幕：前面加小标签「字幕」；
    - 转场：右对齐；
    - 注释：`muted` 底色的块，前面加便签图标。
  - **右栏：本集元素**，宽 280px，可以折叠。
    - 顶部是分段控件「人物」「场景」「道具」「服装」，各带数量，待确认的数量另用黄色标出。
    - 每行显示色点、名称、别名、出现的场号，以及状态。
    - 点击某一行，编辑区高亮该元素的所有出现位置，并显示「第 i 处 / 共 n 处」以及上一处、下一处按钮。
    - 待确认的行提供「确认」「合并到…」「忽略」三个操作；带 `suggestedMergeInto` 的行直接显示「合并到 X？」。
    - 底部有「在设定库中管理」。
  - 主区宽度小于 1100px 时，右栏改为覆盖式抽屉；小于 860px 时，大纲也改为抽屉。在 720×560 的窗口中，工具栏放不下的按钮收进「更多」菜单。
- **工具栏**（吸顶）依次为：段落类型下拉框、撤销、重做、重新导入、查看原文（只读抽屉；没有 `source` 时禁用）、保存状态（`role="status"`，文字依次为「保存中…」「已保存，元素已同步」「保存失败」「已被外部修改」；元素同步在 engine 保存时完成，所以不另设匹配状态）、大纲开关、元素栏开关、快捷键帮助「?」。
- **键盘规则**（全部列在快捷键帮助中）：
  - 光标在段落中间时按 Enter，拆分该段，后半段与当前段同类型，不带 `review` 和 `src`。
  - 光标在段落末尾时按 Enter，新建下一段，类型取决于当前段：act → scene，scene → action，cast → action，action → action，character → dialogue，parenthetical → dialogue，dialogue → action，sound → action，text → action，transition → scene，note → action。
  - 在类型不是 action 的空段落中按 Enter，把该段改为 action，不新建段落。
  - 在空段落中按 Tab 或 Shift+Tab，按以下顺序循环切换类型：action → character → dialogue → parenthetical → scene → transition → sound → text → note → cast → act → action。在非空段落中按 Tab 不做任何操作，焦点也不离开编辑器。
    此处原循环及类型菜单的幕入口，由[幕与类型切换](2026-10-30-script-import-and-markdown-view.md)部分取代：当前幕通过大纲插入，循环包含 production 并排除 act。
  - Ctrl+1～9 直接设为：1 scene，2 action，3 character，4 parenthetical，5 dialogue，6 sound，7 text，8 transition，9 note。
  - 在 action 段落中按 Enter 时，如果该段文本能被 `parseSceneHeading` 识别，并且至少有一个时间或内外词，就把它转为 scene 段落（文本为地点），再新建下一段。
  - 在 character 段落中按 Enter 时，解析文末的（OS）（VO）（画外音）（旁白）（内心）后缀，写入 delivery。
  - 输入 character 段落时，弹出设定库人物的自动补全，按名称和别名匹配，支持方向键和回车；最后一项是「新建人物：xxx（待确认）」，选择它只是写入文本，元素在保存时由同步创建。
  - 在段落开头按 Backspace，与上一段合并（ProseMirror 的默认行为）。
  - Ctrl+Z 撤销，Ctrl+Shift+Z 和 Ctrl+Y 重做。
  - Alt+↑ 和 Alt+↓ 上下移动当前段落。
- **段落手柄**：鼠标悬停时，段落左侧出现手柄，显示该段类型的缩写。点击手柄打开类型菜单，按住可以拖动排序。
- **存疑段落**：左侧显示 2px 黄色竖条，行尾有「存疑」徽标。点击徽标打开浮层，显示原因、原文行，以及各候选项按钮，例如「改为对白（角色：周屿）」「保持动作」。
- **元素高亮**：正文中与元素匹配的词显示淡色下划线，四类元素分别用 pink、orange、blue、indigo 标签色。悬停时显示卡片（名称、类别、状态、出现次数），按住 Ctrl 点击，在右栏打开该元素。
  此处默认行为由[元素高亮](2026-10-30-script-import-and-markdown-view.md#元素高亮)部分取代：当前默认关闭全部标记，只突出选中元素；工具栏可开启全部标记。
- **选中文字**时，弹出浮动工具条：「标记为人物」「标记为道具」「标记为服装」「添加注释」。前三项调用新建元素接口，选中的文本必须为 1–40 个字符；最后一项在当前段之后插入一个 note 段落。
- 多行纯文本粘贴到编辑器时，按行拆成多个段落，类型与当前段相同；当前段是 scene 时，拆出的段落改为 action。
- 编辑停止 1 秒后自动保存。离开路由或关闭窗口时，先等待保存完成（与画布宿主相同）。遇到 409 时，显示「重新加载」和「复制全文」（把纯文本复制到剪贴板）。
- 打开带 `?block=` 的路由时，滚动到该段落并短暂高亮。

**设定库 Tab**

- 左侧是分类导航（人物、场景、道具、服装，各带数量）。顶部有搜索框，以及筛选：全部、待确认、已确认、已忽略。
- 主体是卡片宫格。每张卡片包括：占位缩略图（分类图标加文字「参考图（后续支持）」）、名称、别名 chip、「第 1 集 ×3 场 · 第 2 集 ×1 场」，以及状态徽标。
- 点击卡片，从右侧打开抽屉。抽屉复用 `@frame-loom/ui` 的 Dialog，只把内容定位到右侧，不新增组件。抽屉内容：
  - 可编辑的名称、别名、描述，以及该类别的专属字段：人物有性别、年龄段、外貌、性格，场景有内外、常见时段；
  - 「出现位置」列表，按集分组，每条显示一行摘录，点击后跳到剧本页的 `?block=`；
  - 底部操作：确认、合并到…、删除（确认框写明「剧本文字不受影响，该名称将加入已忽略」）。
- 支持批量模式：勾选多张卡片后，可以批量确认或批量忽略。「已忽略」筛选下，每一项提供「恢复」。

### 代码位置

| 内容                                             | 位置                                                                                                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 项目设定、剧集摘要、页面 `episodeId` 的 schema   | `packages/contracts/src/projects.ts`                                                                                                                                                        |
| 剧本、设定库、转换状态、接口请求与响应的 schema  | `packages/contracts/src/scripts.ts`                                                                                                                                                         |
| 规则解析器、场标题解析、`findMentions`、场的推导 | `packages/contracts/src/script-parse.ts`                                                                                                                                                    |
| Markdown 渲染与回写                              | `packages/contracts/src/script-markdown.ts`                                                                                                                                                 |
| 测试用样例剧本                                   | `packages/contracts/fixtures/script-sample-01.txt`、`script-sample-02.txt`                                                                                                                  |
| 剧本与设定库文件的读写                           | `ProjectStore` 新增 `readScript`、`writeScript`、`trashScript`、`restoreScript`、`readStory`、`writeStory` 六个方法，由 `LocalProjectStore` 实现，复用其中的 `atomicWrite` 和 revision 缓存 |
| 剧集、剧本、设定库、转换                         | `apps/engine/src/modules/scripts/`，导入 `ProjectsModule` 和 `ModelServicesModule`                                                                                                          |
| 文本补全 `LlmService.complete()`                 | `apps/engine/src/modules/llm/llm.service.ts`，由 `ModelServicesModule` 导出                                                                                                                 |
| 项目设定接口、页面 `episodeId`                   | `apps/engine/src/modules/projects/`                                                                                                                                                         |
| 项目设定表单 `ProfileFields`                     | `apps/desktop/src/renderer/src/features/projects/profile-fields.tsx`                                                                                                                        |
| 剧集列表与剧集对话框                             | `apps/desktop/src/renderer/src/features/projects/episodes/`；侧栏仍在 `project-tree.tsx` 中                                                                                                 |
| 剧本页与编辑器                                   | `apps/desktop/src/renderer/src/features/projects/script/`                                                                                                                                   |
| 设定库 Tab                                       | `apps/desktop/src/renderer/src/features/projects/story/`                                                                                                                                    |

### 相关笔记核对

- [项目库](2026-10-26-project-library.md)：部分重叠。清单字段、`.frameloom` 目录、详情页 Tab 与默认 Tab、侧栏项目树、页面创建和修改的请求体，以及回收区清理已原地同步并互链。
- [主题与外壳](2026-10-24-theme-and-app-shell.md)：部分重叠。外壳的 fullBleed 判断包含剧本页路由，笔记已同步。
- [Agent 内核选型](../../proposed/architecture/2026-10-24-agent-runtime-pi.md)：相关但不重叠。`LlmService.complete()` 只在 `modules/llm` 中使用 pi-ai；Agent 的剧本工具尚未实现。
- [模型管理](../../proposed/architecture/2026-10-24-model-management.md)：相关但不重叠。转换读取默认文本模型。
- [项目标签](../../implemented/feature/2026-10-27-project-tags.md)：无重叠。内置的「人物」「场景」标签与设定库元素暂不关联。
- [剧本编辑器内核选型](../architecture/2026-10-29-script-editor-tiptap.md)：本篇的配套笔记，记录编辑器依赖的选择。
- 其余笔记与本篇无关。

## Alternatives considered

- **轻量方案：剧本自带集号，不建剧集实体**：最强的理由是改动小，项目契约、侧栏和详情页基本不动，现有页面也不受影响。没有采用：每一集以后会挂上剧本、故事板、分镜、配音等多种产物，没有剧集实体，这些产物就没有明确的归属。等以后再改成剧集实体，就要迁移已有的用户数据，而项目格式只能向前迁移。
- **剧集持有 `pageIds[]`**：最强的理由是剧集内的页面顺序可以自定义。没有采用：这样页面与剧集的关系有两个来源，旧版本应用删除页面时不会同步更新 `pageIds`；用页面上的 `episodeId` 作为唯一来源，不会出现不一致。
- **以纯文本为准，每次编辑后重新解析**：最强的理由是用户可以像写 Word 一样随意输入，解析器就是唯一的转换逻辑。没有采用：每次重新解析都会重新分配段落 id，后续故事板和分镜对剧本位置的引用就会失效。
- **嵌套结构（幕 → 场 → 段落）**：最强的理由是结构一目了然，下游按场读取不需要推导。没有采用：编辑器中跨场拆分、合并和拖动都要处理嵌套节点的边界；扁平的段落列表与 Tiptap 文档一一对应，场可以用 O(n) 的扫描推导出来。
- **段落内用行内标记存元素 id**：最强的理由是出现位置精确，同名的不同人物也能区分。没有采用：合并、改名或忽略元素时，要改写所有剧本文件，还会与正在编辑的剧本产生 revision 冲突；第一期按名称匹配就够用，同名区分留给以后。
- **模型直接输出结构化剧本（含文字）**：最强的理由是实现最简单，模型还能修正格式。没有采用：模型可能漏句、改台词，用户无法相信转换结果；只让模型输出标签，原文完整性靠构造本身保证。
- **转换状态存 SQLite 表**：最强的理由是 engine 重启后能显示准确的进度和错误。没有采用：重启后转换不会自动续跑，用户需要的只是「有一份未完成的导入」，这个状态已经由 `pendingImport` 持久化在项目文件夹里。
- **创建项目时强制填写项目设定**：最强的理由是下游功能总能拿到设定。没有采用：会增加新建项目的门槛，用户可能还没想好；首次导入时再要求填写，既能保证转换拿到设定，又不打扰只用画布的用户。
- **只在导入时选择设定，不存入项目**：最强的理由是项目功能不用改动。没有采用：设定会散落在每一集里，各集之间可能互相矛盾，而出图、画幅这些下游功能需要的是项目级常量。

## Testing

以下行为已有自动化覆盖；全仓测试 1025 项通过，后续剧本定向测试 70 项、相关 7 个 e2e 文件 9 条通过。构建、类型、lint、格式与笔记计划校验均通过。测试使用模拟模型，不调用真实模型。

1. contracts：
   - 旧清单（没有 `profile` 和 `episodes`）能正常解析，重新写出后不丢失未知字段；
   - 剧集的 id 和集号唯一性、各项上限、`BlockId` 唯一性、段落文字不能含换行，均有正反例测试；
   - 样例剧本 `script-sample-01.txt`（47 个非空行，内容为原型附录中的示例剧本）经规则解析后，得到 60 个段落，各类型数量为：act 2、scene 7、cast 7、action 14、character 11、dialogue 11、parenthetical 3、sound 2、text 1、transition 2；存疑段落恰好是「周屿 你这几年还好吗」「小林啊，别想了，睡吧。」「（闪回）」这三行；原文完整性检查通过。
2. engine 集成测试（真实 SQLite、临时目录、`mockUpstream`）：
   - 剧集的增删改，以及删除后剧本进入回收区、页面变为未分集；
   - 剧本 409 冲突，包括外部修改文件；
   - 没有默认文本模型时，按规则转换并生成 10 个待确认元素：人物 4 个（林夏、周屿、店主、陌生男人），场景 6 个（旧书店、书店门口、林夏家·卧室、街道、林夏家·客厅、天台）；
   - 使用模拟模型时，标签被应用，模型夹带的文字和不在原文中的元素名被丢弃；
   - 非法 JSON 重试一次后按规则处理；provider 错误后不再调用模型；
   - 取消转换后剧本段落不变，`pendingImport` 保留；转换期间保存返回 409；
   - 设定库的合并、忽略、恢复、批量操作，以及跨集出现位置；
   - 回收区中超过 30 天的剧本被清理。
3. desktop 单元测试：
   - 剧本文档与编辑器 JSON 往返转换无损；
   - 键盘规则表的每一条、撤销重做、存疑段落的候选项应用；
   - 元素高亮与匹配函数的结果一致；
   - 自动保存与 409、转换期间锁定编辑；
   - 题材最多 5 个、自定义题材的添加和删除；
   - 集号默认值和重复报错；详情页 search 参数非法时回退到默认值。
4. 桌面 e2e（不调用真实模型。主流程只走规则路径，转换进度的截图使用本地模拟的文本模型）：从界面新建一个不带项目设定的项目 → 新建剧集 → 粘贴样例剧本 → 导入对话框要求补填项目设定 → 转换完成并显示「7 场、60 段、10 个待确认元素」→ 处理一个存疑段落、输入一个场标题、在设定库合并元素 → 重启应用后内容保留。新建项目时填写设定的流程，由 desktop 单测和 engine 集成测试覆盖。明暗两种模式和 720×560 窗口下的截图已逐张查看。
5. 构建产物模式下（未打包时，主进程同样通过 `app://` 加载并下发 `PRODUCTION_CSP`），e2e 中剧本编辑器的输入、模拟输入法组字和拖动都正常，控制台没有 CSP 错误。本功能不改动主进程、asar 和 fuses，所以不要求另做加固目录版验收。
6. 已记录 3000 段剧本加载与连续输入 50 字的性能数据。输入法修复后的回归轮加载 3183ms，自动化按键往返均值 106.31ms，浏览器输入事件处理均值 22.20ms（不含完整绘制）；加载和自动化往返存在波动，数字不作为门禁。

## Consequences

- **收益**：项目设定、剧集、结构化剧本与设定库形成可持久化的完整流程；稳定段落 id 与原文完整性检查支持后续按位置引用，同时避免模型改写用户文字。
- **规则覆盖面有限**：中文剧本的格式五花八门，规则解析器只覆盖常见写法。没有配置文本模型时，存疑段落会较多。用户可以逐段修正，样例语料可以持续补充。
- **模型质量**：标签可能出错，但不会损坏原文；最坏情况等同于纯规则解析。
- **编辑器复杂度**：段落手柄、拖动、元素高亮和自动补全都要自己实现，是整个方案中最容易出缺陷的部分。单元测试覆盖命令层，e2e 只覆盖关键路径。
- **按名称匹配的误报**：短名称或常用词会被误标为元素。长度小于 2 的词不参与正文匹配，用户可以忽略误识别的元素。
- **旧版本应用**：旧版本保留未知字段，但看不到剧集，也不会清理 `trash/scripts`。
- **回滚**：各子计划可以分别回退。一旦用户写入剧本数据，`scripts/` 和 `story.json` 只能向前迁移；回退代码后，这些文件仍留在项目中，不影响旧功能。

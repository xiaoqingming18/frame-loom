# Agent Note: 剧本导入识别修正、前言附录与 Markdown 视图

Status: implemented

## Problem

[剧集与结构化剧本](../../implemented/feature/2026-10-29-episodes-and-structured-scripts.md)上线后，用户导入了一份真实的 Markdown 剧本《影娘》（844 行，约 3 万字），识别结果几乎不可用：

- 规则解析器生成了 488 个段落，其中 448 个是「动作」，角色和对白各只有 1 个。27 个场标题一个都没有识别出来。
- 设定库被自动写入了「反打」「**1.」「内景」「—」这类人物，以及一个「你好」场景。
- 用户把某行改成「场标题」后，这行的文字仍然是带 `**` 和时间码的原句，时间和内外属性为空。截图里这行还按「角色」的样式居中显示，并且是粉色。
- 元素下划线铺满了整个纸面，很难阅读。

根因如下：

1. **规则只覆盖了一份很规整的样例**。不认识 Markdown 标记（`**`、`#`、`>`、`-`、表格、`---`、行内代码）、「序号. 内景 地点 — 时间（附注）」加时间码的场标题、「角色名单独一行、台词在下一行」的对白写法、「冬夜」「正午」「拂晓」这类时间词，以及【镜头】【美术】这类制作提示。
2. **文本模型只处理规则标为「存疑」的行**。规则把认不出的行默认判为「确定的动作」，所以《影娘》只有 20 行交给了模型，其余 400 多行模型根本看不到。
3. **剧本没有「正文之外」的区域**。标题、梗概、美术设定、角色表、改编说明都被当成动作段落。
4. **改段落类型时不会重新解析文字**，属性也不会更新。
5. **自动创建的待确认元素不会回收**，就算对应的文字被改掉，也一直留在设定库里。
6. 元素下划线默认全部显示。

验收标准照搬了这份样例的数字，没有用真实剧本检验过。

用户另外要求：编辑器提供「样式」和「Markdown」两个可切换的视图，两边都能编辑，内容同步。

用户已确认的取舍：

1. **幕**：保留数据和原文识别，但从类型菜单、Tab 循环和快捷键中去掉，改为在大纲中「插入分幕」。
2. **正文之外的内容**：存为剧本的「前言」（第一个场或幕之前）和「附录」（正文之后），不参与分场。前言中角色表里的人物和说明直接写入设定库。
3. **【镜头】【美术】【声音】这类内容**：新增「制作提示」段落类型，保留原标签名，进入下游流程。代价是旧版本应用打不开新格式的剧本。
4. **元素高亮**：默认不显示下划线，只在元素栏中选中某个元素时高亮它的出现位置；工具栏提供开关。
5. 从《影娘》节选 172 行作为回归样例入库（`packages/contracts/fixtures/script-sample-02.txt`，SHA-256 `42d97cd102170dbeaab6bc4236b9fa97a3fcd9a1192e3ab5460bedb5fb4dc3d2`，已随本笔记提交）。
6. **Markdown 视图**：两个视图都能编辑；从 Markdown 切回样式视图时照常转换，认不出的行标为存疑，不阻止切换；默认显示样式视图，并记住上次的选择（本机偏好，不写入项目文件）；本次不做导出 Markdown 文件。
7. 继续坚持「模型只输出标签，不输出文字」。配置了文本模型时，所有正文行都交给模型判断。

## Decision

### 范围

本次只修改剧本的导入、编辑和设定库同步。剧集、项目设定和设定库 Tab 的现有行为不变，除非下文明确写出。

### 数据格式

`ScriptFile.formatVersion` 仍为 1。`ScriptDocument` 从 `schemaVersion` 1 升级到 2：

```ts
ScriptDocument = {
  schemaVersion: 2,
  preface: string（≤ 50000 个字符，Markdown 原样保存）,
  appendix: string（≤ 50000 个字符）,
  blocks: ScriptBlock[]（最多 5000 个，规则不变）,
}
BlockType 新增 'production'（制作提示，缩写「制」）
SceneAttrs = {
  time, space,                     // 含义不变
  timeText: string | null,         // ≤ 20 个字符，原文中的时间词，例如「冬夜」「正午」「冬，拂晓」
  note: string | null,             // ≤ 40 个字符，场标题末尾括号里的内容，例如「多年以后」「续」「蒙太奇」
  timecode: string | null,         // ≤ 40 个字符，例如「00:00–00:35」
}
CharacterAttrs = { delivery, extension: string | null }   // extension ≤ 80 个字符，角色名后括号里的原文，例如「画外，从墙上传来」
TagAttrs = { label: string（1–8 个字符） }               // sound 和 production 使用；sound 的 label 例如「音效」「音乐」
```

- attrs 与类型的对应关系：scene 用 `SceneAttrs`（必填），character 用 `CharacterAttrs`（必填），sound 和 production 用 `TagAttrs`（必填），其他类型不允许有 attrs。
- **读取 v1 时自动迁移，写入一律为 v2**：
  - `preface` 和 `appendix` 设为空字符串；
  - scene 的 `timeText`、`note`、`timecode` 补为 null；
  - character 的 `extension` 补为 null；
  - 没有 attrs 的 sound 补为 `{ label: '音效' }`。

  迁移写在 `ScriptDocument` schema 中（参照 `CanvasDocument` 的 transform 写法），engine 和 desktop 都只调用这一个 schema。
- `production` 的 `text` 是标签之后的内容。它属于「正文类」：参与原文完整性检查、元素匹配和下游流程。
- 新增本机偏好：`DesktopPreferences` 加入 `scriptView: 'styled' | 'markdown'`（缺省为 styled）和 `scriptMentions: boolean`（缺省为 false），读写沿用现有的 `preferences:get` 和 `preferences:set`，主进程代码不需要修改。

### 行预处理

所有识别都先经过 contracts 中的 `normalizeLine(line)`，返回 `{ kind, content, boldHead, boldRest }`：

1. 去掉行首行尾的空白。下面几种行是「结构行」，不生成段落，但计入原文覆盖：
   - 分隔线：`^(-{3,}|\*{3,}|_{3,})$`；
   - 表格分隔行：只由 `|`、`:`、`-` 和空白组成，并且至少包含 `---`；
   - 区域标记：整行恰好是 `<!-- 正文 -->` 或 `<!-- 附录 -->`。
2. 识别行类型 `kind`，并去掉对应的前缀：
   - `^#{1,6}\s+` → heading；
   - `^>\s?` → quote；
   - `^[-*+]\s+` → list；
   - 以 `|` 开头并以 `|` 结尾 → table（不去前缀）；
   - 其余 → plain。
3. `boldHead` 和 `boldRest`：去掉前缀后，如果剩余部分匹配 `^\*\*([^*]+)\*\*(.*)$`，那么 `boldHead` 是第一组内容去掉首尾空白后的结果，`boldRest` 是第二组去掉反引号和首尾空白后的结果；不匹配时两者都为 null。
4. `content`：去掉前缀后，删除所有 `**`、`__` 和反引号，再去掉首尾空白。

**原文完整性检查改为**：正文类段落（action、parenthetical、dialogue、sound、text、note、production）的 `text`，必须是 `normalizeLine(原文行).content` 的子串。第 1 条规则（每个非空行都被覆盖）不变；前言、附录和结构行也算被覆盖。

### 前言与附录

- **区域标记优先**：原文中有 `<!-- 正文 -->` 行时，第一个这样的行之前的全部内容就是前言，不再自动判断前言。有 `<!-- 附录 -->` 行时，第一个这样的行之后的全部内容就是附录，不再自动判断附录。Markdown 视图渲染时会写出这两个标记，保证往返之后区域边界不变。用户粘贴的原文一般没有这两个标记，按下面的规则自动判断。
- **前言**：第一个被识别为幕（规则 3）或场标题（规则 4）的行之前的所有行，原样拼接（去掉末尾的空行）。整份原文都没有幕和场标题时，没有前言，全部按正文处理。
  无边界时不自动推断附录，方头括号中文场标题的兼容及复现见[空正文修复](../bug-fix/2026-10-30-script-empty-body.md)。
- **附录**：正文中第一个满足以下条件的行，从它开始到文末全部为附录（原样拼接）：
  - `kind` 为 heading；
  - 不是幕，也不是场标题；
  - 它之后再没有幕或场标题。
- 正文中其他的 heading 行，生成 note 段落（确定）。
- **角色表入库**：在前言中查找 Markdown 表格，表头第一格（去掉 `**`）为「角色」「人物」「姓名」「角色名」之一的才算角色表。逐行处理数据行：
  - 第一格是名称（去掉 `**` 和空白），第二格是说明；
  - 名称为「其他」「其它」「其余」时，把说明按 `[、，,；;]` 切分，每个名字去掉末尾的 `。．.` 和空白，各自建为**待确认**人物，不带说明；
  - 其余名称建为**已确认**人物，说明写入 `description`（截断到 2000 个字符）；
  - 名称不满足 `ElementName` 的跳过；在 `ignored` 中的跳过；
  - 名称或别名与已有人物相同时，不新建，只在对方 `description` 为空时补上说明，状态不变。

  这一步在转换的 match 阶段执行，排在规则同步之前，新增数量计入 `addedElements`。

### 规则解析器（替换原规则表）

先做一遍预扫描，收集「已知名字」，来源有三个：前言角色表里的全部名字（包括「其他」行）、正文中所有出场人物行、所有满足规则 12 的粗体角色行。正文中满足规则 12 的行达到 3 行及以上时，认为这份剧本使用「独立角色行」的写法。

对正文中的每一行按以下顺序判断，命中第一条就停止：

| 顺序 | 条件（基于 `normalizeLine` 的结果） | 结果 | 置信 |
| --- | --- | --- | --- |
| 1 | 空行 | 跳过 | — |
| 2 | 结构行；或者 `content` 匹配 `^第\s*[0-9一二三四五六七八九十百]+\s*集` | 不生成段落，计入覆盖 | 确定 |
| 3 | `content` 匹配 `^第[0-9一二三四五六七八九十]+幕` 或 `^ACT\s+\S+` | act，text 为 content | 确定 |
| 4 | 场标题，见下文「场标题解析」 | scene | 见下文 |
| 5 | `kind` 为 quote | note，text 为 content | 确定 |
| 6 | `kind` 为 table | note，text 为 content | 确定 |
| 7 | `kind` 为 heading（规则 3、4 以外，且不是附录的开头） | note，text 为 content | 确定 |
| 8 | `content` 匹配 `^(人物\|出场人物\|角色)[:：]` → cast（同原规则）；匹配 `^(字幕\|画面字幕\|屏幕文字\|黑屏字幕)(:\|：)(.*)$` → text，去掉前缀 | 见左 | 确定 |
| 9 | `content` 以 `△▲※` 开头 | action，去掉标记 | 确定 |
| 10 | `content` 匹配 `^【(音效\|音乐\|BGM\|音\|配乐)】(.*)$` 或 `^\[(音效\|SFX)\]\s*(.*)$` | sound，label 为括号内文字（`[音效]` 和 `[SFX]` 的 label 都记为「音效」），text 为后面的内容 | 确定 |
| 11 | `content` 匹配 `^【([^】]{1,8})】(.*)$` | production，label 为括号内文字，text 为后面的内容（可以为空） | 确定 |
| 12 | **独立角色行**：`kind` 为 plain；下一行（原文中的下一行）不为空；并且满足以下两种情况之一：一是 `boldHead` 是合法名字，`boldRest` 为空或是一整个括号（全角或半角括号包住全部内容，括号内不含括号）；二是没有粗体，`content` 等于某个已知名字，或等于「已知名字＋一整个括号」 | character：text 为名字，`extension` 为括号内文字（没有括号时为 null），`delivery` 从 extension 推导（含「画外」「OS」→ os，含「旁白」「VO」→ vo，含「内心」「心声」→ inner，否则为 null）。然后把紧随其后的每一个非空行纳入这一组，直到遇到空行、结构行、幕或场标题为止：整行是括号的生成 parenthetical（text 为括号内文字），其余生成 dialogue（text 为 content） | 确定 |
| 13 | `content` 匹配 `^(切至\|切到\|切入\|硬切\|叠化\|淡入\|淡出\|划入\|划出\|转场\|黑场\|CUT TO\|FADE IN\|FADE OUT\|DISSOLVE TO)`，且 `content` 不超过 12 个字符 | transition，text 为 content | 确定 |
| 14 | `content` 整行是括号，括号内是转场词（闪回、回忆、切至、切到、叠化、淡入、淡出、转场） | transition（同原规则 9） | 存疑 |
| 15 | `kind` 为 list | action，text 为 content，**不做对白识别** | 确定 |
| 16 | `kind` 为 plain，`content` 匹配 `^NAME([（(][^）)]*[）)])?[:：]\s*(\S.*)$`，冒号后的内容去掉空白后不为空，并且 NAME 不是停用词 | 名字是已知名字时：character（NAME 后面的括号内文字写入 `extension`，`delivery` 的推导方式同规则 12），再拆出 parenthetical（如有）和 dialogue（同原规则 10），确定；不是已知名字、但这份剧本使用独立角色行写法时：action（全文），候选项为 dialogue（角色＝NAME，text＝冒号后的内容）和 action，存疑；其余情况沿用原规则 10（NAME 超过 4 个字符时存疑） | 见左 |
| 17 | 整行是括号，上一段是 character、parenthetical 或 dialogue | parenthetical | 确定 |
| 18 | 整行是括号（其他情况） | note，text 为 content | 确定 |
| 19 | 以「已知名字＋空白＋内容」开头，没有冒号 | 同原规则 12 | 存疑 |
| 20 | 其他行 | action，沿用原规则 13（本场有以 △ 开头的行时存疑） | 见左 |

- **合法名字**：1–12 个字符，不包含空白、冒号、括号，也不包含 `，。！？、；“”"'…—·`。
- **停用词**：时间、地点、人物、字幕、备注、注、反打、特写、近景、中景、远景、全景、镜头、画面、场景、片名、景别，以及规则 13 中的全部转场词。
- 规则 12 的分组规则替代了原来的「括注只跟在对白后面」的判断。

**场标题解析** `parseSceneHeading(line)`：输入为原文行，返回 `{ time, space, timeText, note, timecode, location, confident } | null`。

0. `normalizeLine` 的 `kind` 为 empty、structure、list、quote、table 时，直接返回 null。列表项「- 第一任新主人刷了一遍石灰」不能被当成场标题。
1. 先取 `normalizeLine` 的结果。如果 `boldRest` 是时间码，或者 `content` 末尾是时间码，就把时间码取出来，放进 `timecode`。时间码的格式为 `\d{1,2}:\d{2}(:\d{2})?\s*[–—\-~～至]\s*\d{1,2}:\d{2}(:\d{2})?`，前后可以有反引号。之后待解析的文字 H 这样确定：有 `boldHead` 时取 `boldHead`；否则取 `content` 去掉末尾时间码之后的部分。
2. 满足以下任一形式，才算场标题：
   - **A**：H 以原有的前缀开头，即 `\d+[-－—.]\d+`、`第N场`、`场景N`、`场N`、`INT`、`EXT`；
   - **B**：H 以 `\d+[.、．]\s*` 开头，并且其后的部分去掉末尾括号、按空白和破折号切词后，至少有一个词恰好是内外词，或者恰好是时间词集中的词。时间词集为：日、白天、夜、夜晚、晨、清晨、昏、黄昏、傍晚、正午、中午、上午、下午、午后、拂晓、黎明、凌晨、深夜、阴天；
   - **C**：有 `boldHead`，并且 `boldHead` 以 `\d+[.、．]` 开头，或者有时间码；同时不满足规则 12。
3. 从 H 中去掉序号或前缀后，如果剩余部分以一整个全角或半角括号结尾，就把括号内的文字放进 `note`。然后按 `\s*[—–－]+\s*` 或 ` - ` 切成两部分：前半部分按空白（包括全角空格）切词，其中的内外词决定 `space`，其余的词用一个空格连起来作为 `location`；后半部分整体作为 `timeText`。没有破折号时，逐词判断：恰好是内外词的决定 `space`，恰好是时间词集中的词作为 `timeText`，其余的词用一个空格连起来作为 `location`。
4. **内外词**：内景、内 → int；外景、外 → ext；内景／外景、外景／内景、内外、INT./EXT → intext；INT → int；EXT → ext。
5. **时间映射**：`timeText` 按以下顺序判断，命中第一条就停止：
   1. 含「夜」→ night；
   2. 含「黄昏」「傍晚」「日落」「昏」→ dusk；
   3. 含「拂晓」「黎明」「清晨」「凌晨」「晨」「早」→ dawn；
   4. 含「日」「白天」「正午」「中午」「午」「上午」「下午」「阴天」「晴」→ day；
   5. 都不含时为 null。
6. 有 `space` 或 `time` 时为确定。否则为存疑，候选项为 scene、action、note。

**原样例 `script-sample-01.txt` 的结果保持不变**：60 个段落，各类型数量不变，3 处存疑不变。区别只有两点：「第1集 重逢」现在进入前言；sound 段落带上了 label。

### 转换

- **classify 阶段**：配置了文本模型时，**所有正文行**都交给模型，规则的结果放在 `guess` 字段中，存疑行带 `unsure: true`。批次大小与原规则相同：按行累计不超过 6000 个字符，每批的行数不超过 `max(10, floor((maxOutput − 400) / 20))`。
- 提示词要求模型**只为需要改变 guess 的行返回 decision**。模型没有返回 decision 的行视为认可 guess，存疑行的 `review` 随之清除。provider 错误或两次输出都不合法的批次，按规则结果处理，保留 `review`，并记录一条警告。
- 可以对任意一行做出决定，不再限于存疑行。type 可以是全部 12 种类型。同一原文行生成的所有段落，作为一个整体被替换：
  - 新段落用 `retypeLine(normalizeLine(原文行), type, character?)` 生成，规则与下文「段落类型切换」相同；
  - type 为 dialogue 时：如果原文行以「角色名＋空白或冒号」开头，就生成 character 和 dialogue 两个段落，dialogue 的文本是其后的内容；否则只生成 dialogue（文本为 content）。只在决定带有 character、并且前一个段落不属于同一角色的对白组（该角色的 character 段落，以及紧随其后的 parenthetical 和 dialogue）时，才在 dialogue 前面补一个 character 段落；
  - 原文行中第一个正文类段落的 id，由新结果中承载内容的那个段落沿用。
- 角色合法性和元素名称的校验不变。所有批次都会提取元素，因此道具和服装不再依赖于是否存在存疑行。
- 更新 `conversion-prompt.ts`：说明 12 种类型的含义（包括 production 以及它的 label），说明 `guess` 字段，要求「只返回需要改变的行」。

### 设定库同步与清理

- 规则同步时，跳过带 `review` 的段落。
- **待确认元素清理**：每次保存剧本、每次转换完成后，都执行一次。删除同时满足以下两个条件的待确认元素：
  - 在所有剧集的段落中（不含 note）都没有出现；
  - 在所有剧集的前言和附录中，名称和别名也都没有出现。

  已确认的元素从不自动删除。其他元素的 `suggestedMergeInto` 如果指向被删除的元素，同时清除。这一步复用出现位置的缓存，缓存中增加每集前言和附录的匹配结果。
- 用户现有项目中已经生成的错误元素，在重新导入或修改对应文字之后，会被这条规则清理。不另外写迁移。

### 段落类型切换

contracts 提供 `retypeBlock(block, type, newId): ScriptBlock[]`。编辑器的类型菜单、类型下拉框、Tab 循环、Ctrl+数字，以及存疑候选项，都调用它，重新解析文字与属性：

- **切成 scene**：先把当前文字加上 `boldHead` 的信息，交给 `parseSceneHeading` 解析，得到 attrs 和 location；解析失败时，location 为 `content`，attrs 全部为 null。
- **切成 character**：去掉 `**`，把末尾的括号拆进 `extension` 和 `delivery`。如果剩余部分是「名字＋冒号＋内容」，就拆成 character 和 dialogue 两个段落，dialogue 沿用原 id。
- **切成 sound 或 production**：如果文字以 `【X】` 开头，label 为 X，text 为其后的内容；否则 label 为「音效」（sound）或「提示」（production），text 为 `content`。
- **切成 parenthetical**：去掉外层括号。
- **切成 action**：去掉开头的 `△▲※`。
- **切成 text**：去掉「字幕：」这类前缀。
- **切成其他类型**：text 为 `content`。
- **从 scene 切出去**：先把场标题还原成一行文字，`spaceLabel　location — timeText（note）`，空的部分省略，再按目标类型处理。
- **从 character 切出去**：先还原成 `名字（extension）`。

### 幕

- `act` 不再出现在 `TYPE_CYCLE`、类型下拉框和段落手柄菜单中。光标在幕段落上时，下拉框只把「幕」显示为当前值，并且禁用这一项。
- **新的 Tab 循环**：action → character → dialogue → parenthetical → scene → transition → sound → production → text → note → cast → action。Ctrl+1～9 的映射不变。新增 `NEXT_TYPE.production = 'action'`。
- 大纲中每一场的菜单增加「在此场前插入分幕」：插入一个文本为「第N幕」的 act 段落，N 等于此前幕的数量加 1，然后聚焦。幕分组的标题菜单提供「移除分幕」，只删除这一个 act 段落。幕段落在纸面上仍然可以直接编辑。

### 排版补充

- **场标题**：依次显示场号徽标、内外 chip、地点、时间 chip（有 `timeText` 时显示 `timeText`，否则显示时间的中文名）、note（灰色），最后是 timecode（灰色等宽字体）。点击 chip 切换时，同时把 `timeText` 设为 null。
- **角色**：显示名字、delivery chip，以及 extension（灰色）。
- **sound**：喇叭图标加上 label 文字。
- **production**：前面加一个 `muted` 底色的小徽标，显示 label；正文使用次要文字颜色。样式与 note 明显区分。
- **大纲**：时间显示 `timeText` 优先。
- **前言和附录**：纸面的上方和下方各有一块默认折叠的卡片，分别是「前言」和「附录」，内容为空时不显示。卡片标题旁显示第一行文字作为摘要。展开后以 `whitespace-pre-wrap` 显示纯文本，不渲染 Markdown，也不引入新依赖。卡片中有「在 Markdown 视图中编辑」按钮。

### 转换结果提示

`addedElements` 现在会包含角色表中的已确认人物，因此结果提示改为「已识别 S 场、B 段，新增 N 个元素」，不再写「待确认」。`ConversionState` 不变。

### 元素高亮

- 装饰插件有两种模式，由 `scriptMentions` 偏好控制：
  - 关闭（默认）：只为元素栏中当前选中的元素生成下划线；
  - 开启：与现在一样，为全部元素生成下划线。
- 存疑竖条不受这个开关影响。
- 工具栏增加「元素标记」切换按钮（`aria-pressed`）。悬停卡片和 Ctrl+点击只对有下划线的位置生效。

### Markdown 视图

**界面**

- 工具栏最左侧是「样式」「Markdown」两个页签（Tabs）。选择保存在 `scriptView` 偏好中。
- Markdown 视图隐藏大纲、纸面和元素栏，主区是一个等宽字体的 Textarea（最大宽度 900px，高度占满，上限 200000 个字符）。工具栏只保留页签、保存状态和快捷键帮助。转换进行中时，Textarea 只读。
- 不引入新依赖。撤销使用 Textarea 原生的撤销。

**渲染**：`renderScriptMarkdown(doc) → { text, lineBlocks }`，`lineBlocks[i]` 是第 i 行对应的段落 id，没有对应段落时为 null。格式固定如下：

```text
<preface>            ← 非空时写出，后面空一行
<!-- 正文 -->        ← 总是写出，后面空一行

**1. 内景　城西卢宅·正屋 — 清晨（多年以后）**　`00:00–00:35`

【音效】棕刷蘸进灰浆桶，提起来，往下滴水。

**影娘**（画外）
你娘下葬，我跟着你跪在坟前。
（停顿）

---

**2. 外景　卢宅门口 — 日**

<!-- 附录 -->        ← 附录非空时写出，前面空一行，后面空一行
<appendix>           ← 文件以换行结尾
```

- 每个段落渲染成恰好一行：
  - act：`## {text}`；
  - scene：`**{序号}. {spaceLabel}　{location} — {timeText ?? 时间中文名}（{note}）**　\`{timecode}\``，序号是本集中场的顺序号，空的部分连同分隔符一起省略；
  - cast：`人物：{text}`；
  - action、dialogue、transition：`{text}`；
  - character：`**{text}**`，有 extension 时追加 `（{extension}）`；
  - parenthetical：`（{text}）`；
  - sound 和 production：`【{label}】{text}`；
  - text：`字幕：{text}`；
  - note：`> {text}`。

  spaceLabel 的对应关系为：int 为「内景」，ext 为「外景」，intext 为「内景／外景」。时间的中文名为：day 日，night 夜，dawn 清晨，dusk 黄昏。
- **段落之间的分隔**：
  - 第一个段落前面不加分隔；
  - scene 和 act 前面加「空行、`---`、空行」；
  - 前一段是 character、parenthetical 或 dialogue，当前段是 parenthetical 或 dialogue 时，只换行，不空行；
  - 其他情况空一行。
- 文字为空的非 scene 段落，在 Markdown 往返之后会丢失，这是已接受的取舍。

**回写**：`applyMarkdownEdit(oldDoc, oldText, newText) → { document, unsure }`。

1. 用 `parseScriptText(newText)` 解析新文本，得到前言、附录和段落，并借助各段落的 `src.line` 把段落对应到新文本的行。合并完成后，删除所有段落的 `src`，从 Markdown 生成的文档不带 `src`。
2. 对新旧文本逐行做 LCS 比对，比对时使用「键」：去掉开头的 `**N.` 场序号之后的行文字。这样插入或删除一场之后，后面场标题的序号变化不会被当成修改。
3. 新文本中**没有改动的行**，直接沿用旧文档中该行对应的段落，类型、属性、`review` 和 id 全部不变。
4. 在改动区域中，旧行数和新行数相同时，按顺序一一配对。如果这一行在旧文档中恰好对应 1 个段落，新解析结果也恰好是 1 个段落，就沿用旧 id，并清除 `review`。
5. 其余的行使用新解析的段落（新 id，存疑的行带 `review`）。
6. 结果用 `ScriptDocument.parse` 校验。校验失败（例如超过 5000 段）时，停留在 Markdown 视图，并显示错误。

**时机**：

- 从样式切到 Markdown 时，执行渲染，并记住这次渲染得到的 `oldText` 和 `lineBlocks`。
- 在 Markdown 视图中，停止输入 1 秒后，用 `applyMarkdownEdit` 得到文档并保存，Textarea 中的文字不重新渲染。保存成功后，把 `oldDoc` 和 `oldText` 更新为这次的结果。
- 从 Markdown 切回样式时，先完成一次回写，再用一个 transaction 替换编辑器的内容，这一步可以作为一次撤销整体撤回。
- 打开带 `?block=` 的路由时，本次一律显示样式视图，以便定位段落，但不改写 `scriptView` 偏好。
- 逐行比对的复杂度是 O(n×m)，3 万字的剧本约 1500 行，开销可以接受。`shortcut: 朴素 LCS，单集超过 5000 行时改用 Myers diff`。

### 代码位置

| 内容 | 位置 |
| --- | --- |
| schema v2 与迁移 | `packages/contracts/src/scripts.ts` |
| `normalizeLine`、规则解析器、场标题解析、角色表解析、`retypeBlock`、`retypeLine` | `packages/contracts/src/script-parse.ts` |
| `renderScriptMarkdown`、`applyMarkdownEdit` | `packages/contracts/src/script-markdown.ts` |
| 偏好字段 | `packages/contracts/src/desktop.ts` |
| 转换、角色表入库、同步与清理 | `apps/engine/src/modules/scripts/` |
| 编辑器各项改动 | `apps/desktop/src/renderer/src/features/projects/script/` |

### 相关笔记核对

- [剧集与结构化剧本](2026-10-29-episodes-and-structured-scripts.md)：本篇部分取代其中的以下内容：规则解析表、「只请模型对存疑行做决定」、原文完整性第 2 条、Tab 循环与类型菜单、元素高亮的默认行为，以及段落类型表（新增 production）。剧集、项目设定、接口和设定库的其余部分仍然有效。原篇保留历史决定，并在对应位置链接本篇，数据格式和代码位置已同步。
- [剧本编辑器内核选型](../architecture/2026-10-29-script-editor-tiptap.md)：已互链。Markdown 视图使用 Textarea，不扩展 Tiptap 的使用范围，`@tiptap/*` 的边界不变。
- 其余笔记与本篇无关。

## Alternatives considered

- **模型直接返回结构化剧本（包含文字）**：最强的理由是，模型能理解任意格式，本地不需要维护规则。用户这次也专门问过这个问题。没有采用：模型可能漏句或改台词，结果无法自动校验；《影娘》约 3 万字，结构化输出会超过大多数模型的单次输出上限，分段返回再拼接又容易出错；输出量大约是只返回标签的十倍；没有配置模型时，功能就完全不能用。
- **保持「只把存疑行交给模型」**：最强的理由是调用次数少、费用低。没有采用：规则把认不出的行判为「确定」，正是这个错误让模型看不到《影娘》的大部分内容；全部行都交给模型后，《影娘》全文需要 10 到 20 次调用，可以接受。
- **彻底删除幕**：最强的理由是概念更少。没有采用：电影和舞台剧本确实分幕，原文中写了「第一幕」的仍然需要识别和分组；把幕改成大纲操作，就能解决和场标题看起来重复的问题。
- **前言作为剧本开头的注释段落**：最强的理由是不需要改 schema。没有采用：角色表和设定会混进段落列表和大纲，影响分场与下游；改编说明这类内容在正文之后，也放不进「开头」。
- **制作提示归为注释**：最强的理由是不新增类型，旧版本应用仍能打开。没有采用：注释不进入下游流程，而【镜头】【美术】正是故事板和分镜最需要的信息。
- **Markdown 视图只读，只预览原文**：最强的理由是工作量小。没有采用：用户的剧本本来就是用 Markdown 写的，能在 Markdown 中直接编辑，比逐段切换类型顺手。
- **Markdown 视图使用 CodeMirror 等代码编辑器**：最强的理由是可以有行号、语法高亮和更好的大文本性能。没有采用：需要新增依赖，而 3 万字的纯文本在 Textarea 中编辑没有问题；以后如果需要语法高亮，再单独评估。
- **回写时整篇重新解析，不逐行比对**：最强的理由是实现简单，结果完全由解析器决定。没有采用：每次切换视图，所有段落的 id 和用户手动修正过的类型都会丢失，故事板和分镜的引用也会失效。
- **以 Markdown 文本作为剧本的存储格式**：最强的理由是只有一份数据，不存在两个视图之间的同步问题。没有采用：段落 id、attrs 和 `review` 没有地方存放；原篇已经因为「以纯文本为准会让 id 失效」否定过这条路。

## Testing

下列验收由 contracts、engine、desktop 单测和生产构建 e2e 覆盖；明暗主题及 720×560 截图逐张查看。完整《影娘》在开发模式下按纯规则导入，得到 415 段、28 场、2 处存疑，各类型数量与第 5 条一致。没有调用真实文本模型，没有重新打包验收。

1. **contracts 单测**：
   - 读取 v1 文档后迁移为 v2，各项缺省值正确；attrs 与类型的对应关系有正反例。
   - `script-sample-01.txt` 的解析结果与原验收一致：60 段，各类型数量不变，3 处存疑；`preface` 为「第1集 重逢」。
   - `script-sample-02.txt` 的解析结果完全符合实施计划 01 中的逐行预期表：前言为第 0–46 行，附录为第 168–171 行；共 67 个段落，其中 scene 6（存疑 2）、transition 4、sound 4、production 2、text 1、character 7、dialogue 8、parenthetical 1、note 8、action 26；原文完整性检查通过。
   - 角色表得到 5 个已确认人物和 14 个待确认人物。
   - `parseSceneHeading`、`retypeBlock` 有逐条的表驱动测试。
   - 两份样例的规则解析结果都满足：`parseScriptText(renderScriptMarkdown(doc).text)` 的前言、附录相同，并且逐段比较 type、text、attrs 相同（不比较 id、src、review）。
   - 两份样例都满足：`applyMarkdownEdit(doc, md, md)` 的结果与 `doc` 完全相同（包括 id，`src` 除外）。修改一行对白后，只有这一段的文字改变，id 不变。插入一个新场后，其余场的 id 不变，新场出现在正确的位置。随意写一行无法识别的内容，这一行被标为存疑。
2. **engine 集成测试**：
   - 不配置模型时导入 `script-sample-02.txt`：`result` 为 6 场、67 段、2 处存疑，`addedElements` 为 24（角色表 19 个，规则同步 5 个：孩童们、卢生、城西卢宅·正屋、卢宅门口、卢宅正屋）；「片名」「片尾字幕卡」没有被建为场景。
   - 使用模拟模型时：每一行都出现在某一批请求中；模型对一个非存疑行做出的决定被采用；模型没有提到的存疑行，`review` 被清除；模型夹带的文字被丢弃。
   - 待确认元素清理：把唯一出现某名字的段落删掉并保存后，对应的待确认元素被删除，已确认的元素保留；只在前言中出现的名字保留。
   - engine 读取 v1 剧本文件后，第一次保存写出 v2。
3. **desktop 单测**：
   - 类型菜单和 Tab 循环中没有「幕」；「在此场前插入分幕」可以一次撤销；
   - 把「**1. 内景 X — 夜**」这一行切成 scene 后，attrs 正确，文字中不再有 `**`；
   - 元素标记默认关闭，选中元素后只有该元素有下划线，打开开关后显示全部；
   - Markdown 页签可以切换，选择会写入偏好；在 Markdown 中编辑后切回，样式视图内容正确，并且可以一次撤销。
4. **桌面 e2e**：
   - 原有的剧本 e2e 改为通过工具栏完成，结果提示的预期改为「新增 10 个元素」，并继续通过；
   - 新增一条用例：导入 `script-sample-02.txt` → 显示「已识别 6 场、67 段，新增 24 个元素」→ 前言卡片可以展开 → 切到 Markdown 视图，修改一行对白并新增一个场标题 → 切回样式视图后，大纲中多了一场，修改过的对白段落 id 不变（通过 engine 接口读取剧本来核对）→ 重启应用后，视图选择得到保留。
   - 截图检查明暗两种模式和 720×560 窗口下的 Markdown 视图、前言卡片和制作提示段落。
5. **人工检查**：把用户提供的完整《影娘》剧本（`D:\WorkSpace\project\personal\reference_files\影娘_剧本.md`，不入库）按纯规则导入，在计划中记录各类型的数量。写本笔记时，用一份按本规格编写的原型（不入库）跑过这份剧本，结果为：前言 0–46 行，附录从 831 行开始，共 415 段，其中存疑 2 段；scene 28、character 56、dialogue 69、parenthetical 14、production 36、sound 23、transition 8、text 2、note 9、action 170。28 个场标题中，第 1–26 场为确定，「片名」和「27. 片尾字幕卡」为存疑。实现结果与这些数字不一致时，逐条核对差异的原因，记入计划。这一项不作为门禁。

## Consequences

- **收益**：Markdown 剧本中的格式标记、独立角色行、制作提示和正文外区域得到识别；角色表进入设定库，孤立待确认元素自动清理。样式和 Markdown 双向编辑保留未改行的段落身份，偏好在重启后保留。

- **规则仍然覆盖不全**：其他作者的写法还会有新的变体。配置了模型之后，判断类型的工作交给模型，规则只负责去掉格式标记和拆出属性，误判的影响会小很多。新的语料按回归样例的方式继续补充。
- **调用次数增加**：配置了模型时，每次导入的调用次数从「存疑批次数」增加到「全部批次数」。默认 `maxOutput` 为 1024 时，3 万字大约需要 16 次调用。
- **旧版本不兼容**：旧版本应用打不开 v2 剧本，报的是 schema 错误，而不是「需要更新应用」。偏好文件中的新字段会让旧版本读取偏好失败，回退为默认主题。
- **Markdown 往返会做规范化**：用户原文的写法（例如「1-1 日 内」）会被改写成统一格式；空的非场标题段落会丢失；Markdown 中的引用块一律视为注释。
- **行比对的边界情况**：一次大幅改写某个区域时，这个区域的段落会得到新 id。这是按行比对方式固有的上限。
- **回滚**：可以按子计划分别回退。一旦写出了 v2 剧本，回退代码之后旧代码就读不了这些剧本，需要保留 v1 读取兼容，或者重新导入。

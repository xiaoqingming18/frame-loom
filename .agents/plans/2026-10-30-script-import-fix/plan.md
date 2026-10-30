# Plan: 剧本导入识别修正、前言附录与 Markdown 视图

Status: active
Note: ../../notes/proposed/feature/2026-10-30-script-import-and-markdown-view.md

## 目标

导入真实 Markdown 剧本后，场标题、独立角色行对白、制作提示、前言、附录和角色表都能正确识别。具体要求：

- 配置了文本模型时，模型能看到并判断全部正文行；
- 修改段落类型时，按新类型重新解析文字和属性；
- 设定库会清理孤立的待确认元素；
- 幕改为大纲操作；
- 元素下划线默认关闭；
- 编辑器提供可以双向编辑的 Markdown 视图。

完成条件以笔记 `## Acceptance criteria` 第 1–5 条为准。

## 范围与非目标

- 范围：
  - `packages/contracts` 的 `scripts.ts`、`script-parse.ts`、新建的 `script-markdown.ts`、`desktop.ts`，以及 `fixtures/script-sample-02.txt`（已随笔记提交，不得修改）；
  - `apps/engine/src/modules/scripts/`；
  - `apps/desktop/src/renderer/src/features/projects/script/`；
  - `apps/desktop/e2e/scripts.test.ts`。
- 基线：笔记提交后的 HEAD。每个子计划开始前，都要重新阅读相关文件。
- 非目标，不得顺手实现：
  - 导出 Markdown 文件；
  - Markdown 语法高亮、行号，以及 CodeMirror 等新依赖；
  - 前言的 Markdown 渲染；
  - 元素参考图；
  - 修改剧集、项目设定、设定库 Tab 的现有行为（笔记明确写出的除外）；
  - 针对用户现有项目的数据迁移脚本；
  - 主进程和 CSP 的改动；
  - 加固目录版的验收。

## 子计划

| 编号 | 子计划 | 状态 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| 01 | [schema v2 与规则解析器](01-contracts-parser.md) | done | — | v2 schema 与迁移、`normalizeLine`、新规则表、场标题与角色表解析、`retypeBlock`/`retypeLine`、两份样例的预期测试 |
| 02 | [Markdown 渲染与回写](02-contracts-markdown.md) | draft | 01 | `renderScriptMarkdown`、`applyMarkdownEdit` 与往返测试 |
| 03 | [engine 转换、角色表与清理](03-engine.md) | draft | 01 | 全行交给模型、角色表入库、同步跳过存疑段落、待确认元素清理、v1 读取后写出 v2 |
| 04 | [编辑器修正](04-desktop-editor.md) | draft | 01 | 幕的处理、类型切换重新解析、新排版、前言附录卡片、元素标记开关、偏好、结果提示文案 |
| 05 | [Markdown 视图](05-desktop-markdown.md) | draft | 02、04 | 页签、Textarea 编辑、自动回写保存、切换回样式视图、偏好记忆 |
| 06 | [集成验收与收尾](06-acceptance.md) | draft | 03、05 | 新旧 e2e、截图、完整剧本人工记录、一次全仓门禁、笔记转为 implemented |

## 依赖与顺序

- 关键路径：01 → 02 → 05 → 06，以及 01 → 04 → 05。
- 可以并行：01 完成后，02、03、04 互相独立。
- 环境：Node.js 24.22.x，使用锁定版本的 pnpm。desktop 和 engine 的单测脚本会先构建 contracts。运行 e2e 前，先执行 `pnpm --filter @frame-loom/engine... build && pnpm --filter @frame-loom/desktop build`。

## 执行纪律

1. 开始任何子计划之前，先完整阅读笔记，再阅读本节和该子计划。笔记中的规则表顺序、正则、时间映射顺序、停用词、渲染格式、分隔规则、id 沿用规则和文案都是规格，不得改写。
2. 规格没有写到的细节，按最小且完整的原则补齐，并记入该子计划的「发现与偏差」。需要修改笔记中已写明的内容时，先停下来记录原因，等用户确认后，先改笔记再改代码。
3. 01 中的逐行预期表来自一份按规格编写的原型（`.cache/spec-proto.mjs`，不入库）。实现结果与预期表不一致时，以笔记为准逐条核对：
   - 如果是实现错了，就修改实现；
   - 如果是预期表不符合笔记，就修改预期表，并记入「发现与偏差」；
   - 如果笔记本身有矛盾，按第 2 条处理。

   不得为了让数字一致，加入笔记中没有的特例。
4. 禁止事项：
   - 让模型输出的文字成为段落文字；
   - 新增依赖；
   - 新增 SQLite 表或迁移；
   - 改动 `ScriptFile.formatVersion`；
   - 让 `@tiptap/*` 出现在 `features/projects/script/` 之外；
   - 修改 `fixtures/script-sample-01.txt` 和 `script-sample-02.txt`；
   - 使用 Tailwind 调色板颜色或任意颜色值；
   - 在 `features/` 之间互相 import。
5. 每个子计划只运行它的 `## 验证` 中列出的定向命令。全仓门禁只在 06 中执行一次。不为样式类名或组件内部 state 写镜像实现的测试，也不运行与剧本无关的测试。
6. 提交：每个子计划提交一次或多次，使用 `feat(scripts): …` 或 `fix(scripts): …`，带上 `Note:` 和 `Plan:` 尾注，提交前运行 `pnpm run verify`。笔记只在 06 中移入 `implemented/`。
7. 每完成一个子计划：勾选步骤，在 `## 验证` 中写入实际执行的命令和结果，追加进度，同步本表的状态，并写好交接。

## 不变量（每个子计划结束时自查）

- `ScriptDocument.parse` 能接受 v1 和 v2 文档，输出一律为 v2。
- 正文类段落的 `text`，是 `normalizeLine(原文行).content` 的子串。转换写入前，原文完整性检查必须通过。
- `script-sample-01.txt` 的解析结果仍为 60 段，各类型数量不变，3 处存疑。
- 已确认的元素从不被自动删除。
- 段落 id 唯一。没有改动的 Markdown 行，往返之后 id 不变。

## 验收

- [ ] 笔记验收第 1 条 — 证据：01、02 单测
- [ ] 笔记验收第 2 条 — 证据：03 集成测试
- [ ] 笔记验收第 3 条 — 证据：04、05 单测
- [ ] 笔记验收第 4 条 — 证据：06 e2e 与截图
- [ ] 笔记验收第 5 条已记录 — 证据：06
- [ ] 一次全仓 typecheck、lint、format:check、test 和 `pnpm run verify` 通过 — 证据：06
- [ ] 笔记移入 `implemented/`，原剧集笔记和编辑器选型笔记补上互链并同步事实，父子计划转为 `done` — 证据：06 收尾提交

## 发现与偏差

无。

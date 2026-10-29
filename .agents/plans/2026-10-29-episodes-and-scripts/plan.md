# Plan: 剧集、项目设定与结构化剧本

Status: active
Note: ../../notes/proposed/feature/2026-10-29-episodes-and-structured-scripts.md
Note: ../../notes/proposed/architecture/2026-10-29-script-editor-tiptap.md

## 目标

本计划实现以下流程：项目可以带项目设定，项目下有正式的剧集，每集有一份结构化剧本，用户可以粘贴整集原文，由后台转换为带类型的段落，并把元素写入设定库，然后在三栏编辑器中编辑剧本，在设定库中确认、合并或忽略元素。完成条件以功能笔记的 `## Acceptance criteria` 第 1–6 条和编辑器笔记的第 1–5 条为准。

## 范围与非目标

- 范围：
  - `packages/contracts`：项目设定、剧集、剧本、设定库与转换的契约，规则解析器，元素匹配；
  - `apps/engine`：在 `modules/projects` 中增加项目设定、页面所属剧集、剧本存储和回收区清理；新建 `modules/scripts`；在 `modules/llm` 中新增 `complete()`；
  - `apps/desktop` renderer：项目设定表单、详情页 Tab、剧集列表、侧栏、剧本页、Tiptap 编辑器、导入与转换界面、设定库 Tab；
  - 受导航变化影响的现有 e2e。
- 基线：`1eab928`。每个子计划开始时都要重新阅读相关文件，不依赖笔记中的行号。
- 非目标，不得顺手实现：
  - 广告、MV 的分镜表格；
  - 剧本改写或优化；
  - 故事板和分镜生成；
  - 元素参考图和标签关联；
  - 同名元素区分；
  - 导出 Fountain 或 Word；
  - 多人协同；
  - 转换在 engine 重启后自动续跑；
  - 从导入原文中自动填写剧集标题；
  - Agent 工具；
  - 主进程、预加载脚本和 CSP 的改动；
  - 加固目录版的打包验收。

## 子计划

| 编号 | 子计划 | 状态 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| 01 | [契约与规则解析器](01-contracts.md) | done | — | `projects.ts` 扩展、`scripts.ts`、`script-parse.ts`、样例剧本与单测 |
| 02 | [项目设定、剧集与剧本存储](02-engine-storage.md) | done | 01 | 项目设定接口、页面所属剧集、剧集增删改、剧本读写与 409、回收区清理 |
| 03 | [设定库、同步与出现位置](03-engine-story.md) | done | 02 | 设定库命令、保存时同步、出现位置缓存与接口 |
| 04 | [后台转换与文本模型](04-engine-conversion.md) | done | 03 | `LlmService.complete`、转换队列、导入、取消、丢弃接口与事件 |
| 05 | [项目设定、剧集列表与侧栏](05-desktop-episodes.md) | done | 02 | 设定表单、详情 Tab、剧集列表与对话框、侧栏、剧本页路由外壳、受影响测试的更新 |
| 06 | [编辑器内核与保存](06-editor-core.md) | active | 05 | Tiptap 依赖、文档模型、键盘命令、排版、自动保存与冲突处理 |
| 07 | [大纲、手柄、存疑、高亮与元素栏](07-editor-panels.md) | draft | 03、06 | 三栏编辑器的全部交互与响应式布局 |
| 08 | [导入对话框与转换进度](08-import-ui.md) | draft | 04、06 | 导入、项目设定补填、进度、取消、未完成导入、结果提示 |
| 09 | [设定库 Tab](09-story-tab.md) | draft | 03、05 | 分类、筛选、卡片、详情抽屉、合并、批量、恢复 |
| 10 | [集成验收与收尾](10-acceptance.md) | draft | 07、08、09 | 剧本 e2e、截图、性能数字、一次全仓门禁、笔记转入 implemented |

## 依赖与顺序

- 关键路径：01 → 02 → 03 → 04 → 08 → 10。
- 可以并行：02 完成后，engine 线（03、04）与 desktop 线（05、06）互不依赖。07 需要 03 的设定库接口，09 需要 03 和 05。
- 环境：Node.js 24.22.x，使用锁定版本的 pnpm。desktop 和 engine 的单测脚本会先构建 contracts。e2e 运行前要先执行 `pnpm --filter @frame-loom/engine... build && pnpm --filter @frame-loom/desktop build`；未打包运行时，主进程通过 `app://` 加载 renderer，并下发 `PRODUCTION_CSP`。

## 执行纪律

这一节约束每个子计划的执行 Agent：

1. 开始任何子计划之前，先完整阅读两篇笔记，再阅读本节和该子计划。笔记中的格式、字段名、上限、错误码、规则表顺序、键盘规则、界面文案和代码位置都是规格，不是参考，不得改名或改写。
2. 规格中没有写到的细节，按「最小且完整」的原则补齐，并记入该子计划的 `## 发现与偏差`。如果需要修改笔记中已经写明的任何一条，就停下来，记录原因，并向用户确认。用户确认后，先修改笔记，再写代码。
3. 禁止事项：
   - 新增 SQLite 表或迁移；
   - 新增依赖（编辑器笔记列出的 `@tiptap/*` 除外）；
   - 在剧本文件中保存元素 id 或行内标记；
   - 让模型输出的文字成为段落文字；
   - 改动主进程、预加载脚本或 CSP；
   - 让 `@tiptap/*` 出现在 `features/projects/script/` 之外；
   - 升级 `formatVersion`；
   - 在 `features/` 之间互相 import；
   - 使用 Tailwind 调色板颜色或任意颜色值。
4. 每个子计划只运行该子计划 `## 验证` 中列出的定向命令，不运行全仓 `pnpm test` 或全部 e2e。全仓门禁只在 10 中执行一次。
5. 测试只覆盖可以观察的行为和规格中的表格（规则表、键盘规则、错误码、上限）。不为样式类名、组件内部 state 或纯透传代码写镜像实现的测试。不运行与本需求无关的测试，例如生成、模型服务、视频编辑等 e2e。
6. 提交：每个子计划提交一次或多次，使用 `feat(scripts): …` 这类格式，带上 `Note:` 和 `Plan:` 尾注，提交前运行 `pnpm run verify`。笔记只在 10 中移入 `implemented/`；在此之前，如果出现偏差，就在笔记原处同步事实。
7. 每完成一个子计划：勾选步骤，在 `## 验证` 中写入实际执行的命令和结果，追加进度，更新本表的状态，并写好交接。

## 不变量（每个子计划结束时自查）

- `ScriptDocument.parse` 接受编辑器保存的每一份文档；段落 id 唯一；段落文字不含换行。
- 转换写入前，原文完整性检查（`checkSourceIntegrity`）必须通过，否则不写入。
- 剧本和设定库的写入都在 `ProjectStore.serial(projectId)` 中进行；模型调用不在串行队列中。
- 旧项目（没有 `profile`、`episodes`、`scripts/` 目录和 `story.json`）可以打开、列出、清理和创建创作页，不报错。
- 创作页与剧集的关系只有一个来源：`ProjectPageSummary.episodeId`。

## 验收

- [ ] 契约与解析器满足功能笔记验收第 1 条 — 证据：01 单测
- [ ] engine 满足功能笔记验收第 2 条 — 证据：02、03、04 集成测试
- [ ] desktop 满足功能笔记验收第 3 条，以及编辑器笔记验收第 1–3 条 — 证据：05–09 单测，以及 `rg` 边界检查
- [ ] 剧本 e2e、CSP、模拟输入法组字、明暗主题与 720×560 截图满足功能笔记第 4、5 条和编辑器笔记第 4 条 — 证据：10
- [ ] 性能数字已记录 — 证据：10
- [ ] 一次全仓 typecheck、lint、format:check、test 和 `pnpm run verify` 通过 — 证据：10
- [ ] 两篇笔记移入 `implemented/`，相关笔记、`AGENTS.md` 和 README 已同步，父子计划转为 `done` — 证据：10 的收尾提交

## 发现与偏差

无。

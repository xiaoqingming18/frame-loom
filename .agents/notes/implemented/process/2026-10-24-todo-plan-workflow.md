# Agent Note: 以独立 todo-plan 技能配合决策笔记管理实施计划

Status: implemented

## Problem

决策笔记记录「为什么」，但大型需求还需要跨会话、跨多次提交保存「怎么做、做到哪、怎么验证」。会话内 todo 会在上下文压缩或换会话后丢失。一个大型需求会拆成多段可独立验收的工作，因此需要父子结构、统一格式和机械校验，避免各会话各写一套。

上游 `write-notes-like-deepseek` 的定位明确排除计划：其 `SKILL.md` 声明「聊天里的 Agent 负责拆任务、排计划」。已实现笔记的门禁禁止 `## Plan`、`## 计划` 等标题，落地时要求删除计划段。笔记树校验把 `.agents/notes/` 下非生命周期目录判为错误。笔记要求现在时、不记流水账；计划则需要勾选步骤、追加进度和交接，两者的写法方向相反。

## Decision

- 新增项目自有技能 `.agents/skills/todo-plan/`（`SKILL.md`、`templates/`、`examples/`、`scripts/verify-plans.mjs`），使用中文。上游 `write-notes-like-deepseek` 保持固定提交的原文，不修改。
- 计划存放在 `.agents/plans/`，与笔记平级，不进入笔记树。计划通过头块 `Note:` 相对路径单向链接笔记；笔记不依赖计划，决定、理由与备选只写在笔记里。
- 形态分两种：单文件 `yyyy-mm-dd-topic.md`；大型需求使用目录 `yyyy-mm-dd-topic/`，内含父计划 `plan.md` 和同级子计划 `NN-topic.md`。层级上限两层，禁止孙计划，子计划依赖只能指向更小的编号。
- 生命周期写在 `Status:` 中：`draft`、`active`、`blocked — <原因>`、`done`、`dropped — <原因>`，不靠目录表示，路径保持稳定。计划完成后原地保留，作为执行记录与验证证据。
- 与笔记联动：笔记 `proposed` 时计划为 `draft`，两者同批评审；收尾提交同批把笔记移入 `implemented/`、更新 `Note:` 路径并把计划转 `done`。
- 提交信息新增可选尾注 `Plan: .agents/plans/...`，与 `Note:` 并列，不强制。
- `pnpm run verify-plans` 执行计划校验，`pnpm run test:plans` 运行校验器测试，`pnpm run verify` 聚合笔记与计划校验。`verify-notes` 保持原样，CI 在笔记工作流中增加计划测试与校验。

### 校验契约

`verify-plans` 只检查机械约束：

- 路径形态与命名：topic 只允许小写字母、数字和短横线。
- 头块：第 1 行 `# Plan:`，第 3 行 `Status:`，之后只允许 `Note:`/`Parent:` 行。父计划与单文件计划至少一行 `Note:`；子计划必须且只能有一行 `Parent: plan.md`。
- 链接：`Note:` 必须指向笔记目录内存在的文件，或写成 `无 — <原因>`。进行中的计划校验全部正文相对链接；`done`/`dropped` 计划是历史执行记录，只校验指向计划与笔记的链接，源码之后改名或删除不会让历史计划失败。计划中的代码路径约定用反引号，不用 Markdown 链接。
- 章节：各形态的必备章节必须存在且按顺序出现。
- 步骤：语法为 `- [ ] T<n>`；编号唯一；`[-]` 必须写明放弃原因。
- 父计划子计划表：表头固定为 `| 编号 | 子计划 | 状态 | 依赖 | 交付物 |`，表行与子计划文件一一对应，状态列与子计划 `Status:` 关键字一致。
- 状态约束：
  - `done` 时不得有未完成步骤；父计划或单文件计划 `done` 时，`Note:` 不得指向 `proposed/`。
  - `draft` 时不得有已勾选步骤；父计划为 `draft` 时，子计划只能是 `draft`/`dropped`。
  - 子计划 `active` 时父计划必须 `active`。
  - 父计划 `done` 时，全部子计划为 `done`/`dropped` 且至少一个 `done`。
  - 子计划 `done` 时，其依赖必须已 `done`。

围栏代码块内的内容不参与结构解析。

## Related notes

当场审计活跃笔记：

- [仓库与决策笔记初始化](2026-10-24-repository-and-decision-notes.md)：部分重叠。本篇在其笔记流程之外增加计划层，该篇关于上游技能固定原文、项目级分发的决定仍成立，已同步互链与聚合校验入口。
- [提交规范](2026-10-24-git-commit-message-convention.md)：部分重叠。本篇新增可选 `Plan:` 尾注，已在该篇同步事实。

没有需要否决或归档的笔记。

## Alternatives considered

- **扩展修改 write-notes-like-deepseek**：规则集中在一个技能、一处入口，代理只需加载一份说明；但违背其「只记录为什么」的定位，与已实现笔记禁用计划标题、现在时纪律直接冲突。修改上游还会让后续同步上游时反复合并冲突，因此不采用。
- **在 proposed 笔记中写 `## Plan`**：只有一个文件，不存在两处同步；但落地时计划段必须删除，执行记录随之丢失。大型需求会把笔记撑大，频繁的进度改动也会掩盖理由，因此不采用。
- **只用会话内 todo**：零维护成本；但跨会话和上下文压缩后丢失，恰好无法支撑大型任务，因此只用于单会话内跟踪当前步骤。
- **引入 spec-kit、OpenSpec 等完整规格工作流**：有成熟的需求、设计、任务流程与命令。但它们自带的需求和设计文档与决策笔记的「为什么」重叠，目录和命令也较重。本方案只借鉴：ExecPlans 的自包含活文档与进度、发现、交接章节；spec-kit 的任务编号与依赖；OpenSpec 的一次变更一个目录。
- **GitHub Issues / Projects**：有看板，也便于协作；但仓库尚未托管，代理离线不可读，也不能与代码同次提交，因此不采用。
- **完成后删除计划、只靠 Git 历史**：计划目录更干净；但笔记或提交中引用的计划链接会失效，验证证据只能翻历史，因此采用原地保留。
- **不限层级的递归计划**：表达力强；但校验和状态汇总复杂，容易无限拆分，因此限定两层，过大的子计划拆成同级或提升为独立父计划。
- **把计划校验并入 verify-notes**：入口统一；但需要修改上游脚本或包脚本语义，因此新增独立的 `verify-plans` 并通过 `pnpm run verify` 聚合。

## Consequences

- 收益：大型任务的拆分、进度、验证证据和交接随仓库保存，新会话只读计划与链接的笔记即可续做；父子状态一致性、依赖顺序和笔记落地同步由脚本兜底。上游技能保持原文，便于后续同步。
- 代价：多一个技能、一个目录、一项校验和一份指南需要维护；代理和协作者需要同时理解两套文档的分工。计划与笔记之间靠 `Note:` 路径维系，笔记移动时必须同批更新，校验会报出遗漏。
- 父计划子计划表与子计划 `Status:` 双写，换来父计划一眼可读的总览，代价是每次状态变化要改两处，校验保证不一致时失败。
- 计划完成后长期保留，会随时间累积，检索时需按 `Status:` 区分进行中与历史计划。历史计划描述的是当时的代码，其中的路径和命令可能过时。当前不设归档机制，数量影响检索时再另行决策。
- 校验不能证明拆分合理、验证真实执行或交接可接手，仍需人工评审。本地 `commit-msg` 钩子不检查 `Plan:` 尾注路径是否存在。
- 示例为虚构场景（Electron 骨架、代码检查基线），放在技能的 `examples/` 下，不代表项目已有实现。

## Verification

- `pnpm run test:plans`：自带示例通过校验；7 个合法用例、27 个违规用例覆盖路径、头块、状态、章节、步骤、父子表、依赖与状态约束。
- `pnpm run test:commit-convention`：增加带 `Plan:` 尾注的合法消息用例。
- `pnpm run verify`：笔记校验与计划校验（工作流首次落地时 `.agents/plans/` 没有真实计划）。
- 以 `AGENT_NOTE_ROOT` 指向 `examples/notes` 运行上游格式与树校验，确认示例笔记符合笔记格式。
- 本地抓取 OpenAI ExecPlans、spec-kit、OpenSpec 原文失败，借鉴内容依据检索摘要：[ExecPlans PLANS.md](https://github.com/openai/openai-agents-python/blob/fb67680fae60fef27cd0e71e73a68c73f9212526/PLANS.md)、[spec-kit 任务模板](https://github.com/github/spec-kit/blob/main/templates/tasks-template.md)、[OpenSpec 入门](https://raw.githubusercontent.com/nwaikhom/OpenSpec/refs/heads/main/docs/getting-started.md)。这些在线内容可能变化，本仓库规则以 todo-plan 技能为准。

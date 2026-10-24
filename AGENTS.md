# Frame Loom 协作约定

## 项目背景与沟通

- 产品目标：基于 Electron 与 React 的多模态 AI 智能影视工作台桌面 PC 应用。
- 当前仓库包含流程基础设施、pnpm workspace、`packages/contracts`、可独立运行的 `services/engine` 与 `apps/desktop` 桌面壳；`pnpm dev` 显示健康信息，`pnpm package:win` 生成 Windows x64 NSIS 安装包，已验证安装、正常退出与卸载保留数据。尚无创作业务、Agent、签名或更新能力；后续技术选型需要独立记录，不能把设想描述为已实现功能。
- 用户沟通、项目文档及自编代码注释使用简体中文；标识符使用标准英文命名。随仓库分发的上游技能保留原文，避免无意偏离上游。
- 开发与 CI 统一使用 Node.js 24.22.x 和 `packageManager` 锁定的 pnpm，提交 `pnpm-lock.yaml`。上游技能原文中的 `npm run` 在本仓库对应 `pnpm run`；其他依赖操作也以本仓库指南为准，不修改上游原文。
- 从项目结构、技术栈到业务逻辑分析问题，说明关键方案的理由、代价与验证方法。

## 重要改动必须留笔记

1. 改动涉及行为、架构、跨文件契约、流程工具链、测试策略或落盘／网络／配置格式时，先阅读 `.agents/skills/write-notes-like-deepseek/SKILL.md` 并写或更新笔记。
2. 动手前检索 `.agents/notes/` 的相关活跃笔记；有归属就原地同步事实。决定或核心理由翻转时另写笔记，不把旧决定改成反面。
3. 新方案先写入 `proposed/`；完成后同批移入 `implemented/`，更新状态、正文和链接。代码与笔记同一次提交。
4. 仅使用 `feature`、`bug-fix`、`simplification`、`architecture`、`process`、`testing` 六类；目录按需创建，不建总索引。
5. 被放弃的方案先写最强理由，再解释不用的原因；同时记录收益和代价，不编造备选。
6. 被否提案转 `rejected/` 并说明原因；仅保留有防坑价值的记录。完全被取代的已实现笔记使用归档脚本处理，修复入站链接，禁止手改已封印文件或重写既有封印。
7. 样式、格式化、错别字、无行为变化的补丁等纯机械改动不单独立笔记。
8. 提交前运行 `pnpm run verify`（笔记与计划校验），失败先修复。校验只保证机械规则，仍需核对理由和内容是否准确。

## 大型任务写实施计划

- 跨多次提交或会话、步骤超过一屏、需要拆分子任务时，阅读 `.agents/skills/todo-plan/SKILL.md`，在 `.agents/plans/` 写计划并用 `Note:` 链接笔记。
- 大型需求使用父计划加同级子计划，最多两层。计划不复述理由；需要改变决定时回到笔记流程。
- 施工中同步步骤、进度、父计划表和交接；收尾时笔记移入 `implemented/`、计划转 `done`，二者同批提交。操作见[实施计划指南](docs/plans.md)。

## 最小完整改动（Ponytail）

- 编写、修复、重构或评审代码，以及选择依赖时，加载 `.agents/skills/ponytail/SKILL.md`，默认 `full` 级别：先读懂改动波及的代码，再选最小且完整的方案。
- 评审改动用 `ponytail-review`，全仓审计用 `ponytail-audit`，汇总 `shortcut:` 注释用 `ponytail-debt`。这些技能的报告和回复仍使用简体中文。
- 有已知上限的捷径按 `shortcut: <上限>, <何时升级>` 注释。标记词保留英文，便于 `ponytail-debt` 检索，说明用中文。
- Ponytail 不替代本文件的笔记、计划、验证与提交规则。二者冲突时以本文件为准。

## Git 提交规范

- 遵循 [Git 提交信息规范](docs/git-commit-convention.md)，使用 `type(scope): 中文摘要`，范围可省略，标题最多 72 字符。
- 仅使用 `feat`、`fix`、`perf`、`refactor`、`docs`、`test`、`build`、`ci`、`style`、`chore`、`revert`；`style` 仅表示格式调整。
- 一个提交对应一个逻辑变化，代码、必要测试、文档与笔记同次提交。非平凡改动简述动机和实际验证，以 `Note:` 关联笔记。
- 破坏性变更同时使用标题 `!` 和 `BREAKING CHANGE:`，写清影响及迁移方法；回退使用 `revert` 并填写 `Reverts:` 完整 SHA。
- 不绕过提交消息钩子，不编造测试、Issue 或共同作者；提交前继续运行 `pnpm run verify`。新克隆执行 `corepack enable pnpm`、`pnpm install --frozen-lockfile` 和 `pnpm run setup:git`。

## 工具与操作

- 已安装 MCP 提供对应能力时优先使用。代码检索有 `code-index` 时先初始化索引，优先使用文件／符号级工具；Git 操作或大规模编辑后刷新索引。未提供该工具时使用 `rg`／`rg --files`。
- 缺陷排查先使用可用的搜索工具查找常见原因与诊断路径，再读代码和修改；外部信息引用原始 URL。搜索工具不可用时明确说明并以本地证据排查。
- 编辑文本使用 `apply_patch`。修改前阅读已有文件，不覆盖无关变更，不擅自推送、合并或发布。
- 本次用户已授权仓库初始化及笔记系统搭建；按此范围完成。新需求中存在真正影响产品方向的未决取舍时，先形成可评审方案再集中沟通。
- 运行有针对性的验证；不要为纯机械改动添加镜像实现的测试，不把计划写成已验证结果。

操作方法见 [决策笔记指南](docs/decision-notes.md) 与 [实施计划指南](docs/plans.md)。

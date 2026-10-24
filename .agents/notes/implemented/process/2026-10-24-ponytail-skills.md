# Agent Note: 随仓库分发 Ponytail 技能约束最小完整改动

Status: implemented

## Problem

应用骨架即将开工，AI 代理容易写出超出需求的抽象、配置和依赖，评审时也缺少统一的检查清单。用户要求集成 [Ponytail](https://github.com/DietrichGebert/ponytail)。上游以 Claude Code、Codex 等宿主插件为主，插件依赖生命周期钩子和宿主全局目录。本仓库需要一种不依赖某个宿主、可随仓库恢复的接入方式，并与既有中文、笔记和计划规则共存。

## Decision

- 将上游 `skills/` 下六个技能的 `SKILL.md` 原文复制到 `.agents/skills/<name>/`：`ponytail`、`ponytail-review`、`ponytail-audit`、`ponytail-debt`、`ponytail-help`、`ponytail-gain`。上游 MIT 许可证复制到 `.agents/skills/ponytail/LICENSE`。
- 来源固定为上游提交 `09c434ab73ca43761c5d8b0c5d341926c2fba710`（包版本 5.3.2），安装日期 2026-10-24。技能文件保持原文；更新时审阅上游差异，同步本节提交号。
- 不引入上游钩子、插件清单、状态栏或 npm 包。等级切换只在会话内生效，默认 `full`。
- `AGENTS.md` 增加「最小完整改动」一节：写代码、评审和选依赖时加载 `ponytail`；`shortcut:` 标记词保留英文以便 `ponytail-debt` 检索；报告使用简体中文；与本仓库笔记、计划、验证、提交规则冲突时以 `AGENTS.md` 为准。

## Related notes

当场审计活跃笔记：

- [仓库与决策笔记初始化](2026-10-24-repository-and-decision-notes.md)：部分重叠。本篇沿用其「上游技能项目级随仓库分发、固定提交、保留原文」的决定，未修改该篇事实。
- [todo-plan 工作流](2026-10-24-todo-plan-workflow.md)、[提交规范](2026-10-24-git-commit-message-convention.md)：无关，Ponytail 不改变计划和提交格式。

没有需要否决或归档的笔记。

## Alternatives considered

- **只复制上游 `AGENTS.md` 规则段**：一个文件、任何读 `AGENTS.md` 的代理都能生效；但会把英文上游原文混进中文协作约定，更新时难以与上游比对，也拿不到 review、audit、debt 三个按需技能，因此不采用。
- **安装 Claude Code / Codex 插件**：有钩子注入、子代理注入和持久等级；但安装在开发者全局目录，其他宿主、新机器和 CI 无法从仓库恢复，钩子还要求信任外部脚本，因此不采用。需要时开发者可在个人环境另装，与本仓库副本内容相同。
- **`npx skills add DietrichGebert/ponytail`**：一条命令完成复制；但每次执行拉取主分支最新内容，版本不固定，且写入路径随 `--agent` 变化，因此手工复制固定提交。

## Consequences

- 收益：任何能读取 `.agents/skills/` 的代理都获得同一套最小改动规则和评审、审计清单，来源可追溯，随仓库恢复。
- 代价：仓库多六个上游文件需要随上游手工同步。没有钩子时，`ponytail` 是否在每次任务被加载取决于代理遵守 `AGENTS.md`，不能机械保证。
- `ponytail-gain` 展示的是上游基准数据，不代表本仓库效果；`ponytail-help` 中关于 Claude Code band、插件更新的内容在本仓库接入方式下不适用。
- 上游要求回复用浅显英文，本仓库以中文沟通规则覆盖，可能与上游行为略有偏差。

## Verification

- 对比本地副本与上游克隆：六个 `SKILL.md` 与 `LICENSE` 逐字节一致。
- `pnpm run verify`：笔记与计划校验通过。
- 当前会话的技能目录在复制后列出全部六个 `ponytail*` 技能，确认宿主可发现。

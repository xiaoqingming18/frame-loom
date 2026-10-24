# Agent Note: 建立仓库与决策笔记维护流程

Status: implemented

## Problem

Frame Loom 是计划采用 Electron 与 React 的多模态 AI 智能影视工作台桌面 PC 应用。空仓库起步需要建立 Git 历史和可校验的决策记录。后续开发需要保留选型理由、被放弃的方案和验证方式，使新会话能够理解既有约束。

## Decision

- Git 仓库使用 `main` 初始分支，此次基建构成首次提交。
- 将上游 `write-notes-like-deepseek` 技能完整安装到 `.agents/skills/` 并纳入版本控制，固定来源提交，避免依赖开发者的全局安装。
- 使用 `.agents/notes/{proposed,implemented,rejected,archived}/{class}/yyyy-mm-dd-topic.md` 标准，按需创建分类目录，不建立总索引。
- 通过锁定的本地 `tsx`、npm scripts 和 GitHub Actions 执行目录、格式、归档封印三项校验；生成的看板不进入版本控制。
- 用根目录 `AGENTS.md` 和中文操作指南接入后续开发。非平凡改动与笔记同批提交，纯机械改动不立笔记。
- 技能来源固定为上游提交 `72573a5b179de7798bbb7c4aeacdc0df6bf62439`；校验运行于 Node.js 22 或更高版本，CI 使用 Node.js 22 和推送前／PR 基线检查归档只增不改。
- `.gitattributes` 将文本换行统一为 LF，避免跨平台检出改变归档哈希；`.gitignore` 排除依赖、构建输出、凭据和生成的看板。

## Related notes

初始化前活跃笔记为空，没有需要更新、否决或归档的旧决定。后续产品与运行时架构选择另行记录，不由本次流程决策预设。

## Alternatives considered

- **只写普通 Markdown 或传统 ADR**：文件少、学习成本低，也能记录理由；但用户明确要求本系统，标准 ADR 没有现成的状态分类、归档封印与校验脚本，需要另行维护约定，因此本次采用上游实现。
- **仅在开发者全局目录安装技能**：多个项目可以共享一份文件，更新方便；但新机器、其他协作者和 CI 无法从本仓库恢复同一套规则，因此采用项目级随仓库分发。
- **每次用 npx 临时获取 tsx**：无需维护开发依赖，适合快速试用；但每次联网和解析工具版本削弱可复现性，因此通过 package-lock.json 固定本地依赖。

## Consequences

- 收益：规则、模板和脚本随仓库恢复，后续会话与 CI 使用同一份实现，笔记不依赖聊天记录和开发者全局目录。
- 随仓库维护上游技能增加文件体积，更新时需要显式审阅与校验。
- 机械门禁只能检查结构、链接和封印，不能证明决策内容准确或备选分析充分。
- GitHub Actions 配置随仓库保存，托管至 GitHub 后才执行远端校验；本地提交信息钩子由[提交规范决策](2026-10-24-git-commit-message-convention.md)定义，笔记校验仍在提交前手动运行。
- 当前尚无应用功能；Electron、React 具体版本、打包方案、模型接入和媒体处理架构需要后续决策。
- 若笔记维护成本失衡，优先收窄记录到非平凡改动；不以新增总索引或跳过校验替代问题分析。

## Verification

- `npm ci`：从锁文件恢复开发依赖。
- `npm run verify-notes`：检查目录与相对链接、状态与必备章节、归档封印及历史基线。
- `npm run init-board`、`npm run bundle-board`：生成日常直读和静态分发两种看板。
- `git check-ignore board.html demo.html node_modules/`：确认生成产物和依赖不进入版本控制。
- `git diff --cached --check`：检查首次提交内容的空白错误。

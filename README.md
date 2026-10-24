# Frame Loom

基于 **Electron + React** 的多模态 AI 智能影视工作台桌面 PC 应用。

当前阶段完成 Git 仓库和决策笔记系统初始化，尚无可启动的应用程序。Electron／React 版本、工程骨架、模型服务和媒体处理方案在后续开发时确定。

## 准备环境

- Git
- Node.js 22.12.0 或更高版本（本地与 CI 当前使用 Node.js 22）
- npm

```sh
npm ci
npm run setup:git
npm run verify-notes
```

## 决策笔记

采用 [write-notes-like-deepseek](https://github.com/czm15053/write-notes-like-deepseek) 的标准结构、模板及校验脚本，技能随仓库分发。

- [协作约定](AGENTS.md)：后续开发与 AI 会话的入口。
- [操作指南](docs/decision-notes.md)：何时记录、如何流转、归档和校验。
- [技能契约](.agents/skills/write-notes-like-deepseek/SKILL.md)：上游完整方法。
- [已落地的流程决策](.agents/notes/implemented/process/2026-10-24-repository-and-decision-notes.md)：本次初始化的理由与取舍。

```sh
# 生成本地看板，之后用浏览器打开 board.html
npm run init-board

# 生成可独立分发的静态看板 demo.html
npm run bundle-board
```

两个 HTML 文件均为生成产物，不纳入 Git。`.github/workflows/verify-notes.yml` 已配置三项校验；推送至 GitHub 后在 main 推送、拉取请求或手动触发时运行。

## Git 提交

遵循 [Git 提交信息规范](docs/git-commit-convention.md)：`type(scope): 中文摘要`，范围可省略。Husky 在提交时调用 commitlint，CI 在 Ubuntu／Windows 复检新增提交。

`npm ci` 自动准备钩子，`npm run setup:git` 为当前仓库设置钩子和消息模板。日常仍使用 `git commit`；规则测试执行 `npm run test:commit-convention`。

# Frame Loom

基于 **Electron + React** 的多模态 AI 智能影视工作台桌面 PC 应用。

当前包含 pnpm workspace、共享契约、NestJS engine、Electron／React 桌面壳、项目库与项目画布。模型服务使用渠道＋模型配置、15 个代码协议和用户能力卡；画布支持图像、视频、TTS 音频及图片编辑。模型调用通过本地模拟验证，真实服务、Agent、代码签名与自动更新尚未验收或实现。支持与验证边界见[模型服务验收](docs/model-service-acceptance.md)。已有 Windows x64 NSIS 打包基础，本轮重构未重新执行打包验收。

项目支持内容形式、制作媒介和题材设定，以及正式剧集。每集可粘贴原文转换为结构化剧本，也可从空白场标题开始写；三栏编辑器提供场次大纲、段落类型与拖放、存疑处理、人物补全、元素高亮、自动保存和冲突保护。设定库管理人物、场景、道具和服装，支持确认、合并、忽略、恢复及跨集出现位置跳转。没有默认文本模型时使用规则；配置模型后也只接收标签，剧本文字仍取自原文。

剧本的自动化验收、截图、性能与原生输入法人工检查状态见[实施验收记录](.agents/plans/2026-10-29-episodes-and-scripts/10-acceptance.md)。3000 段输入仍有性能限制，数据如实记录，不作为流畅度达标承诺。

剧本支持 Markdown 导入识别、前言与附录、制作提示、角色表入库及样式／Markdown 双向编辑；元素标记默认关闭，视图与标记开关保存在本机偏好。配置文本模型时，全部正文行参与分类，模型仍只输出标签。新写入剧本采用 schema v2，读取 v1 自动迁移，旧版本应用不能读取 v2。真实样例、重启偏好及明暗小窗口的验收见[导入修正验收](.agents/plans/2026-10-30-script-import-fix/06-acceptance.md)。本轮未重做安装包验收。

## 准备环境

- Git
- Node.js 24.22.x（`.nvmrc` 与 CI 使用相同版本线）
- Corepack（通过 `package.json` 的 `packageManager` 固定 pnpm 12.15.0）

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm run setup:git
pnpm run verify
```

## 桌面开发

```sh
pnpm dev        # 先构建 contracts 和 engine，再打开桌面窗口
```

侧栏底部的设置中心提供主题快捷切换，点击面板中的「设置」打开分栏模态窗口，查看外观、本地引擎与关于信息。主题重启后保持，健康异常显示中文错误与入口圆点。首页创作控件暂不可操作。修改 engine 源码后需要重启命令；关闭窗口会回收服务进程。开发和生产共用 `%APPDATA%\Frame Loom` 数据目录，使用说明见[桌面壳](apps/desktop/README.md)，后续界面遵守 [UI 规范](docs/ui-guidelines.md)。

Windows x64 打包与冒烟测试：

```sh
pnpm package:win
pnpm --filter @frame-loom/desktop test:e2e
```

安装包输出到 `apps/desktop/release/Frame Loom Setup 0.1.0.exe`；卸载保留用户数据。自动冒烟使用构建产物，生产加固 exe 的真实安装／卸载另行验证，具体边界见[桌面使用说明](apps/desktop/README.md#windows-打包与冒烟测试)。Windows CI 上传构建产物，不发布；远端工作流尚未运行。

## 共享契约

`packages/contracts` 用 zod 定义 `HealthResponse`、`EngineConnection`，同时导出同名的推导类型。后续 workspace 包通过 `workspace:*` 依赖 `@frame-loom/contracts`；运行时数据使用 schema 的 `parse` 校验。

```sh
pnpm build       # 构建各 workspace 包，contracts 输出 ESM 与声明文件
pnpm test        # 运行各包的单元测试
pnpm typecheck   # 检查源码与测试的类型
pnpm lint        # 检查异步调用、React 与 Query 规则、导入边界
pnpm format:check # 检查格式；pnpm format 可自动格式化
```

契约边界与构建方式见[共享契约决策](.agents/notes/implemented/architecture/2026-10-24-shared-contracts.md)。

## 本地 engine

`apps/engine` 使用 NestJS 12、Express、better-sqlite3 与 Drizzle。配置与独立部署方法见 [engine 使用说明](apps/engine/README.md)。迁移前的开发副本需重新执行 `pnpm install`，更新 workspace 链接。

```sh
pnpm --filter @frame-loom/engine... build
pnpm --filter @frame-loom/engine test
pnpm deploy:engine .cache/engine-deploy
```

部署命令先构建 contracts 与 engine，再执行 `pnpm --filter @frame-loom/engine deploy --prod <输出目录>`。产物自带迁移和生产依赖，运行时仍需传入令牌与绝对数据目录。

## 决策笔记

采用 [write-notes-like-deepseek](https://github.com/czm15053/write-notes-like-deepseek) 的标准结构、模板及校验脚本，技能随仓库分发。

- [协作约定](AGENTS.md)：后续开发与 AI 会话的入口。
- [操作指南](docs/decision-notes.md)：何时记录、如何流转、归档和校验。
- [技能契约](.agents/skills/write-notes-like-deepseek/SKILL.md)：上游完整方法。
- [已落地的流程决策](.agents/notes/implemented/process/2026-10-24-repository-and-decision-notes.md)：本次初始化的理由与取舍。

```sh
# 生成本地看板，之后用浏览器打开 board.html
pnpm run init-board

# 生成可独立分发的静态看板 demo.html
pnpm run bundle-board
```

两个 HTML 文件均为生成产物，不纳入 Git。`.github/workflows/verify-notes.yml` 已配置三项校验；推送至 GitHub 后在 main 推送、拉取请求或手动触发时运行。

## 实施计划

跨多次提交或会话的大型任务在 `.agents/plans/` 写实施计划，通过 `Note:` 链接对应决策笔记；大型需求使用父计划加同级子计划，最多两层。规则由项目自有的 [todo-plan 技能](.agents/skills/todo-plan/SKILL.md)定义，操作见[实施计划指南](docs/plans.md)。

```sh
pnpm run verify-plans   # 校验计划
pnpm run verify         # 提交前运行：笔记 + 计划
```

## Ponytail 技能

`.agents/skills/` 随仓库分发 [Ponytail](https://github.com/DietrichGebert/ponytail) 的六个技能（`ponytail`、`ponytail-review`、`ponytail-audit`、`ponytail-debt`、`ponytail-help`、`ponytail-gain`），约束 AI 代理写最小且完整的改动。用法与优先级见[协作约定](AGENTS.md)，来源与选型理由见[决策笔记](.agents/notes/implemented/process/2026-10-24-ponytail-skills.md)。

## Git 提交

遵循 [Git 提交信息规范](docs/git-commit-convention.md)：`type(scope): 中文摘要`，范围可省略。Husky 在提交时调用 commitlint，CI 在 Ubuntu／Windows 复检新增提交。

`pnpm install --frozen-lockfile` 自动准备钩子，`pnpm run setup:git` 为当前仓库设置钩子和消息模板。日常仍使用 `git commit`；规则测试执行 `pnpm run test:commit-convention`。

首次全仓格式化使用独立提交，完整 SHA 保存在 `.git-blame-ignore-revs`。当前副本可配置 blame 跳过该提交：

```sh
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

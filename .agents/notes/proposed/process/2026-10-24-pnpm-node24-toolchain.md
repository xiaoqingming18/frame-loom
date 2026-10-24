# Agent Note: 工具链切换到 pnpm workspace 与 Node 24.22

Status: proposed

## Problem

仓库目前用 npm：`package.json` 里声明 `engines.node >=22.12.0`，依赖由 `package-lock.json` 锁定。本机装的是 Node 22.23.2，GitHub Actions 两个工作流都用 Node 22 加 `npm ci`。`AGENTS.md`、`README.md` 和 `docs/` 下的指南都写着 `npm ci`、`npm run verify`。

应用骨架要建三个包，需要 workspace。现有工具链有两个问题：

- **Node 版本对不上。** engine 运行在 Electron 45 的 `utilityProcess` 里，用的是 Electron 内置的 Node 24.22.0。如果开发和测试用 Node 22 或 26，可能用到线上运行时没有的特性，或者正好漏测线上才有的行为。
- **Node 版本下限不够。** pi 要求 Node 22.19 以上。NestJS 12 的 `nest new`、`nest g` 这类脚手架命令要求 Node 22.22.3+、24.15+ 或 26+（见 [Nest 迁移指南](https://docs.nestjs.com/migration-guide)）。

## Proposal

### Node

- 开发和 CI 统一用 Node 24.22.x，跟 Electron 45 内置的 Node 24.22.0 保持一致：
  - 根目录 `.nvmrc` 写 `24.22`。
  - 根目录 `package.json` 的 `engines.node` 改成 `>=24.22.0 <25`。
  - 两个 GitHub Actions 工作流的 `node-version` 改为 `24.22`。
- Electron 升级到内置新的 Node 主版本时，开发和 CI 的 Node 在同一提交里跟着升。
- Node 24 已于 2026-10-20 进入 Maintenance LTS，支持到 2028-04-30（见 [Node 发布计划](https://github.com/nodejs/release)）。

### pnpm

- 根目录 `package.json` 写 `"packageManager": "pnpm@<精确版本>"`，用 Node 24 自带的 Corepack 安装。2026-10-24 的最新版本是 12.15.0。
- 新增 `pnpm-workspace.yaml`，包含 `apps/*`、`services/*`、`packages/*` 三个目录。
- 依赖构建脚本的白名单写在 `pnpm-workspace.yaml` 的 `allowBuilds` 里。pnpm 11 起已经不认 `onlyBuiltDependencies`；pnpm 12 遇到没登记的构建脚本会直接让安装失败（见 [pnpm 迁移说明](https://pnpm.io/migration)）。白名单只登记真正需要构建的包，安装时按报错逐个确认。
- 保持 pnpm 默认的 isolated 链接方式，不设 `node-linker=hoisted`。desktop 的运行时依赖全部打进 electron-vite 产物，engine 用 `pnpm deploy` 生成独立目录，所以 electron-builder 不需要从 pnpm 的 `node_modules` 收集依赖。
- 删除 `package-lock.json`，改为提交 `pnpm-lock.yaml`。

### 命令与文档

- 根目录脚本内部仍用 `npm run` 串联的部分（`verify-notes`、`verify`），改成 `pnpm run`。脚本名不变。
- 下列文件里的 `npm ci`、`npm run …` 改成 `pnpm install --frozen-lockfile`、`pnpm …`，Node 版本说明同步更新：
  - `AGENTS.md`、`README.md`
  - `docs/decision-notes.md`、`docs/plans.md`、`docs/git-commit-convention.md`
- `.github/workflows/verify-notes.yml` 和 `verify-commits.yml` 增加 `pnpm/action-setup`，`setup-node` 的缓存改为 `pnpm`。
- Husky 继续由根目录的 `prepare` 脚本安装。`pnpm install` 会执行根项目的 `prepare`，这一点要实测。
- 以下已实现笔记里关于 npm、Node 22 的描述，在落地时就地同步，它们的决定本身不变：
  - [仓库与决策笔记初始化](../../implemented/process/2026-10-24-repository-and-decision-notes.md)
  - [提交规范](../../implemented/process/2026-10-24-git-commit-message-convention.md)

## Alternatives considered

- **继续用 npm workspaces**：不用改任何约定和文档，仓库现有的流程原样可用。用户明确选了 pnpm，参考项目（OpenWork、OpenReel、竞品）也都用 pnpm，它的严格依赖隔离能防止 workspace 包偷用没声明的依赖。
- **开发用 Node 26 LTS**：2026-10-28 就进入 Active LTS，支持期更长。但它和 engine 实际运行的 Electron 内置 Node 24.22 不一致，测试通过不代表线上能跑。等 Electron 换到 Node 26 时再一起升级。
- **开发用 Node 22**：本机现在就是 22，不用升级。但它满足不了 Nest 12 脚手架的要求，和运行时也不一致。
- **设置 `node-linker=hoisted` 迁就 electron-builder**：这是 electron-builder 文档长期的推荐做法，社区例子多。但会失去 pnpm 的依赖隔离，而且这个仓库的打包路径不需要它（desktop 的依赖全部打进产物，engine 用 `pnpm deploy`）。

## Acceptance criteria

- 新克隆仓库后，执行 `corepack enable`、`pnpm install --frozen-lockfile`、`pnpm run setup:git` 能装好依赖并启用提交钩子。
- 下列命令在 Node 24.22 下全部通过：
  - `pnpm run verify`
  - `pnpm run test:plans`
  - `pnpm run test:commit-convention`
- 仓库里没有 `package-lock.json`，`.nvmrc` 和 `packageManager` 字段存在。
- 用 `rg "npm (ci|run)"` 搜索文档和工作流，只剩下有意保留的上游技能原文（`.agents/skills/` 不改）。

## Risks

- 本机需要从 Node 22.23.2 升到 24.22.x。这是对用户机器的操作，由用户执行或确认。
- `test:commit-convention` 里如果有依赖 npm 的路径或缓存目录，需要调整。切换时要跑全量测试确认。
- 上游 `write-notes-like-deepseek` 技能的说明里写的是 `npm run`，不改它，但会和项目文档里的命令不一致。项目文档以 pnpm 为准，由 `AGENTS.md` 注明。
- pnpm 12 发布不久，`allowBuilds` 的语义可能还会变。版本已由 `packageManager` 锁定，升级时单独提交。

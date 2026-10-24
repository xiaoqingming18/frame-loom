# Agent Note: 工具链切换到 pnpm workspace 与 Node 24.22

Status: implemented

## Problem

迁移前仓库用 npm：`package.json` 里声明 `engines.node >=22.12.0`，依赖由 `package-lock.json` 锁定。GitHub Actions 两个工作流都用 Node 22 加 npm。执行时本机已升级为 Node 24.22.1，并安装 Corepack 0.36.0，但尚未启用 pnpm。项目文档与 CI 需要同步到新工具链。

应用骨架要建三个包，需要 workspace。现有工具链有两个问题：

- **Node 版本对不上。** [应用骨架](../architecture/2026-10-24-desktop-stack-and-process-model.md)让 engine 运行在 Electron 45 的 `utilityProcess` 里，使用其内置的 Node 24.22.0。如果开发和测试用 Node 22 或 26，可能用到目标运行时没有的特性，或者漏测目标运行时才有的行为。本篇记录工具链，应用包边界见应用骨架。
- **Node 版本下限不够。** pi 要求 Node 22.19 以上。NestJS 12 的 `nest new`、`nest g` 这类脚手架命令要求 Node 22.22.3+、24.15+ 或 26+（见 [Nest 迁移指南](https://docs.nestjs.com/migration-guide)）。

## Decision

### Node

- 开发和 CI 统一用 Node 24.22.x，跟 Electron 45 内置的 Node 24.22.0 保持一致：
  - 根目录 `.nvmrc` 写 `24.22`。
  - 根目录 `package.json` 的 `engines.node` 改成 `>=24.22.0 <25`。
  - 两个 GitHub Actions 工作流的 `node-version` 改为 `24.22`。
- Electron 升级到内置新的 Node 主版本时，开发和 CI 的 Node 在同一提交里跟着升。
- Node 24 已于 2026-10-20 进入 Maintenance LTS，支持到 2028-04-30（见 [Node 发布计划](https://github.com/nodejs/release)）。

### pnpm

- 根目录 `package.json` 写 `"packageManager": "pnpm@12.15.0"`，通过 `corepack enable pnpm` 启用命令，由 Corepack 安装精确版本。2026-10-24 查询 [npm registry](https://registry.npmjs.org/pnpm/latest) 的最新稳定版本为 12.15.0；在线结果可能随时间变化，仓库以锁定版本为准。
- `pnpm-workspace.yaml` 包含 `apps/*`、`packages/*` 两个目录，engine 与 desktop 均放在 `apps/`。
- 依赖构建脚本的白名单写在 `pnpm-workspace.yaml` 的 `allowBuilds` 里。pnpm 11 起已经不认 `onlyBuiltDependencies`；pnpm 12 遇到没登记的构建脚本会直接让安装失败（见 [pnpm 迁移说明](https://pnpm.io/migration)）。白名单只登记已审核的包版本，不关闭默认构建审核。
- 仓库保持 pnpm 默认的 isolated 链接方式，不设全仓 `node-linker=hoisted`。desktop 依赖打入 electron-vite 产物；Windows 打包时单独对 engine 的 `pnpm deploy` 使用 `--node-linker=hoisted`，消除分发目录指回仓库的 Windows 目录链接，开发布局不变。
- 删除 `package-lock.json`，改为提交 `pnpm-lock.yaml`。
- 先用 `pnpm import` 导入旧锁文件，保留现有依赖版本，再删除旧文件。实测 `tsx` 的间接依赖 `esbuild@0.28.2` 会触发 `ERR_PNPM_IGNORED_BUILDS`；审阅其二进制准备与版本校验脚本后，仅为该版本配置 `allowBuilds`，保留默认拒绝其他未审核构建的行为。配置语义见 [pnpm 构建设置](https://pnpm.io/settings/build#allowbuilds)。

### 命令与文档

- 根目录的 `verify-notes`、`verify` 通过 `pnpm run` 串联，脚本名不变。
- 下列文件里的安装命令统一为 `pnpm install --frozen-lockfile`，脚本调用统一为 `pnpm run …`，Node 版本说明同步更新；带参数的脚本直接追加参数，不沿用 npm 的额外 `--`：
  - `AGENTS.md`、`README.md`
  - `docs/decision-notes.md`、`docs/plans.md`、`docs/git-commit-convention.md`
- `.github/workflows/verify-notes.yml` 和 `verify-commits.yml` 在 `setup-node` 之前使用 `pnpm/action-setup@v4`，版本从 `packageManager` 读取，缓存改为 `pnpm`，保留原有历史基线与 CI 跳过钩子的配置。顺序和版本读取依据见 [action-setup 说明](https://github.com/pnpm/action-setup/tree/v4#use-cache-to-reduce-installation-time)。
- Husky 继续由根目录的 `prepare` 脚本安装。冻结安装会执行根项目的 `prepare`，全新 Git 仓库安装后生成 `.husky/_/commit-msg`，并设置 `core.hooksPath=.husky/_`。
- 就地同步[仓库与决策笔记初始化](2026-10-24-repository-and-decision-notes.md)、[提交规范](2026-10-24-git-commit-message-convention.md)、[计划工作流](2026-10-24-todo-plan-workflow.md)、[Ponytail 技能](2026-10-24-ponytail-skills.md)中的命令及工具事实，决定本身不变。上游技能保留原文，由 `AGENTS.md` 说明命令映射。

## Alternatives considered

- **继续用 npm workspaces**：不用改任何约定和文档，仓库现有的流程原样可用。用户明确选了 pnpm，参考项目（OpenWork、OpenReel、竞品）也都用 pnpm，它的严格依赖隔离能防止 workspace 包偷用没声明的依赖。
- **开发用 Node 26 LTS**：2026-10-28 就进入 Active LTS，支持期更长。但它和 engine 实际运行的 Electron 内置 Node 24.22 不一致，测试通过不代表线上能跑。等 Electron 换到 Node 26 时再一起升级。
- **开发用 Node 22**：沿用原工具链，无需改变既有环境约定。但原 Node 22.23.2 和目标运行时不一致，更早的 Node 22 还满足不了 Nest 12 脚手架的要求。
- **全仓设置 `node-linker=hoisted` 迁就 electron-builder**：这是 electron-builder 文档长期的推荐做法，社区例子多。但会失去开发依赖隔离；desktop 的依赖全部打进产物，engine 仅在分发部署时生成 hoisted 树，不需要改变全仓布局。

## Consequences

- 收益：workspace 目录约定、Node 版本线、包管理器和依赖版本随仓库恢复，本地与 CI 使用同一套安装与校验命令；依赖隔离保留，现有业务代码和应用依赖未引入。
- 代价：开发环境需要 Node 24.22.x 与已启用 pnpm 的 Corepack；构建脚本升级或新增时必须重新审核。pnpm 12 的行为由精确版本锁定，升级时单独提交。
- `esbuild` 的安装脚本获得执行权限，仅批准 `0.28.2`；其他依赖仍受默认审核限制。首轮冻结安装确认不登记会失败，登记后安装脚本与根 `prepare` 均执行成功。
- 上游技能原文继续包含 `npm run`，本仓库命令以项目指南和 `AGENTS.md` 为准；迁移说明中保留旧命令是有意记录。
- 远端 GitHub Actions 尚未执行，Ubuntu 与 Windows 工作流仅完成配置审阅；Electron、engine 和安装包的后续本地验证记录见应用骨架，不能替代远端 CI。

## Verification

- 本机 `node --version` 为 `v24.22.1`，Corepack 为 `0.36.0`，`corepack pnpm --version` 为 `12.15.0`。
- `pnpm import` 导入旧锁文件；断言确认原锁文件的 101 个包版本都保留在新锁文件中，直接开发依赖版本未变。
- `pnpm install --frozen-lockfile` 和 `pnpm run setup:git` 通过，`core.hooksPath` 为 `.husky/_`。
- 在 `node_modules/.cache/` 中新建隔离 Git 仓库，仅复制安装与钩子所需文件；安装前不存在 `.husky/_`，冻结安装成功后存在 `.husky/_/commit-msg`，且钩子路径正确。未改动原测试 fixture 缓存约定。
- `pnpm run test:plans` 通过，37 项测试无失败；`pnpm run test:commit-convention` 通过，29 项测试无失败，包含真实 Git 钩子的合法／非法提交和 CI 跳过场景。
- `pnpm run verify` 通过：7 篇笔记的目录、链接、格式及归档封印，6 份计划的结构、状态与依赖均合规。
- 文档与 CI 扫描确认只保留有意的旧命令映射和迁移说明；`git diff --check` 通过。远端 CI 未运行。

# Plan: 工具链迁移到 pnpm 与 Node 24.22

Status: done
Parent: plan.md
Note: ../../notes/implemented/process/2026-10-24-pnpm-node24-toolchain.md

## 目标

仓库的现有能力（笔记校验、计划校验、提交钩子、提交规范测试）在 Node 24.22 加 pnpm 下全部可用。npm 相关的文件和说明全部换掉。本子计划只换工具链，不新增应用包。

## 前置条件

- 本机已装好 Node 24.22.1，`node -v` 输出 `v24.22.1`，无需升级 Node。
- Corepack 0.36.0 已安装；安装依赖前执行 `corepack enable pnpm`。

## 步骤

- [x] T1 新增 `.nvmrc`，内容为 `24.22`；根目录 `package.json` 的 `engines.node` 改成 `>=24.22.0 <25`，并加上 `"packageManager": "pnpm@12.15.0"`（以执行当天的最新稳定版为准，写精确版本） — 验证：`corepack pnpm -v` 输出与该字段一致
- [x] T2 新增 `pnpm-workspace.yaml`，`packages` 写 `apps/*`、`services/*`、`packages/*` 三项，三个包由后续子计划创建。先用 `pnpm import` 保留旧锁文件的依赖版本；按安装结果仅允许已审核的 `esbuild@0.28.2` 构建脚本 — 验证：`pnpm install` 成功，并生成 `pnpm-lock.yaml`
- [x] T3 删除 `package-lock.json`。把根脚本 `verify-notes`、`verify` 里的 `npm run` 改成 `pnpm run` — 验证：`pnpm run verify` 通过
- [x] T4 确认 `pnpm install` 会执行根项目的 `prepare`，也就是 `scripts/setup-git.mjs --hooks-only` — 验证：没有 `.husky/_` 的隔离 Git 仓库执行冻结安装后生成 `commit-msg` 钩子，`git config --local core.hooksPath` 输出 `.husky/_`
- [x] T5 运行提交规范测试和计划测试。测试 fixture 用的缓存目录是 `node_modules/.cache`，pnpm 下这个目录依然存在，确认不需要改 — 验证：`pnpm run test:commit-convention`、`pnpm run test:plans` 通过
- [x] T6 修改 `.github/workflows/verify-notes.yml` 和 `verify-commits.yml`：在 `setup-node` 之前加 `pnpm/action-setup`；`node-version` 改为 `24.22`，`cache` 改为 `pnpm`；`npm ci` 改为 `pnpm install --frozen-lockfile`；`npm run` 改为 `pnpm run` — 验证：用 `rg '\bnpm ' .github/` 搜不到结果
- [x] T7 修改 `AGENTS.md`、`README.md`、`docs/decision-notes.md`、`docs/plans.md`、`docs/git-commit-convention.md`，把命令和 Node 版本说明改成 pnpm 与 Node 24.22。在 `AGENTS.md` 注明：上游技能原文里的 `npm run` 对应本仓库的 `pnpm run` — 验证：用 `rg --hidden -g '!.agents/skills/**' -g '!node_modules/**' -g '!.git/**' -g '!pnpm-lock.yaml' '\bnpm (ci|run|install)'` 只能搜到有意保留的说明
- [x] T8 就地同步两篇已实现笔记里的工具事实：[仓库初始化](../../notes/implemented/process/2026-10-24-repository-and-decision-notes.md)中 `npm ci`、`package-lock.json`、Node 22 的描述；[提交规范](../../notes/implemented/process/2026-10-24-git-commit-message-convention.md)中 `npm ci` 和 CI 使用 Node 22 的描述。决定本身不改 — 验证：`pnpm run verify-notes` 通过
- [x] T9 把工具链笔记移到 `.agents/notes/implemented/process/`，按实际结果改写：`Status` 改为 implemented，`## Proposal` 改成现在时的 `## Decision`，验收和风险并入 `## Consequences` 与 `## Verification`。同时更新 `plan.md` 和本文件的 `Note:` 路径，以及架构笔记里指向它的相对链接 — 验证：`pnpm run verify` 通过
- [x] T10 提交 `build: 工具链切换到 pnpm 与 Node 24.22`，带 `Note:` 和 `Plan:` 尾注 — 验证：`commit-msg` 钩子通过；`git show --stat` 显示新增 `pnpm-lock.yaml`、删除 `package-lock.json`，笔记已移动

## 验证

- 预期：Node 24.22 下 `pnpm install --frozen-lockfile`、`pnpm run verify`、`pnpm run test:plans`、`pnpm run test:commit-convention` 全部通过；提交时钩子生效。
- 实际：Node 24.22.1、Corepack 0.36.0、pnpm 12.15.0 下冻结安装与 `setup:git` 通过；隔离 Git 仓库全新安装自动生成钩子。旧锁文件的 101 个包版本全部保留。
- `pnpm run verify`：7 篇笔记、6 份计划通过校验；`pnpm run test:plans`：37 项通过；`pnpm run test:commit-convention`：29 项通过，含真实 Git 钩子集成检查。
- `.github/` 无 npm 命令，项目文档仅保留命令映射与迁移说明；`git diff --check` 通过。GitHub Actions 配置已审阅，远端尚未运行。

## 进度

- 2026-10-24：创建子计划草稿。
- 2026-10-24：用户授权执行子计划 01；确认本机 Node 24.22.1、Corepack 0.36.0，npm registry 的 pnpm 最新稳定版为 12.15.0，开始迁移。
- 2026-10-24：完成 T1–T9，锁文件导入、构建许可、冻结安装、全新安装钩子验证和 66 项测试通过；工具链笔记已移入 `implemented/`，与 T10 的工具链提交同批落盘。

## 发现与偏差

- 首次冻结安装执行根 `prepare` 后，以 `ERR_PNPM_IGNORED_BUILDS` 拒绝 `tsx` 的间接依赖 `esbuild@0.28.2`。T2 从暂不配置 `allowBuilds` 调整为仅批准该版本；安装脚本已审阅，处理二进制准备与版本校验，继续拒绝其他未审核构建。依据见[工具链笔记](../../notes/implemented/process/2026-10-24-pnpm-node24-toolchain.md)。
- 自动审批审核拒绝删除现有 `.husky/_`，仅返回 `blocked by policy`。T4 改为在没有生成钩子的隔离 Git 仓库内执行冻结安装，实测安装后自动生成钩子，不改动现有钩子。
- 另两篇已实现笔记（计划工作流、Ponytail 技能）仍有旧脚本命令，按 T7 的扫描标准同步为 pnpm；上游技能原文保持不变。

## 交接

无。

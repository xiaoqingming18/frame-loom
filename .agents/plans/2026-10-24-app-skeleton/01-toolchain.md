# Plan: 工具链迁移到 pnpm 与 Node 24.22

Status: draft
Parent: plan.md
Note: ../../notes/proposed/process/2026-10-24-pnpm-node24-toolchain.md

## 目标

仓库的现有能力（笔记校验、计划校验、提交钩子、提交规范测试）在 Node 24.22 加 pnpm 下全部可用。npm 相关的文件和说明全部换掉。本子计划只换工具链，不新增应用包。

## 前置条件

- 本机已装好 Node 24.22.x。用户确认升级方式（nvm-windows、fnm 或安装包均可）之后，`node -v` 输出 `v24.22.*`。
- 执行过 `corepack enable`。

## 步骤

- [ ] T1 新增 `.nvmrc`，内容为 `24.22`；根目录 `package.json` 的 `engines.node` 改成 `>=24.22.0 <25`，并加上 `"packageManager": "pnpm@12.15.0"`（以执行当天的最新稳定版为准，写精确版本） — 验证：`corepack pnpm -v` 输出与该字段一致
- [ ] T2 新增 `pnpm-workspace.yaml`，`packages` 写 `apps/*`、`services/*`、`packages/*` 三项。这些目录现在还是空的，三个包由后续子计划创建。`allowBuilds` 暂不填 — 验证：`pnpm install` 成功，并生成 `pnpm-lock.yaml`
- [ ] T3 删除 `package-lock.json`。把根脚本 `verify-notes`、`verify` 里的 `npm run` 改成 `pnpm run` — 验证：`pnpm run verify` 通过
- [ ] T4 确认 `pnpm install` 会执行根项目的 `prepare`，也就是 `scripts/setup-git.mjs --hooks-only` — 验证：删掉 `.husky/_` 后重新执行 `pnpm install`，`git config --local core.hooksPath` 输出 `.husky/_`
- [ ] T5 运行提交规范测试和计划测试。测试 fixture 用的缓存目录是 `node_modules/.cache`，pnpm 下这个目录依然存在，确认不需要改 — 验证：`pnpm run test:commit-convention`、`pnpm run test:plans` 通过
- [ ] T6 修改 `.github/workflows/verify-notes.yml` 和 `verify-commits.yml`：在 `setup-node` 之前加 `pnpm/action-setup`；`node-version` 改为 `24.22`，`cache` 改为 `pnpm`；`npm ci` 改为 `pnpm install --frozen-lockfile`；`npm run` 改为 `pnpm run` — 验证：用 `rg "npm " .github/` 搜不到结果
- [ ] T7 修改 `AGENTS.md`、`README.md`、`docs/decision-notes.md`、`docs/plans.md`、`docs/git-commit-convention.md`，把命令和 Node 版本说明改成 pnpm 与 Node 24.22。在 `AGENTS.md` 注明：上游技能原文里的 `npm run` 对应本仓库的 `pnpm run` — 验证：用 `rg --hidden -g '!.agents/skills/**' -g '!node_modules' -g '!pnpm-lock.yaml' "npm (ci|run|install)"` 只能搜到有意保留的说明
- [ ] T8 就地同步两篇已实现笔记里的工具事实：[仓库初始化](../../notes/implemented/process/2026-10-24-repository-and-decision-notes.md)中 `npm ci`、`package-lock.json`、Node 22 的描述；[提交规范](../../notes/implemented/process/2026-10-24-git-commit-message-convention.md)中 `npm ci` 和 CI 使用 Node 22 的描述。决定本身不改 — 验证：`pnpm run verify-notes` 通过
- [ ] T9 把工具链笔记移到 `.agents/notes/implemented/process/`，按实际结果改写：`Status` 改为 implemented，`## Proposal` 改成现在时的 `## Decision`，验收和风险并入 `## Consequences` 与 `## Verification`。同时更新 `plan.md` 和本文件的 `Note:` 路径，以及架构笔记里指向它的相对链接 — 验证：`pnpm run verify` 通过
- [ ] T10 提交 `build: 工具链切换到 pnpm 与 Node 24.22`，带 `Note:` 和 `Plan:` 尾注 — 验证：`commit-msg` 钩子通过；`git show --stat` 显示新增 `pnpm-lock.yaml`、删除 `package-lock.json`，笔记已移动

## 验证

- 预期：Node 24.22 下 `pnpm install --frozen-lockfile`、`pnpm run verify`、`pnpm run test:plans`、`pnpm run test:commit-convention` 全部通过；提交时钩子生效。
- 实际：未执行。

## 进度

- 2026-10-24：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始。下一步是用户在本机安装 Node 24.22.x，然后从 T1 开始。工具链笔记在本子计划的 T9 移入 `implemented/`，架构笔记要等 05 完成后再移。

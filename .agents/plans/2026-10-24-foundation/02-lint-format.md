# Plan: ESLint 与 Prettier

Status: draft
Parent: plan.md
Note: ../../notes/proposed/process/2026-10-24-lint-and-format.md

## 目标

在根目录建立 ESLint flat config 与 Prettier，修复现有代码的 lint 报错，完成一次只改格式的全仓格式化，并接入 Windows CI。规则、忽略范围和版本见笔记。

## 前置条件

- 01 完成，engine 位于 `apps/engine`。
- 没有其他未合并分支，避免全仓格式化造成冲突。

## 步骤

- [ ] T1 以精确版本在根 `devDependencies` 安装笔记版本表中的包，确认无需新增 `allowBuilds` — 验证：`pnpm install --frozen-lockfile` 通过
- [ ] T2 编写 `eslint.config.js`：`recommendedTypeChecked` 加 `projectService`、renderer 的 React 与 TanStack Query 插件、`import-x/no-restricted-paths` 边界区、`eslint-config-prettier`、忽略列表 — 验证：`pnpm exec eslint --print-config apps/desktop/src/renderer/src/main.tsx` 包含边界规则
- [ ] T3 根脚本加入 `lint`、`format`、`format:check`，编写 `.prettierrc.json` 与 `.prettierignore` — 验证：`pnpm format:check` 只报告格式差异，不报告 `.agents/`、`docs/`、生成文件
- [ ] T4 修复现有代码的 lint 报错，不改变行为；无法修复的规则在配置中关闭并写明原因 — 验证：`pnpm lint` 通过，`pnpm test`、`pnpm typecheck` 通过
- [ ] T5 用临时文件验证边界反例：renderer 一个 feature 导入另一个 feature、renderer 导入 `src/main`、engine 导入 desktop — 验证：三处 `pnpm lint` 均报错；删除临时文件后通过
- [ ] T6 在 `.github/workflows/build.yml` 的单测与类型检查之后加入 `pnpm lint` 与 `pnpm format:check` — 验证：配置审阅；远端未执行时如实记录
- [ ] T7 提交 `build: 引入 ESLint 与 Prettier`，包含配置、脚本、CI 与 lint 修复，带 `Note:` 与 `Plan:` 尾注 — 验证：提交钩子与 `pnpm run verify` 通过
- [ ] T8 运行 `pnpm format`，单独提交 `style: 全仓格式化` — 验证：`git diff --stat` 不含 `.agents/`；`pnpm typecheck`、`pnpm test`、`pnpm format:check` 通过
- [ ] T9 把 T8 提交的完整 SHA 写入 `.git-blame-ignore-revs`，README 说明 `git config blame.ignoreRevsFile .git-blame-ignore-revs`，作为 `chore` 提交 — 验证：`git blame` 在配置后跳过格式化提交

## 验证

- 预期：`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`、`pnpm run verify` 全部通过；边界反例报错；格式化提交只含格式改动。
- 实际：未执行。

## 进度

- 2026-10-24：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始，等待 01 完成。

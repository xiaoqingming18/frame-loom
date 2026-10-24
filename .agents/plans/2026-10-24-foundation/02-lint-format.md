# Plan: ESLint 与 Prettier

Status: done
Parent: plan.md
Note: ../../notes/implemented/process/2026-10-24-lint-and-format.md

## 目标

在根目录建立 ESLint flat config 与 Prettier，修复现有代码的 lint 报错，完成一次只改格式的全仓格式化，并接入 Windows CI。规则、忽略范围和版本见笔记。

## 前置条件

- 01 完成，engine 位于 `apps/engine`。
- 没有其他未合并分支，避免全仓格式化造成冲突。

## 步骤

- [x] T1 以精确版本在根 `devDependencies` 安装笔记版本表中的包，审核安装脚本 — 验证：`unrs-resolver@1.12.2` 精确登记 `allowBuilds: false` 后，`pnpm install --frozen-lockfile` 通过
- [x] T2 编写 `eslint.config.js`：`recommendedTypeChecked` 加 `projectService`、renderer 的 React 与 TanStack Query 插件、`import-x/no-restricted-paths` 边界区、`eslint-config-prettier`、忽略列表 — 验证：`pnpm exec eslint --print-config apps/desktop/src/renderer/src/main.tsx` 包含边界规则
- [x] T3 根脚本加入 `lint`、`format`、`format:check`，编写 `.prettierrc.json` 与 `.prettierignore` — 验证：`pnpm format:check` 只报告格式差异，不报告 `.agents/`、`docs/`、生成文件
- [x] T4 修复现有代码的 lint 报错，不改变行为；无法修复的规则在配置中关闭并写明原因 — 验证：`pnpm lint`、`pnpm test`、`pnpm typecheck` 通过
- [x] T5 用临时文件验证导入边界 — 验证：ESLint API 使用相同配置验证 7 项反例和 1 项正例，全部符合预期；临时源码已删除
- [x] T6 在 `.github/workflows/build.yml` 的单测与类型检查之后加入 `pnpm lint` 与 `pnpm format:check` — 验证：配置已审阅，远端未执行
- [x] T7 提交 `build: 引入 ESLint 与 Prettier`，包含配置、脚本、CI 与 lint 修复，带 `Note:` 与 `Plan:` 尾注 — 验证：提交钩子与提交前 `pnpm run verify`
- [x] T8 运行 `pnpm format`，单独提交 `style: 全仓格式化` — 验证：`aee1d3a0012ac3172974a41d7a8265502e30c715` 的 28 份变更均为 Prettier 对原文的输出，不含 `.agents/` 或 `docs/`；`pnpm typecheck`、`pnpm test`、`pnpm format:check` 通过
- [x] T9 把 T8 提交的完整 SHA 写入 `.git-blame-ignore-revs`，README 说明 `git config blame.ignoreRevsFile .git-blame-ignore-revs`，作为 `chore` 提交 — 验证：`git -c blame.ignoreRevsFile=.git-blame-ignore-revs blame` 跳过格式化提交，提交钩子与 `pnpm run verify`

## 验证

- 预期：`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`、`pnpm run verify` 全部通过；边界反例报错；格式化提交只含格式改动。
- 实际：`pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（150 项）、`pnpm run verify` 通过。边界反例 7 项、正例 1 项通过并清理临时源码；配置打印包含 error 级别的导入边界与异步检查。Windows CI 在测试和类型检查后加入 lint 与格式检查，远端尚未运行。格式提交 `aee1d3a0012ac3172974a41d7a8265502e30c715` 逐文件核对为纯格式改动，blame 配置跳过该提交。
- 根目录测试与提交配置也被格式化，额外运行 `pnpm run test:plans`（37 项）和 `pnpm run test:commit-convention`（29 项），均通过，包含真实 Git 钩子正反例验证。

## 进度

- 2026-10-24：创建子计划草稿。
- 2026-10-24：01 已完成（`9a48d6f`），无其他本地未合并分支，开始执行 T1。
- 2026-10-24：完成 T1～T7；11 项依赖精确锁定、配置与 CI 就绪，边界正反例验证通过；配置提交后的下一步为 T8 纯格式化。
- 2026-10-24：配置提交 `ea56a3b`；纯格式提交 `aee1d3a0012ac3172974a41d7a8265502e30c715`，完成 T8～T9，登记 blame 忽略与 README 用法。笔记已移入 `implemented/`，父计划仍 active，03～07 未施工。

## 发现与偏差

- T1 原预计不新增 `allowBuilds`，实际解析器带 `unrs-resolver@1.12.2` 安装脚本；审阅并验证本机原生绑定无需脚本后精确登记 `false`，不开放脚本或兜底下载。
- 首轮 lint 的 10 处错误通过补齐 Nest HTTP server 泛型、将 Node 事件结果标为 `unknown[]`、移除冗余非空断言修复；唯一规则豁免是当前无导出的渲染挂载入口的 Fast Refresh 检查，原因写在配置中。
- T5 用 ESLint API 精确断言规则名与错误数，避免仅凭 CLI 非零退出误认边界有效；首次临时 main/preload/engine 导入多写一层相对路径，修正为真实可解析路径后通过。

## 交接

无。

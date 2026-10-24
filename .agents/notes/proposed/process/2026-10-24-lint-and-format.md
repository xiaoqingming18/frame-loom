# Agent Note: 引入 ESLint 与 Prettier

Status: proposed

## Problem

仓库目前只有 `tsc` 类型检查，没有 lint，也没有格式化工具。[engine 与 renderer 基础设施](../architecture/2026-10-24-engine-and-renderer-foundation.md)规定了几条导入边界：

- renderer 内部依赖方向为 `lib`、`components` → `features` → `routes`、`app`。
- feature 之间不能互相导入。
- renderer 不能导入 main、preload 或 engine，engine 不能导入 desktop。
- [Agent 内核选型](../architecture/2026-10-24-agent-runtime-pi.md)要求只有 engine 的 `modules/agent` 可以导入 `@earendil-works/*`，验收方式目前写的是手动 grep。

这些规则写在笔记里只能靠人工评审。engine 与主进程大量使用 Promise，遗漏 `await` 或 `void` 的调用，`tsc` 也查不出来。格式也没有约定，新增代码会混入多种风格。

## Proposal

### ESLint

- 根目录一份 `eslint.config.js`（flat config），由根脚本 `pnpm lint` 对全仓运行。
- 所有 TypeScript 使用 `typescript-eslint` 的 `recommendedTypeChecked`，开启 `parserOptions.projectService`。主要用 `no-floating-promises`、`no-misused-promises` 检查遗漏的异步调用。
- renderer 额外启用 `eslint-plugin-react-hooks`、`eslint-plugin-react-refresh` 和 `@tanstack/eslint-plugin-query`。
- 导入边界用 `eslint-plugin-import-x` 的 `no-restricted-paths`，按目录划区，覆盖 Problem 中前三条规则。引入 pi 时，再加一条 `no-restricted-imports`：在 `apps/engine/src/modules/agent/` 之外禁止 `@earendil-works/*`，替代手动 grep。
- 末尾接 `eslint-config-prettier`，关闭和格式化冲突的规则。
- 忽略：`dist/`、`out/`、`release/`、`apps/desktop/build/`、`routeTree.gen.ts`、`.agents/`、`.cache/`、`docs/design/`。
- Tailwind 类名的颜色限制（`eslint-plugin-better-tailwindcss`）和 Prettier 类名排序（`prettier-plugin-tailwindcss`）在 renderer 引入主题 token 时加入，规则见[主题系统与应用外壳](../feature/2026-10-24-theme-and-app-shell.md)。

### Prettier

- 根目录 `.prettierrc.json`：单引号、保留分号、`printWidth: 100`、`trailingComma: 'all'`。
- `.prettierignore` 在 `.gitignore` 的基础上，还要排除：

  | 排除项 | 原因 |
  | --- | --- |
  | `.agents/` | 已封印的归档笔记不能改；上游技能必须保留原文 |
  | `docs/` | 文档按项目写作规范人工维护 |
  | `pnpm-lock.yaml`、`routeTree.gen.ts`、`apps/engine/drizzle/meta/` | 工具生成 |

- 首次全仓格式化单独作为一个 `style` 提交，只改格式。完成后把它的完整 SHA 写入 `.git-blame-ignore-revs`，并在 README 注明 `git config blame.ignoreRevsFile .git-blame-ignore-revs`。

### 脚本与 CI

- 根脚本新增 `lint`（`eslint .`）、`format`（`prettier --write .`）、`format:check`（`prettier --check .`）。
- `.github/workflows/build.yml` 在单测与类型检查步骤之后执行 `pnpm lint` 和 `pnpm format:check`。
- `pnpm run verify` 继续只做笔记与计划校验，不加入 lint。不增加 pre-commit 钩子，Husky 只保留提交信息检查。

### 版本

2026-10-24 查询 npm registry 的最新版本，作为精确锁定的起点，实际以锁文件为准：

| 包 | 版本 | 兼容性 |
| --- | --- | --- |
| eslint | 10.13.0 | |
| @eslint/js | 10.0.1 | |
| typescript-eslint | 8.72.0 | peer 要求 TypeScript `>=4.8.4 <6.1.0`，兼容当前 6.0.3 |
| eslint-plugin-import-x | 4.17.1 | |
| eslint-import-resolver-typescript | 4.4.5 | |
| eslint-plugin-react-hooks | 7.1.1 | |
| eslint-plugin-react-refresh | 0.5.7 | |
| @tanstack/eslint-plugin-query | 5.104.5 | peer 允许 TypeScript 6 |
| eslint-config-prettier | 10.1.8 | |
| globals | 17.13.0 | |
| prettier | 3.9.10 | |

## Alternatives considered

- **Biome**：一个工具同时做 lint 和格式化，速度快，配置少。但它没有按目录划区的导入限制，也没有 TanStack Query 规则，而导入边界正是这次引入 lint 的主要目的。
- **oxlint 加 ESLint 双层**（Cherry Studio、tldraw 的做法）：oxlint 先跑大部分规则，ESLint 只跑剩下的插件，大仓库里明显更快。本仓库只有三个小包，ESLint 单独运行的耗时还不是问题，双层配置要多维护一份规则重叠表。lint 耗时成为负担时再加。
- **只用 ESLint 的格式化规则（stylistic）**：少一个工具。但格式化规则和逻辑规则混在一起，自动修复的范围也小于 Prettier；typescript-eslint 官方建议格式化交给专门的工具。
- **加 pre-commit 钩子（lint-staged）**：提交前就能发现问题。但带类型信息的 lint 每次都要加载 TypeScript 项目，提交会明显变慢；CI 已经能拦住问题，本地可以随时手动运行 `pnpm lint`。

## Acceptance criteria

- `pnpm lint` 和 `pnpm format:check` 在全仓通过，CI 的 Windows 工作流包含这两步。
- 边界规则有反例验证：在 renderer 的 feature 中临时导入另一个 feature、在 renderer 中导入 main，`pnpm lint` 报错；删除临时文件后通过。
- 格式化提交只包含格式改动，提交后 `pnpm typecheck`、`pnpm test` 通过；`.git-blame-ignore-revs` 记录了它的 SHA。
- `.agents/` 下没有文件被格式化改动，`pnpm run verify` 通过。

## Risks

- typescript-eslint 8.72 的 peer 上限是 TypeScript 6.1 以下；升级 TypeScript 要等 typescript-eslint 跟进，或在同一提交里升级两者。
- 类型感知 lint 会随代码量变慢。超过可接受时间时，先考虑缩小 `recommendedTypeChecked` 的范围，再考虑 oxlint。
- 首次格式化会改动大量行，和进行中的分支冲突。在没有其他未合并分支时执行，并单独提交。
- Prettier 对 Markdown 的改写可能和项目写作规范冲突，所以 `docs/` 和 `.agents/` 不纳入格式化；README 等根目录 Markdown 是否纳入，以首次运行的 diff 为准。

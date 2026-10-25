# Agent Note: 引入 ESLint 与 Prettier

Status: implemented

## Problem

引入前仓库只有 `tsc` 类型检查，没有 lint，也没有格式化工具。[engine 与 renderer 基础设施](../architecture/2026-10-24-engine-and-renderer-foundation.md)规定了几条导入边界：

- renderer 内部依赖方向为 `lib`、`components` → `features` → `routes`、`app`。
- feature 之间不能互相导入。
- renderer 不能导入 main、preload 或 engine，engine 不能导入 desktop。
- [Agent 内核选型](../../proposed/architecture/2026-10-24-agent-runtime-pi.md)要求只有 engine 的 `modules/agent` 可以导入 `@earendil-works/*`，验收方式目前写的是手动 grep。

这些规则写在笔记里只能靠人工评审。engine 与主进程大量使用 Promise，遗漏 `await` 或 `void` 的调用，`tsc` 也查不出来。格式也没有约定，新增代码会混入多种风格。

## Decision

### ESLint

- 根目录一份 `eslint.config.js`（flat config），由根脚本 `pnpm lint` 对全仓运行。
- 所有 TypeScript 使用 `typescript-eslint` 的 `recommendedTypeChecked`，开启 `parserOptions.projectService`。主要用 `no-floating-promises`、`no-misused-promises` 检查遗漏的异步调用。
- renderer 额外启用 `eslint-plugin-react-hooks`、`eslint-plugin-react-refresh` 和 `@tanstack/eslint-plugin-query`。
- 仅在 `routes/**/*.tsx` 关闭 `react-refresh/only-export-components`：文件路由导出配置对象并由 Router 插件处理热更新。入口不再关闭此规则，普通 feature 组件仍受检查。
- 导入边界用 `eslint-plugin-import-x` 的 `no-restricted-paths`，按目录划区，覆盖 Problem 中前三条规则。引入 pi 时，再加一条 `no-restricted-imports`：在 `apps/engine/src/modules/agent/` 之外禁止 `@earendil-works/*`，替代手动 grep。
- feature 隔离根据现有 `features/` 子目录自动生成，允许同 feature 导入；未创建目录时不预建业务空壳。TypeScript resolver 读取 desktop 的 node、web 两份 tsconfig，加上 engine、contracts 共四份配置，支持 renderer 的 `@/` 别名与 `.js` 源码映射；类型感知解析继续由 projectService 根据根 references 发现项目。
- 末尾接 `eslint-config-prettier`，关闭和格式化冲突的规则。
- `eslint-import-resolver-typescript` 的传递依赖 `unrs-resolver@1.12.2` 带 `napi-postinstall` 准备脚本。已读取脚本并验证 Windows x64 的可选原生绑定无需脚本即可加载，`allowBuilds` 精确登记 `false`，保留默认构建审核，不开放安装时兜底下载。
- 忽略：`dist/`、`out/`、`release/`、`apps/desktop/build/`、`routeTree.gen.ts`、`.agents/`、`.cache/`、`docs/design/`。
- renderer 启用 `eslint-plugin-better-tailwindcss@4.10.0` 的四条 correctness 规则与 `no-restricted-classes`，禁止调色板和任意值颜色；`no-restricted-syntax` 拒绝直接 JSX 内联颜色。插件在根目录安装，以 desktop 为解析 `cwd`，读取 `styles/globals.css` 和 web tsconfig，并检测标题栏与画布等自定义 CSS 类，避免误报或因缺少 Tailwind 静默停用。规则范围见[主题系统与应用外壳](../feature/2026-10-24-theme-and-app-shell.md)。
- shadcn 的 Button、Toggle、Tabs 命名变体需要供其他组件复用，只在 `packages/ui/src/components/` 的三份源码中放行对应导出，其余组件仍检查 Fast Refresh。
- React、Fast Refresh、Tailwind correctness 与颜色限制规则同时覆盖 `packages/ui/src`；`no-restricted-paths` 另禁止 `packages/*` 导入 `apps/*`。新增含界面的工作区包时，把源码目录加入该规则块与 resolver 的 tsconfig 列表。

### Prettier

- 根目录 `.prettierrc.json`：单引号、保留分号、`printWidth: 100`、`trailingComma: 'all'`。
- 根目录安装 `prettier-plugin-tailwindcss@0.8.1`，`tailwindStylesheet` 指向 desktop 的 `styles/globals.css`，类名排序同时覆盖 `cn` 与 `cva`；ESLint 不启用类名排序与换行规则。
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

## Consequences

- 收益：跨进程和 renderer 分层边界由同一配置检查；异步调用通过类型感知规则检查，格式交给 Prettier，CI 复用本地命令。
- 代价：新增 11 项直接开发依赖和一项精确的脚本拒绝登记；首次格式化独立提交，需要用 blame 忽略文件保持历史可读。
- typescript-eslint 8.72 的 peer 上限是 TypeScript 6.1 以下；升级 TypeScript 要等 typescript-eslint 跟进，或在同一提交里升级两者。
- 类型感知 lint 会随代码量变慢。超过可接受时间时，先考虑缩小 `recommendedTypeChecked` 的范围，再考虑 oxlint。
- 首次格式化会改动大量行，和进行中的分支冲突。在没有其他未合并分支时执行，并单独提交。
- Prettier 对 Markdown 的改写可能和项目写作规范冲突，所以 `docs/` 和 `.agents/` 不纳入格式化；README 等根目录 Markdown 是否纳入，以首次运行的 diff 为准。
- 初次纯格式化提交为 `aee1d3a0012ac3172974a41d7a8265502e30c715`，与配置、blame SHA 登记分别提交；CI 配置已审阅，远端尚未执行。

## Verification

- 完整外壳接入后旧健康页 `styles.css` 与遗留组件已删除；标题栏和点阵 CSS 只引用语义 token，全仓 lint、格式检查通过。新增 `home`、`theme` feature 自动受现有导入边界约束，不放宽配置；本篇在 02 已转入 implemented，07 原地同步当前事实。
- 主题接入后，颜色和未知类名的 8 项反例、内联样式的 2 项反例被预期规则拒绝；语义 token 与尺寸任意值通过。真实临时 `.tsx` 中的 `bg-zinc-800`、`text-[#333]`、未知类使 `pnpm lint` 报三条对应错误，删除后 lint 与 `format:check` 全仓通过。插件没有因根目录找不到 Tailwind 而停用；新增两项插件均精确锁定。
- renderer 骨架接入后，desktop resolver 使用拆分的 node／web 配置，`pnpm lint` 通过；临时在 `lib/` 用 `@/` 重导出 feature 的反例仍触发 `import-x/no-restricted-paths`，随后删除探针。
- 冻结安装通过，11 项依赖按版本表精确锁定；`unrs-resolver@1.12.2` 禁止安装脚本后，TypeScript resolver 仍能加载本机绑定。
- `pnpm lint`、`pnpm typecheck` 和 `pnpm test` 通过，现有 150 项单测全部保留；lint 修复只涉及类型标注及冗余非空断言，没有运行时行为变化。
- `eslint --print-config` 断言 renderer 的导入边界和 `no-floating-promises` 均为 error。临时源码配合 ESLint API 验证 7 项反例：跨 feature、renderer 导入 main/preload/engine、engine 导入 desktop、feature 导入 app、lib 导入 feature；同 feature 和 contracts 导入正例通过。反例均只报预期的边界错误，随后删除临时源码。
- `pnpm format` 改动 28 份源码、配置和测试，逐文件断言均等于 Prettier 对提交前原文的输出；未改动 `.agents/`、`docs/`、锁文件或迁移元数据。格式化后 `format:check`、lint、类型检查和 150 项单测全部通过。
- `.git-blame-ignore-revs` 登记格式提交的完整 SHA，README 提供本地配置命令；使用临时 `git -c` 配置检查 blame，不改变用户现有 Git 配置。
- 格式化涉及的根目录计划测试 37 项、提交规范与真实 Git 钩子测试 29 项均通过；CI 配置只完成本地审阅，不视为远端运行结果。

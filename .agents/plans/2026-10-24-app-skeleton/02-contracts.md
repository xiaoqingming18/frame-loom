# Plan: workspace 与 contracts 包

Status: done
Parent: plan.md
Note: ../../notes/implemented/architecture/2026-10-24-shared-contracts.md

## 目标

建立 `packages/contracts`，包名为 `@frame-loom/contracts`。它是 ESM 包，用 tsc 编译出 JS 和 `.d.ts`，导出两样东西：

- engine 的健康检查响应 schema `HealthResponse`；
- 主进程交给 renderer 的连接信息 schema `EngineConnection`，内容是 `{ baseUrl, token }`。

engine 和 desktop 都只从这个包读取共享类型。同时建立仓库共用的 TypeScript 6 配置和 Vitest 测试入口。

## 前置条件

- 01 完成：pnpm workspace 可用，Node 为 24.22。

## 步骤

- [x] T1 在根目录新增 `tsconfig.base.json`，配置 `strict`、`target: ES2023`、`module` 和 `moduleResolution` 都为 `nodenext`、`skipLibCheck`。根目录 devDependencies 加上 `typescript`（精确的 6.x 版本）和 `vitest`（与 Nest ESM 模板同一主版本）。根目录 `.gitignore` 已经忽略 `dist/`，不用改 — 验证：`pnpm exec tsc -v` 输出 6.x
- [x] T2 新增 `packages/contracts/package.json`，内容包括：`"type": "module"`；`exports` 的 `.` 条目写 `types` 和 `default` 两个条件，分别指向 `dist/index.d.ts` 和 `dist/index.js`；`files: ["dist"]`；脚本 `build: tsc -p tsconfig.build.json`、`test: vitest run`。依赖 `zod`，写精确版本 — 验证：`pnpm --filter @frame-loom/contracts build` 生成 `dist/index.js` 和 `dist/index.d.ts`
- [x] T3 写 `src/health.ts`，内容：`HealthResponse = { status: 'ok', engineVersion: string, schemaVersion: string, startedAt: string }`，其中 `startedAt` 是 ISO 时间。写 `src/engine-connection.ts`，内容：`EngineConnection = { baseUrl: string, token: string }`，`baseUrl` 必须是 `http://127.0.0.1:<port>`。两个文件都从 `src/index.ts` 导出 — 验证：`pnpm --filter @frame-loom/contracts build` 成功
- [x] T4 写 `src/*.test.ts`。覆盖三类情况：合法输入通过；缺字段、`status` 值不对的输入被拒绝；`baseUrl` 不是 `127.0.0.1` 的输入被拒绝 — 验证：`pnpm --filter @frame-loom/contracts test` 通过
- [x] T5 在根目录 `package.json` 加三个脚本：`build: pnpm -r build`、`test: pnpm -r test`、`typecheck: pnpm -r typecheck` — 验证：在根目录运行 `pnpm test`，contracts 的测试会被执行
- [x] T6 提交 `feat(contracts): 新增共享契约包`，带 `Note:` 和 `Plan:` 尾注 — 验证：`pnpm run verify` 通过，`commit-msg` 钩子通过

## 验证

- 预期：`pnpm -r build`、`pnpm -r test` 通过；`HealthResponse` 和 `EngineConnection` 能从包入口导入。
- 实际：Node 24.22.1、pnpm 12.15.0 下，TypeScript 为 6.0.3，Vitest 为 4.1.12，zod 为 4.6.7；`pnpm install --frozen-lockfile` 成功，无需新增构建许可。
- `pnpm build`、`pnpm typecheck`、`pnpm test` 全部通过；2 个 contracts 测试文件共 43 项通过，包含 ISO 时间、必填字段、字段类型、地址与端口边界。
- `dist/` 只生成 3 个 JS 与 3 个声明文件，不含测试。通过临时下游 `.mts` 文件从包名 `@frame-loom/contracts` 同时导入 schema 与同名类型，独立 tsc 类型检查与 Node 执行均通过；临时文件已删除。
- `pnpm run verify` 通过，8 篇笔记与 6 份计划合规；`pnpm run test:plans` 的 37 项、`pnpm run test:commit-convention` 的 29 项通过，含真实 Git 钩子验证。`git diff --check` 通过。

## 进度

- 2026-10-24：创建子计划草稿。
- 2026-10-24：用户授权执行子计划 02；确认 01 已完成，工作区干净，开始建立共享契约与构建、测试入口。
- 2026-10-24：完成 T1–T5、43 项契约测试和 66 项既有测试；共享契约笔记移入 `implemented/`，父计划表与项目现状同步，与 T6 的 contracts 提交同批落盘。

## 发现与偏差

- 整体桌面架构要到 05 才能转为 `implemented`；本次为 contracts 的具体契约边界建立独立笔记，与整体架构互链，避免把 engine 和桌面壳写成已实现。
- 增加 contracts 的 `typecheck` 脚本与构建专用 tsconfig，使测试参与类型检查但不进入生产输出；同步 README 与 AGENTS 的当前仓库状态。

## 交接

无。

# Plan: workspace 与 contracts 包

Status: draft
Parent: plan.md

## 目标

建立 `packages/contracts`，包名为 `@frame-loom/contracts`。它是 ESM 包，用 tsc 编译出 JS 和 `.d.ts`，导出两样东西：

- engine 的健康检查响应 schema `HealthResponse`；
- 主进程交给 renderer 的连接信息 schema `EngineConnection`，内容是 `{ baseUrl, token }`。

engine 和 desktop 都只从这个包读取共享类型。同时建立仓库共用的 TypeScript 6 配置和 Vitest 测试入口。

## 前置条件

- 01 完成：pnpm workspace 可用，Node 为 24.22。

## 步骤

- [ ] T1 在根目录新增 `tsconfig.base.json`，配置 `strict`、`target: ES2023`、`module` 和 `moduleResolution` 都为 `nodenext`、`skipLibCheck`。根目录 devDependencies 加上 `typescript`（精确的 6.x 版本）和 `vitest`（与 Nest ESM 模板同一主版本）。根目录 `.gitignore` 已经忽略 `dist/`，不用改 — 验证：`pnpm exec tsc -v` 输出 6.x
- [ ] T2 新增 `packages/contracts/package.json`，内容包括：`"type": "module"`；`exports` 的 `.` 条目写 `types` 和 `default` 两个条件，分别指向 `dist/index.d.ts` 和 `dist/index.js`；`files: ["dist"]`；脚本 `build: tsc -p tsconfig.build.json`、`test: vitest run`。依赖 `zod`，写精确版本 — 验证：`pnpm --filter @frame-loom/contracts build` 生成 `dist/index.js` 和 `dist/index.d.ts`
- [ ] T3 写 `src/health.ts`，内容：`HealthResponse = { status: 'ok', engineVersion: string, schemaVersion: string, startedAt: string }`，其中 `startedAt` 是 ISO 时间。写 `src/engine-connection.ts`，内容：`EngineConnection = { baseUrl: string, token: string }`，`baseUrl` 必须是 `http://127.0.0.1:<port>`。两个文件都从 `src/index.ts` 导出 — 验证：`pnpm --filter @frame-loom/contracts build` 成功
- [ ] T4 写 `src/*.test.ts`。覆盖三类情况：合法输入通过；缺字段、`status` 值不对的输入被拒绝；`baseUrl` 不是 `127.0.0.1` 的输入被拒绝 — 验证：`pnpm --filter @frame-loom/contracts test` 通过
- [ ] T5 在根目录 `package.json` 加三个脚本：`build: pnpm -r build`、`test: pnpm -r test`、`typecheck: pnpm -r typecheck` — 验证：在根目录运行 `pnpm test`，contracts 的测试会被执行
- [ ] T6 提交 `feat(contracts): 新增共享契约包`，带 `Note:` 和 `Plan:` 尾注 — 验证：`pnpm run verify` 通过，`commit-msg` 钩子通过

## 验证

- 预期：`pnpm -r build`、`pnpm -r test` 通过；`HealthResponse` 和 `EngineConnection` 能从包入口导入。
- 实际：未执行。

## 进度

- 2026-10-24：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始，要等 01 完成。

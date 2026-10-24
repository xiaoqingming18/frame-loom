# Plan: engine 目录调整

Status: draft
Parent: plan.md
Note: ../../notes/proposed/architecture/2026-10-24-engine-and-renderer-foundation.md

## 目标

把 `apps/engine/src` 的平铺文件调整为笔记中的 `core/` 加 `modules/health` 结构，新增 `package-root.ts` 统一定位包根，drizzle-kit 改用 `./src/**/*.schema.ts` 汇总表定义。行为、HTTP 协议、迁移内容不变。

## 前置条件

- 02 完成，`pnpm lint` 可用。

## 步骤

- [ ] T1 新增 `src/package-root.ts`，`DatabaseService` 的迁移目录和 `HealthService` 的 `package.json` 读取改为基于它拼接 — 验证：`pnpm --filter @frame-loom/engine test` 通过
- [ ] T2 用 `git mv` 把 config、guard、database、schema 移到 `src/core/` 的对应子目录，`schema.ts` 改名为 `core/database/app-meta.schema.ts`；新增 `core/core.module.ts`（`@Global`）提供 `EngineConfig`、`DatabaseService`、`EngineGuard` 与 `APP_GUARD` — 验证：`pnpm --filter @frame-loom/engine typecheck` 通过
- [ ] T3 把 health 的 controller、service 移到 `src/modules/health/`，新增 `health.module.ts`；`AppModule` 只导入 `CoreModule` 与 `HealthModule`，`AppModule.register(config)` 签名不变 — 验证：注入测试与 HTTP 测试通过
- [ ] T4 测试文件跟随源码移动并修正相对导入 — 验证：engine 测试数量与迁移前一致且全部通过
- [ ] T5 `drizzle.config.ts` 的 `schema` 改为 `./src/**/*.schema.ts` — 验证：`pnpm --filter @frame-loom/engine db:generate` 报告没有 schema 变化，`drizzle/` 无改动
- [ ] T6 运行 `pnpm deploy:engine` 到仓库外临时目录，用 `FRAME_LOOM_TEST_ENGINE_ENTRY` 指向部署入口运行 `src/main.test.ts` — 验证：部署入口黑盒测试通过，迁移目录与版本读取正确
- [ ] T7 运行 `pnpm --filter @frame-loom/desktop package:dir`、`test:e2e`，并启动加固 exe — 验证：健康页显示 engine 版本与 schema 1，关闭后无残留进程
- [ ] T8 按调整后的路径同步 `apps/engine/README.md` 与 engine 服务笔记中的文件事实，提交 `refactor(engine): 按 core 与 modules 组织目录`，带 `Note:` 与 `Plan:` 尾注 — 验证：`pnpm lint`、`pnpm run verify` 通过

## 验证

- 预期：engine 测试数量不变且全部通过；`db:generate` 无变化；部署入口黑盒测试通过；e2e 与加固 exe 启动通过。
- 实际：未执行。

## 进度

- 2026-10-24：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始，等待 02 完成。

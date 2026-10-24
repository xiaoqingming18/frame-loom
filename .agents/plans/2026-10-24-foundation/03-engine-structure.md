# Plan: engine 目录调整

Status: done
Parent: plan.md
Note: ../../notes/proposed/architecture/2026-10-24-engine-and-renderer-foundation.md

## 目标

把 `apps/engine/src` 的平铺文件调整为笔记中的 `core/` 加 `modules/health` 结构，新增 `package-root.ts` 统一定位包根，drizzle-kit 改用 `./src/**/*.schema.ts` 汇总表定义。行为、HTTP 协议、迁移内容不变。

## 前置条件

- 02 完成，`pnpm lint` 可用。

## 步骤

- [x] T1 新增 `src/package-root.ts`，`DatabaseService` 的迁移目录和 `HealthService` 的 `package.json` 读取改为基于它拼接 — 验证：`pnpm --filter @frame-loom/engine test` 通过
- [x] T2 用 `git mv` 把 config、guard、database、schema 移到 `src/core/` 的对应子目录，`schema.ts` 改名为 `core/database/app-meta.schema.ts`；新增 `core/core.module.ts`（`@Global`）提供 `EngineConfig`、`DatabaseService`、`EngineGuard` 与 `APP_GUARD` — 验证：`pnpm --filter @frame-loom/engine typecheck` 通过
- [x] T3 把 health 的 controller、service 移到 `src/modules/health/`，新增 `health.module.ts`；`AppModule` 只导入 `CoreModule` 与 `HealthModule`，`AppModule.register(config)` 签名不变 — 验证：注入测试与 HTTP 测试通过
- [x] T4 测试文件跟随源码移动并修正相对导入 — 验证：engine 测试数量与迁移前一致且全部通过
- [x] T5 `drizzle.config.ts` 的 `schema` 改为 `./src/**/*.schema.ts` — 验证：`pnpm --filter @frame-loom/engine db:generate` 报告没有 schema 变化，`drizzle/` 无改动
- [x] T6 运行 `pnpm deploy:engine` 到仓库外临时目录，用 `FRAME_LOOM_TEST_ENGINE_ENTRY` 指向部署入口运行 `src/main.test.ts` — 验证：部署入口黑盒测试通过，迁移目录与版本读取正确
- [x] T7 运行 `pnpm --filter @frame-loom/desktop package:dir`、`test:e2e`，并启动加固 exe — 验证：健康页显示 engine 版本与 schema 1，关闭后无残留进程
- [x] T8 按调整后的路径同步 `apps/engine/README.md` 与 engine 服务笔记中的文件事实，提交 `refactor(engine): 按 core 与 modules 组织目录`，带 `Note:` 与 `Plan:` 尾注 — 验证：`pnpm lint`、`pnpm run verify` 通过

## 验证

- 预期：engine 测试数量不变且全部通过；`db:generate` 无变化；部署入口黑盒测试通过；e2e 与加固 exe 启动通过。
- 实际：engine 6 个文件、70 项测试全部通过，类型检查、lint 和格式检查通过。`db:generate` 报告无 schema 变化，`drizzle/` 无改动。`pnpm deploy:engine C:/Users/xiaoq/AppData/Local/Temp/frame-loom-foundation-03-1792826634747` 后设置 `FRAME_LOOM_TEST_ENGINE_ENTRY`，运行 `pnpm --filter @frame-loom/engine exec vitest run src/main.test.ts`，10 项黑盒测试通过。`package:dir` 与 `test:e2e`（1 项）通过；真实加固 exe 通过 `.cache/verify-foundation-ui.mjs 03` 检查，显示“运行正常”、engine 0.1.0、schema 1，退出码 0，4 个子进程全部退出；截图 `.cache/03-foundation-packaged.png` 已检查。提交前 `pnpm run verify` 通过。

## 进度

- 2026-10-24：创建子计划草稿。
- 2026-10-24：用户授权执行 03、04；已核对现有入口、模块、测试、部署与桌面调用，开始目录调整。
- 2026-10-24：T1～T8 完成，源码、测试与部署／桌面验证通过，文档与已有笔记同步；按计划独立提交。

## 发现与偏差

- 共享基础设施笔记还包含 04、05 的未完成工作，继续保留 proposed；本次原地同步已实现的 engine 服务笔记及提案中的落地边界。

## 交接

无。

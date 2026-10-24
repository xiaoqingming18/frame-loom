# Plan: engine 迁到 apps/engine

Status: done
Parent: plan.md

## 目标

把 `services/engine` 移到 `apps/engine`，不改变任何行为。包名 `@frame-loom/engine`、utilityProcess 的 `serviceName` `Frame Loom Engine`、打包后的 `resources/engine` 路径保持不变。完成后仓库中不存在 `services/` 目录。

## 前置条件

- 工作区干净，`pnpm install --frozen-lockfile` 可用。
- 没有正在运行的 `pnpm dev` 或 Frame Loom 进程，避免 `services/engine` 下的文件被占用。

## 步骤

- [x] T1 执行 `git mv services/engine apps/engine` — 验证：`git status` 显示重命名，`apps/engine/src/main.ts` 存在
- [x] T2 修改 `apps/desktop/src/main/engine.ts` 的开发入口为 `resolve(appPath, '../engine/dist/main.js')`，同步 `apps/desktop/src/main/engine.test.ts` 的断言 — 验证：desktop 37 项单测通过
- [x] T3 从 `pnpm-workspace.yaml` 删除 `services/*` — 验证：`pnpm -r list --depth -1` 仍列出三个子包
- [x] T4 核对迁移后残留并删除空的 `services/` — 验证：旧目录为空，`services/` 不存在；提交前状态仅含旧路径的已暂存删除记录
- [x] T5 执行 `pnpm install` 并提交更新后的 `pnpm-lock.yaml` — 验证：锁文件 importer 键为 `apps/engine`；随后 `pnpm install --frozen-lockfile` 通过
- [x] T6 同步 `README.md`、`AGENTS.md`、`apps/engine/README.md` 中的路径和命令 — 验证：使用说明没有旧路径，README 补充重新安装的迁移方法
- [x] T7 原地同步活跃笔记中的路径事实：`implemented/architecture/2026-10-24-desktop-stack-and-process-model.md`、`implemented/architecture/2026-10-24-engine-service.md`、`implemented/process/2026-10-24-pnpm-node24-toolchain.md`、`proposed/architecture/2026-10-24-agent-runtime-pi.md` — 验证：旧路径只保留在迁移背景、备选和执行记录中，`pnpm run verify` 通过
- [x] T8 运行 `pnpm typecheck`、`pnpm test`，再运行 `pnpm dev` 检查健康页 — 验证：全部通过，窗口显示“运行正常”与 engine 版本 0.1.0
- [x] T9 运行 `pnpm --filter @frame-loom/desktop package:dir` 和 `pnpm --filter @frame-loom/desktop test:e2e`，启动 `apps/desktop/release/win-unpacked` 中的加固 exe — 验证：e2e 通过，加固 exe 显示健康状态，关闭后无残留进程
- [x] T10 提交 `refactor(engine)!: 迁移到 apps/engine`，正文写 `BREAKING CHANGE:` 说明开发路径变化及重新执行 `pnpm install` 的迁移方法，带 `Note:` 与 `Plan:` 尾注 — 验证：提交钩子与提交前 `pnpm run verify`

## 验证

- 预期：`services/` 不存在；冻结安装、类型检查、全部单测、`pnpm dev`、`package:dir`、e2e 冒烟与加固 exe 启动都通过；文档与活跃笔记中没有旧路径。
- 实际：`pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test` 通过（contracts 43、desktop 37、engine 70 项）；`package:dir` 和 `test:e2e` 通过（1 项）。`pnpm dev --remoteDebuggingPort 19331` 和真实加固 exe 通过 renderer CDP 断言“运行正常”、engine 0.1.0，并检查截图 `.cache/01-migration-dev.png`、`.cache/01-migration-packaged.png`；窗口关闭后无仓库内 Electron 或加固 exe 残留。生产 fuse 配置未改。`services/` 不存在。

## 进度

- 2026-10-24：创建子计划草稿。
- 2026-10-24：用户授权执行 01、02；工作区干净，无运行中的桌面进程，Node 24.22.1、pnpm 12.15.0，冻结安装通过，开始迁移。
- 2026-10-24：完成 T1～T10；路径、锁文件与活跃笔记同步，单测和真实开发／加固窗口验证通过，按本计划独立提交。

## 发现与偏差

- 本机 `git mv` 连同未跟踪的 `node_modules`、`dist` 一起移动，旧 `services/` 为空；核对绝对路径后仅删除空目录。
- 重新安装使 pnpm 重新解析 `supports-color` 可选 peer；用断言比对锁文件 `packages` 段，包版本及完整性记录完全不变。
- 首次测试与开发构建并行，重建 `dist` 造成黑盒测试读取不到产物；停止并行构建后串行重跑，150 项全部通过。后续验证不能与构建共享写入目录并行执行。
- 桌面插件 `@oai/sky` 不可用，使用已有 Playwright 通过 renderer CDP 检查真实窗口；初次临时脚本默认 5 秒等待不足，改为与应用握手一致的 30 秒后通过。
- 原检索条件会命中本计划及基础设施提案中的历史背景、备选方案，故改为逐项核对，不改写历史理由。

## 交接

无。

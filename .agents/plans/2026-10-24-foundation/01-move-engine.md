# Plan: engine 迁到 apps/engine

Status: draft
Parent: plan.md

## 目标

把 `services/engine` 移到 `apps/engine`，不改变任何行为。包名 `@frame-loom/engine`、utilityProcess 的 `serviceName` `Frame Loom Engine`、打包后的 `resources/engine` 路径保持不变。完成后仓库中不存在 `services/` 目录。

## 前置条件

- 工作区干净，`pnpm install --frozen-lockfile` 可用。
- 没有正在运行的 `pnpm dev` 或 Frame Loom 进程，避免 `services/engine` 下的文件被占用。

## 步骤

- [ ] T1 执行 `git mv services/engine apps/engine` — 验证：`git status` 显示重命名，`apps/engine/src/main.ts` 存在
- [ ] T2 修改 `apps/desktop/src/main/engine.ts` 的开发入口为 `resolve(appPath, '../engine/dist/main.js')`，同步 `apps/desktop/src/main/engine.test.ts` 的断言 — 验证：`pnpm --filter @frame-loom/desktop test` 通过
- [ ] T3 从 `pnpm-workspace.yaml` 删除 `services/*` — 验证：`pnpm -r list --depth -1` 仍列出三个包
- [ ] T4 确认 `services/engine` 下只剩未跟踪的 `node_modules`、`dist` 等残留后删除，再删除空的 `services/` — 验证：`git status --ignored services` 无输出，`services/` 不存在
- [ ] T5 执行 `pnpm install` 并提交更新后的 `pnpm-lock.yaml` — 验证：锁文件 importer 键为 `apps/engine`；随后 `pnpm install --frozen-lockfile` 通过
- [ ] T6 同步 `README.md`、`AGENTS.md`、`apps/engine/README.md` 中的路径和命令 — 验证：`rg --hidden "services/engine|services/\*" --glob '!.agents/plans/2026-10-24-app-skeleton/**' --glob '!.agents/notes/archived/**' --glob '!pnpm-lock.yaml'` 只剩 T7 要改的笔记
- [ ] T7 原地同步活跃笔记中的路径事实：`implemented/architecture/2026-10-24-desktop-stack-and-process-model.md`、`implemented/architecture/2026-10-24-engine-service.md`、`implemented/process/2026-10-24-pnpm-node24-toolchain.md`、`proposed/architecture/2026-10-24-agent-runtime-pi.md` — 验证：T6 的检索无输出，`pnpm run verify` 通过
- [ ] T8 运行 `pnpm typecheck`、`pnpm test`，再运行 `pnpm dev` 检查健康页 — 验证：全部通过，窗口显示“运行正常”与 engine 版本
- [ ] T9 运行 `pnpm --filter @frame-loom/desktop package:dir` 和 `pnpm --filter @frame-loom/desktop test:e2e`，启动 `apps/desktop/release/win-unpacked` 中的加固 exe — 验证：e2e 通过，加固 exe 显示健康状态，关闭后无残留进程
- [ ] T10 提交 `refactor(engine)!: 迁移到 apps/engine`，正文写 `BREAKING CHANGE:` 说明开发路径变化及重新执行 `pnpm install` 的迁移方法，带 `Note:` 与 `Plan:` 尾注 — 验证：提交钩子通过，`pnpm run verify` 通过

## 验证

- 预期：`services/` 不存在；冻结安装、类型检查、全部单测、`pnpm dev`、`package:dir`、e2e 冒烟与加固 exe 启动都通过；文档与活跃笔记中没有旧路径。
- 实际：未执行。

## 进度

- 2026-10-24：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始，下一步从 T1 开始。

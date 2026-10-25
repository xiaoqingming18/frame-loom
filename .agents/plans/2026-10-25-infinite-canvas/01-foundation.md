# Plan: 预备：退出事件、应用菜单、UI 包

Status: done
Parent: plan.md

## 目标

- engine 退出时主进程不再重载页面，改为向可信窗口发送 `engine:exited { code }`，renderer 订阅后刷新健康状态。
- 移除默认应用菜单，生产包不响应 Ctrl+R、开发者工具和页面缩放快捷键；锁定页面级缩放。
- `apps/desktop/src/renderer/src/components/ui` 与 `cn` 迁入 `packages/ui`（`@frame-loom/ui`），行为与样式不变。

## 前置条件

- 无。

## 步骤

- [x] T1 主进程 engine 退出回调改为发送 `engine:exited`；preload 暴露 `onEngineExited`，`lib/desktop-bridge.ts` 用 zod 校验载荷；外壳订阅后使健康查询失效 — 验证：desktop 单测覆盖可信发送、剥离原始事件与取消订阅；e2e 终止 engine 后页面不重载且显示错误圆点
- [x] T2 用 `Menu.setApplicationMenu(null)` 移除默认菜单，开发模式保留开发者工具快捷键；`setVisualZoomLevelLimits(1, 1)` 并拦截 Ctrl+±／Ctrl+0 页面缩放 — 验证：Playwright 探针中 Ctrl+R、F5、Ctrl+=、Ctrl+-、Ctrl+滚轮后页面未重载、缩放系数为 1、应用菜单为 null
- [x] T3 新建 `packages/ui`：迁移 `components/ui/*`、`cn`、`components.json`；desktop 改导入；ESLint、Tailwind `@source`、Fast Refresh 例外随迁移调整 — 验证：`pnpm lint`、`pnpm typecheck`、`pnpm test` 通过，构建后 CSS 含仅出现在包内的类名
- [x] T4 原地同步桌面壳、应用骨架、基础设施、主题与外壳、lint 与格式化笔记中的退出行为、preload 方法、目录与默认菜单事实 — 验证：`pnpm run verify` 通过

## 验证

- 预期：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`、`pnpm run verify` 通过；桌面 e2e 通过。
- 实际：`pnpm lint`、`pnpm typecheck` 退出码 0；desktop 单测 131 项通过（新增 preload 退出订阅、桥接退出码校验、外壳收到退出事件后健康查询失效并显示错误圆点）。临时探针确认 `packages/ui` 受导入边界与颜色规则约束，随后删除。构建后 CSS 含 `has-[>svg]:px-2.5`、`fade-in-0`、`backdrop-blur-sm` 等只在包内出现的类名。清除 `ELECTRON_RUN_AS_NODE` 后 `e2e/smoke.test.ts` 4 项通过，引擎故障用例断言运行时标记在 engine 退出后仍存在（页面未重载）。临时 Playwright 探针：Ctrl+R、F5、Ctrl+=、Ctrl+Shift+=、Ctrl+-、Ctrl+滚轮后标记仍在、`getZoomFactor()` 为 1、`Menu.getApplicationMenu()` 为 null，探针已删除。加固 exe 未重新打包验证。

## 进度

- 2026-10-25：创建子计划。
- 2026-10-25：完成 T1–T4；全仓门禁见验证。

## 发现与偏差

- 宿主终端设置了 `ELECTRON_RUN_AS_NODE=1`，导致 Electron 按 Node 运行、e2e 报 "Process failed to launch"；清除变量后通过。已写入桌面壳笔记与 desktop README。
- `apps/desktop/tsconfig.json` 的 `@/*` 映射原本供 shadcn CLI 使用；CLI 配置随组件迁到 `packages/ui/components.json` 后，该映射仍供 renderer 的 `@/` 别名解析，保留不动。

## 交接

无。

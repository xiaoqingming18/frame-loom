# Plan: renderer 骨架

Status: draft
Parent: plan.md
Note: ../../notes/proposed/architecture/2026-10-24-engine-and-renderer-foundation.md

## 目标

- desktop 的 tsconfig 拆为 node 与 web 两份，renderer 使用 `@/` 别名。
- renderer 使用 `@tanstack/router-plugin` 文件路由和 `createHashHistory()`，engine client 与 QueryClient 通过路由 context 注入。
- 健康检查迁入 `features/engine-status`，通过 `lib/engine-client.ts` 请求 engine。本段只迁移逻辑，界面暂时沿用现有健康页，外壳与设置中心在 07 中实现。
- Vitest 分 node 与 jsdom 两个 project，renderer 组件测试使用替身 engine client。

## 前置条件

- 02 完成，lint 边界规则已覆盖 renderer 目录。
- T5 及之后依赖 04 完成，contracts 已导出 `ErrorResponse`。

## 步骤

- [ ] T1 把 `apps/desktop/tsconfig.json` 拆为 `tsconfig.node.json` 与 `tsconfig.web.json`，根文件只做 references；`typecheck` 脚本分别检查两份 — 验证：`pnpm --filter @frame-loom/desktop typecheck` 通过；在 renderer 临时写 `process.env` 时类型检查报错，删除后通过
- [ ] T2 在 web 配置和 `electron.vite.config.ts` 的 renderer 中声明 `@/` 指向 `src/renderer/src` — 验证：renderer 用 `@/` 导入的模块在 `pnpm dev` 和构建产物中都能加载
- [ ] T3 以精确版本安装 `@tanstack/router-plugin`，在 renderer 插件中放在 `react()` 之前，开启 `autoCodeSplitting`，`routesDirectory` 与 `generatedRouteTree` 使用绝对路径 — 验证：`pnpm dev` 在 `src/renderer/src/routeTree.gen.ts` 生成路由树，其他位置没有生成文件
- [ ] T4 把 Vitest 改为 node（main、preload）与 jsdom（renderer，含 `.tsx`）两个 project，以精确版本安装 jsdom 与 Testing Library — 验证：desktop 现有测试数量不变且全部通过
- [ ] T5 新增 `lib/desktop-bridge.ts`，作为唯一读取 `window.frameLoom` 的模块；实现 `lib/engine-client.ts`，包括连接缓存与失败后重新获取、5 秒默认超时、schema 解析、把 `ErrorResponse` 解析为 `EngineRequestError`；删除 `health.ts` — 验证：单测覆盖连接缓存、获取失败后重试、超时、成功解析、错误响应与非法响应
- [ ] T6 建立 `app/router.tsx`（hash history、context 与 `Register` 声明）、`app/providers.tsx`、`routes/__root.tsx`（错误页、404 页）与 `routes/index.tsx`；QueryClient 关闭 `retry` 与 `refetchOnWindowFocus` — 验证：`pnpm dev` 显示健康页，地址为 `#/`
- [ ] T7 把健康检查拆入 `features/engine-status/{api,components}` — 验证：组件测试覆盖加载中、正常、错误三种状态
- [ ] T8 运行 `pnpm --filter @frame-loom/desktop package:dir` 和 `test:e2e`，启动加固 exe 后在任务管理器中结束 `Frame Loom Engine` — 验证：e2e 通过；重载后地址仍是原 hash 路由，页面显示中文错误
- [ ] T9 提交 `refactor(desktop): 建立 renderer 文件路由与 engine client`，带 `Note:` 与 `Plan:` 尾注 — 验证：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm run verify` 通过

## 验证

- 预期：web 类型检查拒绝 `process`；路由树只生成在约定位置；desktop 与 renderer 测试全部通过；加固 exe 中结束 engine 后仍停留在原 hash 路由并显示中文错误。
- 实际：未执行。

## 进度

- 2026-10-24：创建子计划草稿。
- 2026-10-24：收到界面设计稿，收尾步骤移到 07；本段只建立骨架，界面由 06、07 实现。

## 发现与偏差

无。

## 交接

尚未开始。T1 至 T4 在 02 完成后即可开始，T5 及之后要等 04 完成。

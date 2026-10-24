# Plan: renderer 骨架

Status: done
Parent: plan.md
Note: ../../notes/implemented/architecture/2026-10-24-engine-and-renderer-foundation.md
Note: ../../notes/implemented/architecture/2026-10-24-desktop-shell.md

## 目标

- desktop 的 tsconfig 拆为 node 与 web 两份，renderer 使用 `@/` 别名。
- renderer 使用 `@tanstack/router-plugin` 文件路由和 `createHashHistory()`，engine client 与 QueryClient 通过路由 context 注入。
- 健康检查迁入 `features/engine-status`，通过 `lib/engine-client.ts` 请求 engine。本段只迁移逻辑，界面暂时沿用现有健康页，外壳与设置中心在 07 中实现。
- Vitest 分 node 与 jsdom 两个 project，renderer 组件测试使用替身 engine client。

## 前置条件

- 02 完成，lint 边界规则已覆盖 renderer 目录。
- T5 及之后依赖 04 完成，contracts 已导出 `ErrorResponse`。

## 步骤

- [x] T1 把 `apps/desktop/tsconfig.json` 拆为 `tsconfig.node.json` 与 `tsconfig.web.json`，根文件只做 references；`typecheck` 脚本分别检查两份 — 验证：`pnpm --filter @frame-loom/desktop typecheck` 通过；在 renderer 临时写 `process.env` 时类型检查报错，删除后通过
- [x] T2 在 web 配置和 `electron.vite.config.ts` 的 renderer 中声明 `@/` 指向 `src/renderer/src` — 验证：renderer 用 `@/` 导入的模块在 `pnpm dev` 和构建产物中都能加载
- [x] T3 以精确版本安装 `@tanstack/router-plugin`，在 renderer 插件中放在 `react()` 之前，开启 `autoCodeSplitting`，`routesDirectory` 与 `generatedRouteTree` 使用绝对路径 — 验证：`pnpm dev` 在 `src/renderer/src/routeTree.gen.ts` 生成路由树，其他位置没有生成文件
- [x] T4 把 Vitest 改为 node（main、preload）与 jsdom（renderer，含 `.tsx`）两个 project，以精确版本安装 jsdom 与 Testing Library — 验证：原 main／preload 33 项保留，原健康请求 6 项迁入客户端测试，扩充后 desktop 共 50 项通过
- [x] T5 新增 `lib/desktop-bridge.ts`，作为唯一读取 `window.frameLoom` 的模块；实现 `lib/engine-client.ts`，包括连接缓存与失败后重新获取、5 秒默认 HTTP 超时、schema 解析、把 `ErrorResponse` 解析为 `EngineRequestError`；删除原 `health.ts` — 验证：单测覆盖连接缓存、获取失败后重试、超时、成功解析、错误响应与非法响应
- [x] T6 建立 `app/router.tsx`（hash history、context 与 `Register` 声明）、`app/providers.tsx`、`routes/__root.tsx`（错误页、404 页）与 `routes/index.tsx`；QueryClient 关闭 `retry` 与 `refetchOnWindowFocus` — 验证：`pnpm dev` 显示健康页，地址为 `#/`
- [x] T7 把健康检查拆入 `features/engine-status/{api,components}` — 验证：组件测试覆盖加载中、正常、错误三种状态
- [x] T8 运行 `pnpm --filter @frame-loom/desktop package:dir` 和 `test:e2e`，启动加固 exe 后按 PID 结束 `Frame Loom Engine` — 验证：e2e 通过；重载后地址仍是原 hash 路由，页面显示中文错误
- [x] T9 提交 `refactor(desktop): 建立 renderer 文件路由与 engine client`，带 `Note:` 与 `Plan:` 尾注 — 验证：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm run verify` 通过

## 验证

- 预期：web 类型检查拒绝 `process`；路由树只生成在约定位置；desktop 与 renderer 测试全部通过；加固 exe 中结束 engine 后仍停留在原 hash 路由并显示中文错误。
- 类型与边界：`pnpm lint`、`pnpm typecheck` 通过。renderer 临时 `process.env.NODE_ENV` 探针被 web 类型检查以 TS2591 拒绝，删除后通过；`lib/` 临时用 `@/` 重导出 feature 被 `import-x/no-restricted-paths` 拒绝，删除后通过。路由树只出现在 `apps/desktop/src/renderer/src/routeTree.gen.ts`，生成文件已入库。
- 单测：`pnpm test` 共 183 项通过（contracts 53、engine 80、desktop 50）。`vitest list --json` 确认原 main／preload 33 项在 node project，renderer 17 项在 jsdom project；组件通过路由 context 注入替身客户端，覆盖加载、成功、失败、重新检查、404 与 hash 初始化。客户端覆盖连接缓存、失败重取、响应 schema、错误契约、非法体、跨源地址、取消、五秒 HTTP 超时及等待首次连接时不计 HTTP 超时。
- 依赖与文档：`pnpm install --frozen-lockfile`、`pnpm format:check`、`pnpm run verify` 与 `git diff --check` 通过。新增依赖均精确锁定，未升级现有依赖。已有桌面壳、lint 与基础设施笔记以及桌面 README 同步当前事实。
- 构建：`pnpm --filter @frame-loom/desktop package:dir --config.electronDist=E:/Workspace/project/personal_project/frame-loom/apps/desktop/node_modules/electron/dist` 通过，复用本地同版本 Electron 45.0.0，不修改仓库打包配置或生产 fuse。`pnpm --filter @frame-loom/desktop test:e2e` 1 项通过，覆盖健康状态、`#/missing` 重载、404 返回、页面隔离和正常退出。
- 实机：`.cache/verify-renderer-skeleton.mjs dev` 与 `packaged` 通过，开发由根 `pnpm dev` 启动，加固 exe 直接启动。两者健康版本为 0.1.0，首页 `#/`，未知路由重载仍可返回首页；加固 exe 中真实终止 engine，自动重载后保留 `#/?probe=retained`，显示“连接中断”和“无法连接本地引擎，请重新启动应用”。窗口无未处理页面错误，正常关闭退出码 0，各自 4 个子进程全部退出。`.cache/05-renderer-dev.png`、`.cache/05-renderer-packaged.png` 与 `.cache/05-renderer-packaged-error.png` 为截图证据，后两张已查看。

## 进度

- 2026-10-24：创建子计划草稿。
- 2026-10-24：收到界面设计稿，收尾步骤移到 07；本段只建立骨架，界面由 06、07 实现。
- 2026-10-24：用户授权执行 05，02、04 已完成；开始类型隔离、路由、客户端与测试迁移，保留现有健康页。
- 2026-10-24：T1～T9 完成；183 项单测、质量门禁、冻结安装、桌面 e2e、开发窗口与真实加固 exe 的路由／故障检查通过，按计划独立提交。06、07 保持 draft。

## 发现与偏差

- `createHashHistory()` 本身将空 hash 解析为首页，却不改写地址；增加初始化归一并测试，保留已有路径及查询参数。
- 实机首次连接会等待 engine 冷启动；若从获取 IPC 连接前开始五秒计时，就绪后首次 HTTP 请求可能立即超时。保留原健康请求的边界：连接由主进程 30 秒 ready 超时约束，HTTP 从连接就绪后计五秒，并补回归测试。
- 组合测试需使用 app/providers 和真实路由，放在 `app/router.test.tsx`，避免在 feature 中反向依赖 app。文件路由仅放宽 Fast Refresh 导出检查，其他组件与导入边界不放宽。
- T8 用系统进程信息准确定位并终止 engine PID，验证与任务管理器结束同一进程的结果。打包继续复用本地同版本 Electron；未重做 NSIS 安装／卸载或远端 CI。
- 共享基础设施笔记仍含设置中心中的健康检查验收，依父计划约定留待 07 整体转入 implemented；本次实现与验证同步进已实现的桌面壳笔记，不把 06、07 写成已完成。

## 交接

无。

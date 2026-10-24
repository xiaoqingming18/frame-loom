# Plan: Electron 桌面壳

Status: done
Parent: plan.md
Note: ../../notes/implemented/architecture/2026-10-24-desktop-shell.md

## 目标

建立 `apps/desktop`（包名 `@frame-loom/desktop`），用 electron-vite 管理 main、preload、renderer 三个入口。`pnpm dev` 启动后需要做到：

- 主进程生成 token，用 `utilityProcess.fork` 拉起 engine，等 engine 报告 ready；
- renderer 通过 preload 暴露的 `frameLoom.getEngineConnection()` 拿到连接信息，请求 `/health`，并在界面上显示 engine 版本和 schema 版本；
- 渲染层拿不到任何 Node 能力。

## 前置条件

- 03 完成：engine 能单独启动，`services/engine/dist/main.js` 已构建。

## 步骤

- [x] T1 初始化 `apps/desktop`：用 electron-vite 6 的配置，main 和 preload 用 Node 目标，renderer 用 React 19 加 Vite 8。依赖都写精确版本：`electron` 用 45.x 的具体补丁版；React、TanStack Router 和 Query、Tailwind 放进 `devDependencies`，由 Vite 打包。`dependencies` 保持为空。在 `allowBuilds` 里登记 `electron`，桌面包显式调用 `install-electron` 下载二进制 — 验证：`pnpm --filter @frame-loom/desktop build` 生成 `out/main`、`out/preload`、`out/renderer`
- [x] T2 主进程用 ESM。就绪前完成单实例锁和协议注册；有异步前置操作时必须等待，就绪后的窗口与服务由 `app.whenReady().then(start)` 初始化。具体包括三件事：
  - 申请单实例锁，拿不到就退出；
  - 注册 `app://` 特权协议，打包后用它加载 renderer，开发模式加载 Vite 开发服务器的地址；
  - 创建窗口，`webPreferences` 设为 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`，用 `setWindowOpenHandler` 拒绝新窗口，用 `will-navigate` 阻止跳转到应用外的地址。

  验证：窗口出现；在 DevTools 里执行 `window.open('https://example.com')` 不会打开新窗口
- [x] T3 主进程管理 engine，步骤如下：
  1. 用 `crypto.randomBytes(32).toString('hex')` 生成 token；
  2. 确定 engine 入口：开发模式用 `services/engine/dist/main.js`，打包后用 `process.resourcesPath/engine/dist/main.js`；
  3. 用 `utilityProcess.fork` 启动，通过 `env` 传入 `FRAME_LOOM_TOKEN`、`FRAME_LOOM_DATA_DIR`（取 `app.getPath('userData')`）、`FRAME_LOOM_ALLOWED_ORIGINS`；
  4. 等 `ready` 消息，超时 15 秒；
  5. engine 退出时记录退出码，并通知 renderer；
  6. 应用退出前给 engine 发退出消息，等它退出。

  如果 `fork` 不能直接加载 ESM 入口，就加一个 `main.cjs` 引导文件，在里面 `await import('./main.js')`，并把这件事记进本文件的「发现与偏差」。

  验证：开发模式启动后，主进程日志打印 engine 端口；关闭窗口后，engine 进程不会残留，可以用任务管理器或 `Get-Process` 确认
- [x] T4 写 preload，打包成 CommonJS。只用 `contextBridge.exposeInMainWorld('frameLoom', { getEngineConnection })`，内部调用 `ipcRenderer.invoke('engine:connection')`。不暴露 `ipcRenderer` 本身，也不使用 `Buffer` 等 Node 全局。主进程的 `ipcMain.handle` 校验同一应用窗口、主框架和可信源。返回值在 renderer 侧用 `EngineConnection.parse` 校验 — 验证：真实窗口中三个 Node 全局都是 `'undefined'`，连接返回 `baseUrl` 和 `token`
- [x] T5 写 renderer。用 TanStack Query 带 Bearer 头请求 `/health`，响应用 `HealthResponse.parse` 校验后显示 engine 版本、schema 版本和启动时间。engine 不可用时显示中文错误状态。TanStack Router 只建一个根路由，不建业务页面 — 验证：`pnpm dev` 的窗口显示健康信息；手动结束 engine 进程后，界面显示错误状态
- [x] T6 在根目录加 `dev` 脚本：先构建 contracts 和 engine，再执行 `pnpm --filter @frame-loom/desktop dev`。engine 改动后不做热重载，需要重启 `pnpm dev`，在代码里用 `shortcut:` 注释写明这个限制 — 验证：干净克隆应用当前改动后，`pnpm install --frozen-lockfile` 与 `pnpm dev` 显示健康信息
- [x] T7 给主进程里可单测的部分写 Vitest：解析 engine 入口路径、处理 ready 消息和超时、ipc 来源校验。不需要 Electron 运行时 — 验证：`pnpm --filter @frame-loom/desktop test` 的 37 项测试通过
- [x] T8 提交 `feat(desktop): 新增 Electron 桌面壳并接入 engine`，带 `Note:` 和 `Plan:` 尾注 — 验证：`pnpm run verify` 和 `pnpm -r test` 通过，与本计划收尾同批提交

## 验证

- 预期：
  - `pnpm dev` 打开窗口，显示 engine 健康信息；
  - 渲染层没有 Node 能力；
  - 关闭应用后 engine 进程退出；
  - engine 不可用时界面显示错误状态。
- 实际：Windows x64、Node 24.22.1、pnpm 12.15.0 下，三个入口构建与全仓类型检查通过；`pnpm -r test` 共 150 项通过（contracts 43、engine 70、desktop 37），`test:plans` 37 项与 `test:commit-convention` 29 项通过。
- 无依赖、无构建产物的干净克隆应用当前改动，冻结安装自动执行 `install-electron`，`pnpm dev` 打开窗口。CDP 断言 engine 0.1.0、schema 1、启动时间、Node 全局隔离、仅有约定 preload 方法；匿名与错误令牌均为 401，弹窗和外部导航被阻止。
- 生产构建预览通过 `app://frame-loom/` 加载页面，同样的健康与安全断言通过；截图经检查，无横向溢出。手动结束开发窗口的 engine 后显示中文连接中断。
- 关闭干净克隆窗口，engine 以 0 退出，无超时强杀；进程检查无残留。数据库确认位于 `%APPDATA%\Frame Loom\data\frame-loom.sqlite`。
- 本次 CDP 联调脚本和截图位于忽略的 `.cache/`，未引入正式 Playwright e2e 或安装包能力。

## 进度

- 2026-10-24：创建子计划草稿。
- 2026-10-24：用户授权执行 04，开始桌面壳、安全边界与真实 Electron 联调。
- 2026-10-24：完成 T1–T7 和真实开发／app 协议验证；修复 utilityProcess 资源关闭后仍驻留的问题，干净克隆启动与正常关闭通过，桌面壳笔记转 implemented，与 T8 同批收尾。

## 发现与偏差

- Electron 45.0.0 实际包没有安装生命周期脚本，单靠 `allowBuilds` 不会下载二进制；桌面包显式配置 `postinstall: install-electron`，干净克隆冻结安装通过。
- 主模块顶层等待 `app.whenReady()` 会让模块加载与 ready 互相等待；就绪前的同步安全设置先执行，窗口和 engine 通过 `.then(start)` 在就绪后初始化。
- utilityProcess 可直接加载 ESM，better-sqlite3 Node-API 预编译模块直接可用，无需 CJS 引导或重编译。
- 实测 utilityProcess 在服务和数据库关闭、消息监听清除后仍驻留。engine 在 parentPort 环境完成资源关闭后显式退出，启动失败显式退出 1；普通 Node 不变。生产入口测试的 shim 保持活动定时器，防止再次只在普通 Node 下误判。
- engine 退出通知通过重载当前健康页实现，保持 preload 仅一个方法；此捷径已在代码和笔记标记，引入有状态业务页面时改为类型化事件。
- 完整架构仍是 proposed，由 05 验证安装包后流转；本次独立桌面壳笔记已 implemented，并同步 engine 笔记与项目现状。

## 交接

无。

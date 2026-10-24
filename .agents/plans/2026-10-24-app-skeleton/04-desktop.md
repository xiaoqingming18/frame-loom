# Plan: Electron 桌面壳

Status: draft
Parent: plan.md

## 目标

建立 `apps/desktop`（包名 `@frame-loom/desktop`），用 electron-vite 管理 main、preload、renderer 三个入口。`pnpm dev` 启动后需要做到：

- 主进程生成 token，用 `utilityProcess.fork` 拉起 engine，等 engine 报告 ready；
- renderer 通过 preload 暴露的 `frameLoom.getEngineConnection()` 拿到连接信息，请求 `/health`，并在界面上显示 engine 版本和 schema 版本；
- 渲染层拿不到任何 Node 能力。

## 前置条件

- 03 完成：engine 能单独启动，`services/engine/dist/main.js` 已构建。

## 步骤

- [ ] T1 初始化 `apps/desktop`：用 electron-vite 6 的配置，main 和 preload 用 Node 目标，renderer 用 React 19 加 Vite 8。依赖都写精确版本：`electron` 用 45.x 的具体补丁版；React、TanStack Router 和 Query、Tailwind 放进 `devDependencies`，由 Vite 打包。`dependencies` 保持为空。在 `allowBuilds` 里登记 `electron`，它需要靠安装脚本下载二进制 — 验证：`pnpm --filter @frame-loom/desktop build` 生成 `out/main`、`out/preload`、`out/renderer`
- [ ] T2 主进程用 ESM。`app.whenReady()` 之前要做的事都要 `await`。具体包括三件事：
  - 申请单实例锁，拿不到就退出；
  - 注册 `app://` 特权协议，打包后用它加载 renderer，开发模式加载 Vite 开发服务器的地址；
  - 创建窗口，`webPreferences` 设为 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`，用 `setWindowOpenHandler` 拒绝新窗口，用 `will-navigate` 阻止跳转到应用外的地址。

  验证：窗口出现；在 DevTools 里执行 `window.open('https://example.com')` 不会打开新窗口
- [ ] T3 主进程管理 engine，步骤如下：
  1. 用 `crypto.randomBytes(32).toString('hex')` 生成 token；
  2. 确定 engine 入口：开发模式用 `services/engine/dist/main.js`，打包后用 `process.resourcesPath/engine/dist/main.js`；
  3. 用 `utilityProcess.fork` 启动，通过 `env` 传入 `FRAME_LOOM_TOKEN`、`FRAME_LOOM_DATA_DIR`（取 `app.getPath('userData')`）、`FRAME_LOOM_ALLOWED_ORIGINS`；
  4. 等 `ready` 消息，超时 15 秒；
  5. engine 退出时记录退出码，并通知 renderer；
  6. 应用退出前给 engine 发退出消息，等它退出。

  如果 `fork` 不能直接加载 ESM 入口，就加一个 `main.cjs` 引导文件，在里面 `await import('./main.js')`，并把这件事记进本文件的「发现与偏差」。

  验证：开发模式启动后，主进程日志打印 engine 端口；关闭窗口后，engine 进程不会残留，可以用任务管理器或 `Get-Process` 确认
- [ ] T4 写 preload，打包成 CommonJS。只用 `contextBridge.exposeInMainWorld('frameLoom', { getEngineConnection })`，内部调用 `ipcRenderer.invoke('engine:connection')`。不暴露 `ipcRenderer` 本身，也不使用 `Buffer` 等 Node 全局。主进程的 `ipcMain.handle` 要校验 `event.senderFrame` 的源是应用自己的源。返回值在 renderer 侧用 `EngineConnection.parse` 校验 — 验证：在 DevTools 里，`typeof window.require`、`typeof window.process`、`typeof window.ipcRenderer` 都是 `'undefined'`；`await frameLoom.getEngineConnection()` 返回 `baseUrl` 和 `token`
- [ ] T5 写 renderer。用 TanStack Query 带 Bearer 头请求 `/health`，响应用 `HealthResponse.parse` 校验后显示 engine 版本、schema 版本和启动时间。engine 不可用时显示中文错误状态。TanStack Router 只建一个根路由，不建业务页面 — 验证：`pnpm dev` 的窗口显示健康信息；手动结束 engine 进程后，界面显示错误状态
- [ ] T6 在根目录加 `dev` 脚本：先构建 contracts 和 engine，再执行 `pnpm --filter @frame-loom/desktop dev`。engine 改动后不做热重载，需要重启 `pnpm dev`，在代码里用 `shortcut:` 注释写明这个限制 — 验证：在干净的克隆上执行 `pnpm install && pnpm dev`，窗口能显示健康信息
- [ ] T7 给主进程里可单测的部分写 Vitest：解析 engine 入口路径、处理 ready 消息和超时、ipc 来源校验。不需要 Electron 运行时 — 验证：`pnpm --filter @frame-loom/desktop test` 通过
- [ ] T8 提交 `feat(desktop): 新增 Electron 桌面壳并接入 engine`，带 `Note:` 和 `Plan:` 尾注 — 验证：`pnpm run verify` 和 `pnpm -r test` 通过

## 验证

- 预期：
  - `pnpm dev` 打开窗口，显示 engine 健康信息；
  - 渲染层没有 Node 能力；
  - 关闭应用后 engine 进程退出；
  - engine 不可用时界面显示错误状态。
- 实际：未执行。

## 进度

- 2026-10-24：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始，要等 03 完成。T1、T2 可以和 03 并行做。

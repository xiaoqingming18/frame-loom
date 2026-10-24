# 桌面壳

Electron 45、electron-vite 6 和 React 19 的最小工作台，当前只有健康状态页。主进程与 engine 的生命周期、安全边界见[桌面壳决策](../../.agents/notes/implemented/architecture/2026-10-24-desktop-shell.md)。

在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm dev
```

安装时桌面包的 `postinstall` 执行 Electron 45 提供的 `install-electron` 下载二进制。首次安装需要能访问 Electron 下载站点。`pnpm dev` 先构建 contracts 与 engine，再启动 Vite 和窗口。renderer、main、preload 由 electron-vite 管理；修改 engine 后需要重启该命令。

窗口显示 engine 版本、数据库版本与启动时间；服务启动失败或意外退出显示中文错误。当前不自动重启 engine，退出后需要重新启动应用。关闭窗口会发送 shutdown，等待 HTTP 与 SQLite 关闭；超过五秒仍未退出才强制终止。

开发和生产都使用 Electron 的 `userData`，Windows 默认为 `%APPDATA%\Frame Loom`，数据库位于其下的 `data/frame-loom.sqlite`，不会写入源码目录。

```sh
pnpm build
pnpm --filter @frame-loom/desktop preview
pnpm --filter @frame-loom/desktop test
pnpm typecheck
```

`build` 生成 `out/main/index.js`、`out/preload/index.cjs` 与 `out/renderer/`。`preview` 通过 `app://frame-loom` 加载构建页面，仍使用仓库中的 engine；NSIS 安装包与打包后的路径验证属于子计划 05。

preload 仅提供 `window.frameLoom.getEngineConnection()`，返回的数据由共享契约校验。连接包含本次启动的一次性令牌，调试时不要将它复制到日志或 URL。单元测试不需要 Electron 运行时，覆盖路径、握手、超时、退出、IPC 来源和健康请求校验。

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

`build` 生成 `out/main/index.js`、`out/preload/index.cjs` 与 `out/renderer/`。`preview` 通过 `app://frame-loom` 加载构建页面，仍使用仓库中的 engine。

## Windows 打包与冒烟测试

在 Windows x64 的仓库根目录执行：

```sh
pnpm --filter @frame-loom/desktop package:dir
pnpm package:win
pnpm --filter @frame-loom/desktop test:e2e
```

`package:dir` 自动构建三个包、部署 engine 并生成 `apps/desktop/release/win-unpacked/`；`package:win` 执行相同步骤后生成 `apps/desktop/release/Frame Loom Setup 0.1.0.exe`。重复执行会重新生成 `apps/desktop/build/engine`。首次打包需要下载 electron-builder 的 Electron、NSIS 与压缩工具；不要求本机安装 C++ 编译工具。

桌面产物进入 `app.asar`，engine 与生产依赖位于 `resources/engine`。仅部署目录使用 hoisted 依赖树，避免 Windows 目录链接指回仓库；仓库依赖仍为 isolated。NSIS 按用户安装，卸载保留 `%APPDATA%\Frame Loom`。当前不签名、不发布、不配置更新，使用默认 Electron 图标。

生产 fuse 关闭 Node 运行模式、环境选项和主进程调试，并启用仅从 asar 加载和完整性验证。Playwright 的 `_electron` 依赖主进程调试，因此冒烟测试使用未加固的 Electron 启动 `out/` 构建产物，不更改生产 fuse。先运行 `package:dir` 或 `package:win` 准备构建产物；测试使用独立临时数据目录，检查健康状态、页面隔离与 engine 正常退出，不需要下载 Playwright 浏览器。加固 exe 与真实安装／卸载的本地验证证据见[打包计划](../../.agents/plans/2026-10-24-app-skeleton/05-package.md)。

`.github/workflows/build.yml` 在 Windows 上构建、测试并上传安装包，不执行发布。远端执行结果以 GitHub Actions 为准。

preload 仅提供 `window.frameLoom.getEngineConnection()`，返回的数据由共享契约校验。连接包含本次启动的一次性令牌，调试时不要将它复制到日志或 URL。单元测试不需要 Electron 运行时，覆盖路径、握手、超时、退出、IPC 来源和健康请求校验。

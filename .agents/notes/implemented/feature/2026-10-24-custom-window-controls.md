# Agent Note: 自定义标题栏窗口按钮

Status: implemented

## Problem

当前文字、菜单和拖动区域由 renderer 绘制，但窗口按钮由 Windows 的 titleBarOverlay 绘制。用户明确要求包括窗口按钮在内的完整自定义标题栏。

## Decision

BrowserWindow 使用 `frame: false`，移除 titleBarOverlay。renderer 在既有 42px 标题栏右侧绘制最小化、最大化／还原和关闭按钮；按钮区域使用 `no-drag`，空白区域仍由 Electron 的拖动区域处理拖动和原生双击行为。颜色沿用语义 token，关闭按钮悬停使用 destructive。

复用可信 `window:command`，新增 `close` 调用 `window.close()`，保留文件菜单的 `quit` 与现有正常关闭 engine 流程。通过可信查询读取最大化状态，并在 maximize／unmaximize 时由主进程通知 preload；renderer 桥接只暴露布尔值和取消订阅函数，不暴露原始 IPC 事件。事件和首次查询竞争时以已收到的事件为准，卸载移除订阅。

主进程继续同步窗口背景，删除原生按钮专用颜色。设置路由、主题持久化与安全策略不变。

窗口按钮的层级高于模态遮罩，并显式启用指针事件；设置窗口的外部交互处理忽略窗口按钮，因此最小化或最大化不会关闭设置。按钮仍通过既有桥接访问主进程，未扩大 renderer 的系统权限。

### 相关笔记审计

- [主题与应用外壳](2026-10-24-theme-and-app-shell.md)：部分替代其保留原生按钮的决定，互链保留主题机制与原选型理由。
- [桌面壳](../architecture/2026-10-24-desktop-shell.md)：同步现有窗口事实，启动、退出、安全边界仍成立。
- 设置快捷面板、renderer 基础设施和共享契约笔记：分层与路由约束不变，不改原决定。

## Alternatives considered

- 保留 titleBarOverlay 可保留 Windows 原生按钮的悬停贴靠布局与系统行为；但无法满足用户自绘按钮要求，因此改为无框窗口。
- 只在按钮点击时切换最大化图标实现更短，但无法反映双击标题栏、系统快捷键和菜单触发的最大化变化，因此使用真实窗口事件。

## Consequences

- 标题栏颜色、按钮和交互反馈完全使用应用组件与主题，明暗样式不再依赖 Windows 原生按钮绘制；主进程只复制窗口背景色。
- 自绘需要维护可访问名称、最大化状态事件与模态窗口按钮穿透。首次状态查询不能覆盖更新的事件，卸载必须取消订阅。
- 自绘最大化按钮不提供 Windows 11 原生按钮悬停的贴靠布局弹层；仍可使用系统拖动贴靠与快捷键。未来若要求该悬停弹层，需要重新评估原生按钮或 Windows 专用命中测试。
- 关闭窗口调用 `window.close()`，最后一个窗口关闭后通过既有退出流程回收 engine；文件菜单的退出继续调用 `app.quit()`。

## Verification

- `pnpm test`：239 项单测通过（contracts 69、engine 80、desktop 90）；覆盖新增 close 命令、可信状态查询、preload 事件剥离与清理、状态返回校验、首次查询与事件竞争、按钮转发和失败重试。
- 桌面 4 项 e2e 通过，覆盖自绘最小化、最大化／还原、外部窗口状态变化和重载同步、设置模态中最小化后保留页面、关闭按钮正常退出与 engine 回收。
- 加固 `win-unpacked/Frame Loom.exe` 实际启动，用 Win32 输入检查标题栏拖动和双击最大化／还原，用真实窗口状态核对按钮最小化、恢复、全屏与正常关闭；核对明暗主题、关闭悬停、小窗口及模态窗口按钮可操作，无页面错误与 CSP 拦截。证据位于忽略目录 `.cache/titlebar-*.png`、`.cache/custom-titlebar.log`。
- `pnpm lint`、`pnpm typecheck`、`pnpm format:check` 与 `pnpm run verify` 通过。未重跑安装／卸载，未改变生产 fuse。

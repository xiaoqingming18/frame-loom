# Agent Note: Electron 桌面壳的服务托管与可信页面边界

Status: implemented

## Problem

[完整应用骨架提案](../../proposed/architecture/2026-10-24-desktop-stack-and-process-model.md)已确定 Electron、React 和 utilityProcess。需要把独立 engine 接入窗口，并保证令牌只交给应用自己的主框架，服务启动失败、意外退出与应用关闭都有明确行为。

## Decision

- `apps/desktop` 用 electron-vite 6 构建 ESM 主进程、CommonJS preload 和 React 19 renderer；桌面运行时依赖全量打包，`dependencies` 为空。
- 开发加载 Vite 的完整源，构建产物使用 `app://frame-loom`。自定义协议只提供 renderer 目录内的静态文件；新窗口与外部导航被拒绝。窗口开启隔离、沙箱并关闭 Node 集成。
- 每次启动生成独立随机令牌，utilityProcess 直接加载 engine 的 ESM 入口，传入 userData 和唯一允许源。15 秒内没有合法 ready、提前退出或启动失败都拒绝连接请求。退出时先发送 shutdown，限时等待后强制结束子进程，避免残留。
- preload 仅暴露 `getEngineConnection`。IPC 同时校验发起者属于应用窗口、是主框架、URL 属于可信源。engine 退出时主进程使 renderer 的健康查询失效；界面通过 TanStack Query 重新请求并显示中文错误，不增加第二个 preload API。
- renderer 用 contracts 校验连接与健康响应。只建立根路由和状态页，显示 engine 版本、schema 版本与启动时间，不添加业务页面。
- 根 `pnpm dev` 先构建 contracts、engine。engine 源码不热重载，需要重启命令。
- 真实 Electron 45 探针确认 utilityProcess 在移除 parentPort 监听后仍不自然退出。engine 在完成 HTTP／数据库关闭与监听清理后，仅在存在 parentPort 时显式退出；启动失败同样非零退出。普通 Node 保留自然退出。此处同步 engine 笔记与生产入口测试，测试 shim 保持活动句柄以复现差异。
- `app.setName('Frame Loom')` 在就绪前执行，开发和生产共用 userData，Windows 为 `%APPDATA%\Frame Loom`。单实例锁和特权协议同步注册；就绪后的初始化通过 `app.whenReady().then(start)` 执行，不能顶层等待 `whenReady()`，否则主模块加载与 ready 互相等待。
- Electron 45 的 npm 包不再声明安装生命周期脚本，electron-vite 却直接读取二进制路径文件。桌面包显式以 `postinstall: install-electron` 下载二进制；`allowBuilds` 保留精确 Electron 版本登记。桌面测试先构建 contracts，避免依赖其他包并行构建的时序。

## 版本与参考依据

2026-10-24 查询 npm registry 并读取本机安装包；基于在线查询结果，版本与内容可能随时间变化，以锁文件和实测为准：

- [Electron 45.0.0 包元数据](https://registry.npmjs.org/electron/45.0.0)、[electron-vite 6.0.0](https://registry.npmjs.org/electron-vite/6.0.0)：核对 `install-electron` 入口、无 postinstall 事实及 `build.externalizeDeps: false`。
- [Electron ESM 说明](https://www.electronjs.org/docs/latest/tutorial/esm)：就绪前所需异步操作必须等待；本实现的就绪前操作均同步，就绪后的窗口与服务使用回调初始化。
- [parentPort API](https://www.electronjs.org/docs/latest/api/parent-port)：消息接口没有 close／unref 方法；最小 utilityProcess 探针确认清空消息监听后仍驻留，资源清理后使用显式退出。

## 相关笔记核对

- 完整应用骨架提案部分重叠：继续跟踪安装包和整体架构，本篇记录 04 的具体安全与生命周期实现，并互链。
- [engine 服务](../../implemented/architecture/2026-10-24-engine-service.md)部分重叠：复用其 ready/shutdown 与环境配置，不改变服务契约。
- [共享契约](../../implemented/architecture/2026-10-24-shared-contracts.md)部分重叠：直接复用已有 schema，不扩展字段。
- Agent 内核提案与工具链流程笔记无需改变决定。

## Alternatives considered

- **新增 preload 的退出订阅 API**：可以直接向页面推送结构化状态。但本里程碑只需要更新健康结果，主进程使页面重载即可重新查询，也能保持已经约定的单一 preload 方法；有实时业务事件需求时再建立事件契约。
- **只靠轮询发现 engine 退出**：实现简单，但会延迟错误反馈并持续发送请求。主进程已经监听进程退出，直接触发页面刷新即可复用现有错误路径。

## Verification

- Windows x64、Node 24.22.1、pnpm 12.15.0：桌面构建、类型检查通过，生成 ESM main、CommonJS preload 和静态 renderer。
- 桌面 37 项测试覆盖入口路径、合法与非法 ready、超时／提前退出／启动错误、shutdown 与强制终止、主框架及源校验、协议路径越界、Bearer 请求和响应校验。engine 70 项、contracts 43 项全通过；engine 的 parentPort shim 用活动定时器验证显式退出及启动失败路径，监听失败保留退出码 1 并关闭数据库。
- 对当前 HEAD 的干净克隆应用本次改动，不复制 node_modules 或构建产物。`pnpm install --frozen-lockfile` 自动安装 Electron 二进制，随后 `pnpm dev` 打开窗口，CDP 断言版本 0.1.0、schema 1、Node 全局不可用、preload 仅有约定方法、匿名及错误令牌 401、新窗口与外部导航被阻止。
- 仓库中的开发窗口手动终止 engine 后显示中文连接中断；生产构建的 `app://frame-loom/` 页面通过同样的健康与隔离检查，页面截图已检查。修复后的干净克隆关闭窗口，engine 以 0 退出，无超时强杀或残留进程。
- 验证脚本与截图位于忽略的 `.cache/`，只用于本次开发联调；正式 Playwright 冒烟测试留给子计划 05。

## Consequences

- 收益：开发和构建页面都能通过可信 IPC 获得鉴权连接，真实 ESM engine 与 SQLite 已联通，故障与关闭行为可见且可验证。
- 代价：安装依赖需要下载 Electron 二进制；engine 源码修改后需要重启开发命令，暂不增加多进程热重载设施。
- 退出通知通过重载状态页实现，会重置当前页面状态；仅适用于本里程碑的单一健康页面。引入有状态业务页面时必须改为类型化事件，不沿用重载。
- 显式 process.exit 仅用于有 parentPort 的 engine，且始终在 HTTP／数据库关闭后执行；主进程仍保留五秒强制终止作为异常兜底。未实现自动重启。
- NSIS、asar 外部署、fuse 和安装后行为仍由 05 验证；当前的 app 协议预览不能代替安装包测试。权限边界不能防御同用户权限下读取进程环境的恶意程序。

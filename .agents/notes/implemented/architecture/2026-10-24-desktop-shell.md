# Agent Note: Electron 桌面壳的服务托管与可信页面边界

Status: implemented

## Problem

[完整应用骨架](2026-10-24-desktop-stack-and-process-model.md)确定 Electron、React 和 utilityProcess。需要把独立 engine 接入窗口，并保证令牌只交给应用自己的主框架，服务启动失败、意外退出与应用关闭都有明确行为。

## Decision

- `apps/desktop` 用 electron-vite 6 构建 ESM 主进程、CommonJS preload 和 React 19 renderer；桌面运行时依赖全量打包，`dependencies` 为空。
- 开发加载 Vite 的完整源，构建产物使用 `app://frame-loom`。自定义协议只提供 renderer 目录内的静态文件；新窗口与外部导航被拒绝。窗口开启隔离、沙箱并关闭 Node 集成。
- 每次启动生成独立随机令牌，utilityProcess 直接加载 engine 的 ESM 入口，传入 userData 和唯一允许源。30 秒内没有合法 ready、提前退出或启动失败都拒绝连接请求；打包验证中首次部署启动曾超过原定 15 秒，因此给冷启动留出余量，仍保留超时失败。退出先请求关闭窗口，让画布的 `beforeunload` 等待保存；失败保留窗口供恢复或明确放弃。窗口真正关闭后才发送 shutdown，限时等待后强制结束子进程，避免残留与截断最后一次保存，见[无限画布](../feature/2026-10-25-infinite-canvas.md)。
- `main/secret-key.ts` 用 Electron 45 异步 safeStorage 保护随机 32 字节主密钥，原子保存到 `<userData>/secret-key.bin`，只经 `FRAME_LOOM_SECRET_KEY` 交给 engine。解密损坏时备份为 `.broken` 后换新并提示重填凭据；暂时不可用或读写失败时保留可恢复的文件，以空主密钥启动并显示原生提示。主密钥不进入 preload；字段加密和日志边界见[engine 服务](2026-10-24-engine-service.md)。
- preload 暴露 `getEngineConnection`、`theme.get/set`、`window.command` 和窗口最大化状态查询／订阅固定方法。IPC 同时校验发起者属于应用窗口、是主框架、URL 属于可信源，主题和窗口参数使用 contracts 的枚举校验。窗口状态订阅只传布尔值，返回取消订阅函数。engine 退出时主进程不重载页面，只在窗口仍加载可信源时发送 `engine:exited`；preload 的 `onEngineExited` 剥离原始事件、返回取消订阅函数，`lib/desktop-bridge.ts` 只接受整数或 null 退出码。外壳收到后使健康查询失效，界面重新请求并显示中文错误，页面内的编辑状态保留。这一变化由[无限画布](../feature/2026-10-25-infinite-canvas.md)触发，满足下文"引入可编辑业务页面时改为类型化事件"的条件。
- 主进程以 `Menu.setApplicationMenu(null)` 移除默认应用菜单，生产包不响应 Ctrl+R／F5 重载、开发者工具与 Ctrl+±／Ctrl+0 页面缩放；`setVisualZoomLevelLimits(1, 1)` 锁定捏合缩放，实测 Ctrl+滚轮也不改变缩放系数。开发模式保留 F12、Ctrl+Shift+I 打开开发者工具。
- renderer 使用 TanStack 文件路由，`createHashHistory()` 初始化时将空 hash 归一为 `#/`，保留已有 hash 路径与查询参数；未知路径显示中文 404，路由错误显示中文兜底页。`app/shell/` 组合标题栏、侧栏、画布和设置中心，`features/home/` 提供静态首页，`/projects` 提供空状态。根路由以 zod 校验设置开关及页签，非法值回退为关闭；engine 退出后保留当前路径与设置页签。不修改 `app://` 静态文件映射，不添加创作业务。
- `lib/desktop-bridge.ts` 是唯一读取 `window.frameLoom` 的模块。`lib/engine-client.ts` 在闭包中缓存已校验连接的 Promise，合并并发获取；连接或请求失败后，下次重新获取，过时请求不会清除更新的缓存。请求必须同源、无用户信息且拒绝重定向，token 只进入 Authorization 请求头。成功体使用调用方 schema 校验，错误体解析 `ErrorResponse`，非法体、网络错误、取消和超时均使用中文提示。
- 五秒超时只覆盖普通 HTTP；首次获取连接继续受主进程 30 秒 ready 超时约束，避免把冷启动误判成请求失败。client 支持 JSON 写请求和返回异步迭代器的 SSE `stream()`；SSE 无五秒超时，可取消，不自动重连，调用方重连后补拉。engine client 与 QueryClient 由入口创建，经路由 context 注入；健康查询位于 `features/engine-status/api`，界面位于同 feature 的 `components`。QueryClient 默认关闭重试和窗口聚焦刷新。
- `tsconfig.node.json` 覆盖 main、preload、e2e 与配置文件，只加载 Node 类型；`tsconfig.web.json` 覆盖 renderer，只加载 DOM 与 `vite/client`，`@/` 在 web 配置和 Vite renderer 中声明。根 tsconfig 通过 references 关联两份配置，并重复声明 `@/*` 供 shadcn CLI 解析，`typecheck` 仍分别检查 node／web。Vitest 分 node、jsdom 两个 project；组合测试位于 `app/`，通过路由 context 注入替身客户端。
- 主进程创建窗口前读取 `<userData>/preferences.json` 的主题并设置 `nativeTheme`，损坏时回退系统模式；写入先临时文件再重命名。窗口使用 `frame: false`，42px 标题栏和窗口按钮均由 renderer 绘制，窗口背景与 renderer 的媒体查询共用明暗 token，主进程复制的背景色由单测核对。原生按钮的决定由[自定义标题栏窗口按钮](../feature/2026-10-24-custom-window-controls.md)部分替代。生产 CSP 只将 `style-src` 放宽为 `'self' 'unsafe-inline'`，脚本限制不变；Dialog、Tabs、Tooltip 与 Menubar 在加固 exe 打开后无 CSP 违规，细节见[主题与外壳](../feature/2026-10-24-theme-and-app-shell.md)。
- 根 `pnpm dev` 先构建 contracts、engine。engine 源码不热重载，需要重启命令。
- 真实 Electron 45 探针确认 utilityProcess 在移除 parentPort 监听后仍不自然退出。engine 在完成 HTTP／数据库关闭与监听清理后，仅在存在 parentPort 时显式退出；启动失败同样非零退出。普通 Node 保留自然退出。此处同步 engine 笔记与生产入口测试，测试 shim 保持活动句柄以复现差异。
- `app.setName('Frame Loom')` 在就绪前执行，开发和生产共用 userData，Windows 为 `%APPDATA%\Frame Loom`。单实例锁和特权协议同步注册；就绪后的初始化通过 `app.whenReady().then(start)` 执行，不能顶层等待 `whenReady()`，否则主模块加载与 ready 互相等待。
- Electron 45 的 npm 包不再声明安装生命周期脚本，electron-vite 却直接读取二进制路径文件。桌面包显式以 `postinstall: install-electron` 下载二进制；`allowBuilds` 保留精确 Electron 版本登记。桌面测试先构建 contracts，避免依赖其他包并行构建的时序。

## 版本与参考依据

2026-10-24 查询 npm registry 并读取本机安装包；基于在线查询结果，版本与内容可能随时间变化，以锁文件和实测为准：

- [Electron 45.0.0 包元数据](https://registry.npmjs.org/electron/45.0.0)、[electron-vite 6.0.0](https://registry.npmjs.org/electron-vite/6.0.0)：核对 `install-electron` 入口、无 postinstall 事实及 `build.externalizeDeps: false`。
- [Electron ESM 说明](https://www.electronjs.org/docs/latest/tutorial/esm)：就绪前所需异步操作必须等待；本实现的就绪前操作均同步，就绪后的窗口与服务使用回调初始化。
- [parentPort API](https://www.electronjs.org/docs/latest/api/parent-port)：消息接口没有 close／unref 方法；最小 utilityProcess 探针确认清空消息监听后仍驻留，资源清理后使用显式退出。
- renderer 骨架按 npm 元数据精确锁定 [router-plugin 1.168.48](https://registry.npmjs.org/@tanstack/router-plugin/1.168.48)、[jsdom 30.1.3](https://registry.npmjs.org/jsdom/30.1.3)、[Testing Library React 16.3.3](https://registry.npmjs.org/@testing-library/react/16.3.3) 及其必需 peer [DOM 10.4.2](https://registry.npmjs.org/@testing-library/dom/10.4.2)。插件 peer 允许现有 React Router 1.170.46，二者依赖同一版 router-core 1.171.39；插件放在 `react()` 之前，开启自动拆包，路由目录与生成文件用绝对路径，`routeTree.gen.ts` 入库且不手工编辑。

## 相关笔记核对

- [项目库](../../proposed/feature/2026-10-26-project-library.md)的 05、06 已落地：主进程增加目录选择、注册项目显示／回收站、偏好合并和 `frame-project:` 文件代理；全部 IPC 仍核对可信主框架，目录从主进程连接查询并验证磁盘 id。原 `frame-media:` 和画布测试页保留，实际项目画布尚未接入。

- 完整应用骨架提案部分重叠：继续跟踪安装包和整体架构，本篇记录 04 的具体安全与生命周期实现，并互链。
- [engine 服务](../../implemented/architecture/2026-10-24-engine-service.md)部分重叠：复用其 ready/shutdown 与环境配置，不改变服务契约。
- [共享契约](../../implemented/architecture/2026-10-24-shared-contracts.md)部分重叠：直接复用已有 schema，不扩展字段。
- Agent 内核提案与工具链流程笔记无需改变决定。

## Alternatives considered

- **新增 preload 的退出订阅 API**：可以直接向页面推送结构化状态。首个里程碑只需要更新健康结果，曾以页面重载代替；画布引入可编辑状态后，按约定改为该 API，现为当前实现。
- **只靠轮询发现 engine 退出**：实现简单，但会延迟错误反馈并持续发送请求。主进程已经监听进程退出，直接触发页面刷新即可复用现有错误路径。
- 文件路由与浏览器 history、独立 renderer 包及请求框架的取舍，沿用[基础设施笔记](2026-10-24-engine-and-renderer-foundation.md)，不增加第二套协议映射或请求抽象。

## Verification

- 外壳接入后全仓 230 项单测、类型检查和 lint 通过，桌面 e2e 3 项覆盖设置中心、主题重启与引擎故障页签保留。根 `pnpm dev` 和加固 exe 均通过 CDP／Win32 检查，明暗截图已核对，原生拖动、双击与窗口菜单正常，Dialog 无 CSP 违规，退出无残留进程；本轮不重复安装／卸载。
- 主题接入后全仓 221 项单测、类型／lint／格式门禁及桌面 e2e 2 项通过；开发和加固 exe 的损坏偏好、明暗切换、重启保持与原生按钮截图通过，真实 Windows 系统主题切换并恢复已验证。生产 `script-src` 保持 `'self'`，三个新增 IPC 的不可信调用方与非法参数均有测试，写入失败不切主题。具体证据见主题提案的 06 实现节。
- renderer 骨架迁移后，`pnpm lint`、`pnpm typecheck`、`pnpm format:check`、`pnpm run verify`、`pnpm install --frozen-lockfile` 通过。`pnpm test` 共 183 项通过（contracts 53、engine 80、desktop 50）；desktop 原 main／preload 33 项保留，renderer 17 项在 jsdom 中覆盖客户端和真实路由组合。临时 `process.env` 探针被 web 类型检查以 TS2591 拒绝，`@/` 反向依赖探针被导入边界拒绝；两者均已删除。
- Windows x64 的 `package:dir` 复用本地同版本 Electron 45.0.0，生产 fuse 不变；桌面 e2e 1 项通过，覆盖健康状态、hash 重载、404 返回、页面隔离与正常退出。根 `pnpm dev` 与真实加固 exe 均通过 CDP 验证，截图已核对；真实终止 engine 后自动重载，保留 `#/?probe=retained`，显示中文连接中断与重启提示。无未处理页面错误，关闭退出码 0，各自 4 个子进程全部退出。未重跑 NSIS 安装／卸载、未运行远端 CI。
- Windows x64、Node 24.22.1、pnpm 12.15.0：桌面构建、类型检查通过，生成 ESM main、CommonJS preload 和静态 renderer。
- 桌面 37 项测试覆盖入口路径、合法与非法 ready、超时／提前退出／启动错误、shutdown 与强制终止、主框架及源校验、协议路径越界、Bearer 请求和响应校验。engine 70 项、contracts 43 项全通过；engine 的 parentPort shim 用活动定时器验证显式退出及启动失败路径，监听失败保留退出码 1 并关闭数据库。
- 对当前 HEAD 的干净克隆应用本次改动，不复制 node_modules 或构建产物。`pnpm install --frozen-lockfile` 自动安装 Electron 二进制，随后 `pnpm dev` 打开窗口，CDP 断言版本 0.1.0、schema 1、Node 全局不可用、preload 仅有约定方法、匿名及错误令牌 401、新窗口与外部导航被阻止。
- 仓库中的开发窗口手动终止 engine 后显示中文连接中断；生产构建的 `app://frame-loom/` 页面通过同样的健康与隔离检查，页面截图已检查。修复后的干净克隆关闭窗口，engine 以 0 退出，无超时强杀或残留进程。
- 验证脚本与截图位于忽略的 `.cache/`；正式 Playwright 冒烟由 `apps/desktop/e2e/smoke.test.ts` 覆盖构建产物，生产加固与安装分发的验证见完整架构。

## Consequences

- 收益：开发和构建页面都能通过可信 IPC 获得鉴权连接，真实 ESM engine 与 SQLite 已联通，故障与关闭行为可见且可验证。
- 代价：安装依赖需要下载 Electron 二进制；engine 源码修改后需要重启开发命令，暂不增加多进程热重载设施。
- renderer 骨架及 UI 依赖随 Vite 打包，桌面运行时 `dependencies` 仍为空；需要维护生成路由树、node／web 类型配置和主题 token。主题、设置中心与应用外壳见[主题与外壳笔记](../feature/2026-10-24-theme-and-app-shell.md)。
- 退出通知使用类型化 `engine:exited` 事件，页面状态与输入不丢失；engine 退出后仍不自动重启，后续请求返回中文连接错误。默认菜单移除后，页面需要的快捷键由 renderer 自行处理。
- 运行环境若设置 `ELECTRON_RUN_AS_NODE=1`（例如由 Electron 宿主启动的终端），Electron 按 Node 运行，桌面 e2e 会报 "Process failed to launch"；运行前须清除该变量。
- 显式 process.exit 仅用于有 parentPort 的 engine，且始终在 HTTP／数据库关闭后执行；主进程仍保留五秒强制终止作为异常兜底。未实现自动重启。
- NSIS、asar 外部署、fuse 和安装后行为已由分发验证覆盖；app 协议预览仍不能代替安装包测试。权限边界不能防御同用户权限下读取进程环境的恶意程序。

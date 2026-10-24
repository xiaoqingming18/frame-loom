# 桌面壳

Electron 45、electron-vite 6 和 React 19 工作台，包含标题栏菜单、可折叠侧栏、静态首页、项目库空状态及设置中心。主进程与 engine 的生命周期、安全边界见[桌面壳决策](../../.agents/notes/implemented/architecture/2026-10-24-desktop-shell.md)。

在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm dev
```

安装时桌面包的 `postinstall` 执行 Electron 45 提供的 `install-electron` 下载二进制。首次安装需要能访问 Electron 下载站点。`pnpm dev` 先构建 contracts 与 engine，再启动 Vite 和窗口。renderer、main、preload 由 electron-vite 管理；修改 engine 后需要重启该命令。

侧栏底部的设置中心先向上弹出快捷面板，可直接切换暗黑／明亮／跟随系统主题，或通过「设置」打开分栏模态窗口。外观页提供相同主题选择，本地引擎页显示 engine 版本、数据库版本与启动时间，关于页显示构建注入的应用版本。服务启动失败或意外退出显示中文错误，设置入口出现圆点；重载保留 hash 路径与设置页签。当前不自动重启 engine，退出后需要重新启动应用。关闭窗口会发送 shutdown，等待 HTTP 与 SQLite 关闭；超过五秒仍未退出才强制终止。

renderer 使用 TanStack 文件路由与 hash history，首页地址为 `#/`；未知路由显示中文 404，重载保留 hash 路径。`app/router.tsx` 与 `app/providers.tsx` 组合应用，健康查询和界面位于 `features/engine-status/`。只有 `lib/desktop-bridge.ts` 读取 preload，所有 engine 请求经 `lib/engine-client.ts` 校验连接和响应；HTTP 请求默认五秒超时，连接就绪前保留主进程的三十秒冷启动等待。客户端和 QueryClient 通过路由 context 注入，默认不重试、不随窗口聚焦刷新。

`tsconfig.node.json` 与 `tsconfig.web.json` 分别检查 Node 和浏览器代码，避免 renderer 误用 `process`；`@/` 指向 `src/renderer/src`。Vitest 的 node project 覆盖 main、preload，jsdom project 覆盖 renderer 及 `.tsx` 组合测试。文件路由由开发／构建插件生成 `src/renderer/src/routeTree.gen.ts` 并入库，不手工编辑。

主题颜色统一定义在 `src/renderer/src/styles/theme.css`，由 `prefers-color-scheme` 选择明暗值；主进程在创建窗口前读取 `<userData>/preferences.json` 并设置 `nativeTheme.themeSource`，文件缺失或损坏时跟随系统。隐藏标题栏的原生窗口按钮和背景同步更新，切换主题时先持久化再生效。shadcn 组件位于 `components/ui/`，`components.json` 和根 tsconfig 的别名供 CLI 解析；UI 使用语义 token，调色板、任意值颜色与直接内联颜色会被 lint 拒绝，类名由 Prettier 排序。`app/shell/` 组合外壳与设置弹窗，根路由校验 `settings=appearance|engine|about`，页面重载后仍停留在原页签。首页控件用只读／`aria-disabled` 保留聚焦与提示，不提供创作能力。后续界面遵守 [UI 规范](../../docs/ui-guidelines.md)。

新增 shadcn 组件时，在 desktop 目录运行 `pnpm dlx shadcn@4.22.1 add <组件>`，先用 `--dry-run` 检查路径和依赖。当前 registry 会导入并安装 `cn` 包；本仓库复用 `@/lib/utils` 的 `cn`，生成后修正导入并移除多余依赖，颜色也须改为语义 token。

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

桌面产物进入 `app.asar`，engine 与生产依赖位于 `resources/engine`。仅部署目录使用 hoisted 依赖树，避免 Windows 目录链接指回仓库；仓库依赖仍为 isolated。NSIS 按用户安装，卸载保留 `%APPDATA%\Frame Loom`。窗口和 Windows 打包使用 `resources/icon.png` 的猫咪 logo，原图不进入 asar；renderer 使用独立的 256px 图片。当前不签名、不发布、不配置更新。

生产 fuse 关闭 Node 运行模式、环境选项和主进程调试，并启用仅从 asar 加载和完整性验证。Playwright 的 `_electron` 依赖主进程调试，因此冒烟测试使用未加固的 Electron 启动 `out/` 构建产物，不更改生产 fuse。先运行 `package:dir` 或 `package:win` 准备构建产物；测试使用独立临时数据目录，检查设置中心健康状态、hash 路由重载与 404 返回、页面隔离、主题切换与重启保持、引擎故障页签保留及正常退出，不需要下载 Playwright 浏览器。加固 exe 与真实安装／卸载的本地验证证据见[打包计划](../../.agents/plans/2026-10-24-app-skeleton/05-package.md)；本次外壳验证见[07 子计划](../../.agents/plans/2026-10-24-foundation/07-app-shell.md)。

`.github/workflows/build.yml` 在 Windows 上构建、测试并上传安装包，不执行发布。远端执行结果以 GitHub Actions 为准。

preload 提供固定的 `window.frameLoom.getEngineConnection()`、`theme.get/set` 和 `window.command` 方法。新增 IPC 复用可信主框架校验，主题和窗口命令由 contracts 的枚举校验；只有 `lib/desktop-bridge.ts` 访问桥接对象。连接包含本次启动的一次性令牌，调试时不要将它复制到日志或 URL。单测无需 Electron 运行时；e2e 额外覆盖损坏偏好回退、明暗切换、重启保持与退出命令，主题用例清除 Playwright 的默认明亮模式模拟。

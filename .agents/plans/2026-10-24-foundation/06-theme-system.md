# Plan: 主题系统与窗口标题栏

Status: done
Parent: plan.md
Note: ../../notes/proposed/feature/2026-10-24-theme-and-app-shell.md

## 目标

- `styles/theme.css` 按笔记的 token 表定义明暗两组取值，并通过 `@theme inline` 映射为 Tailwind 颜色。暗黑模式由 `prefers-color-scheme` 驱动，不使用 `.dark` class。
- 主进程在 `<userData>/preferences.json` 中持久化 `ThemeSource`，创建窗口前设置 `nativeTheme.themeSource` 和窗口背景色。新增 `theme:get`、`theme:set`、`window:command` 三个 IPC，都校验调用方和参数。
- 窗口使用 `titleBarStyle: 'hidden'` 与 `titleBarOverlay`，原生按钮颜色跟随主题。
- 完成 shadcn 初始化，lint 能拦截调色板颜色类和任意值颜色。
- logo 设为安装包和窗口图标。

## 前置条件

- 05 完成，`@/` 别名、`lib/desktop-bridge.ts` 和 jsdom 测试环境可用。
- 设计稿位于 `docs/design/home-ui-light.html` 与 `docs/design/home-ui-black.html`，logo 原图位于 `apps/desktop/resources/icon.png`。

## 步骤

- [x] T1 在 `packages/contracts` 新增 `ThemeSource` 与 `WindowCommand` 两个 zod 枚举并导出 — 验证：contracts 测试覆盖合法值和非法值
- [x] T2 新增主进程模块 `src/main/preferences.ts`：同步读取并校验 `preferences.json`，文件缺失、损坏或校验失败时回退为 `system`；写入时先写临时文件再重命名 — 验证：单测覆盖缺失、损坏、非法值、写入后重新读取
- [x] T3 `src/main/index.ts` 在创建窗口前读取偏好并设置 `nativeTheme.themeSource`，按 `shouldUseDarkColors` 选择 `backgroundColor`；设置 `titleBarStyle: 'hidden'` 与 `titleBarOverlay: { color, symbolColor, height: 42 }`，在 `nativeTheme` 的 `updated` 事件中调用 `setTitleBarOverlay`；开发模式下设置 `icon` — 验证：`pnpm dev` 中原生按钮颜色与主题一致；Windows 切换系统主题后，「跟随系统」模式的按钮同步变化
- [x] T4 新增 `theme:get`、`theme:set`、`window:command` 三个 IPC，都先经过 `isTrustedSender`，参数用 contracts 的 schema 校验；`quit` 调用 `app.quit()`；preload 暴露 `frameLoom.theme.get/set` 与 `frameLoom.window.command`，`desktop-bridge.ts` 同步补充类型 — 验证：单测覆盖不可信调用方、非法参数、合法调用
- [x] T5 以精确版本安装笔记版本表中的 UI 依赖，编写 `components.json`（别名指向 `@/components`、`@/lib/utils`，CSS 指向 `src/renderer/src/styles/globals.css`）；运行 `pnpm dlx shadcn@4.22.1 add dialog tabs toggle-group button menubar tooltip`，CLI 失败时按官方手动安装文档复制组件源码 — 验证：组件位于 `components/ui/`，`pnpm --filter @frame-loom/desktop typecheck` 通过
- [x] T6 编写 `styles/theme.css`（`:root` 为明亮取值，`@media (prefers-color-scheme: dark)` 为暗黑取值）和 `styles/globals.css`（导入 tailwindcss、tw-animate-css、theme.css；删除 shadcn 生成的 `@custom-variant dark`；设置字体、13px 基础字号、滚动条）；`lib/utils.ts` 导出 `cn` — 验证：开发者工具中模拟 `prefers-color-scheme` 时，明暗 token 正确切换
- [x] T7 主进程新增 `TITLE_BAR_COLORS` 常量，单测解析 `theme.css`，断言其中的 `background` 与 `muted-foreground` 明暗值与常量一致 — 验证：修改任意一侧的颜色时测试失败
- [x] T8 ESLint 加入 `eslint-plugin-better-tailwindcss` 的 correctness 规则，用 `no-restricted-classes` 禁止调色板颜色类与任意值颜色，并设置入口 CSS；Prettier 加入 `prettier-plugin-tailwindcss`，`tailwindStylesheet` 指向 `globals.css`，对 renderer 执行一次格式化 — 验证：临时文件中写 `bg-zinc-800`、`text-[#333]` 和未知类时 `pnpm lint` 报错，删除临时文件后通过
- [x] T9 生产 CSP 的 `style-src` 改为 `'self' 'unsafe-inline'`，开发 CSP 保持现状 — 验证：`src/main/security.test.ts` 或协议测试断言新的 CSP 字符串，`script-src` 仍为 `'self'`
- [x] T10 由 `resources/icon.png` 生成 256×256 的 `src/renderer/src/assets/logo.png`；`electron-builder.yml` 设置 `win.icon: resources/icon.png` — 验证：`package:dir` 产物 exe 显示新图标；asar 中不包含 `resources/`
- [x] T11 提交 `feat(desktop): 新增主题系统与自定义标题栏`，带 `Note:` 与 `Plan:` 尾注 — 验证：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm run verify` 通过

## 验证

- 预期：偏好损坏时应用照常启动；IPC 拒绝不可信调用方和非法参数；token 一致性测试与 lint 反例生效；首帧背景与主题一致；原生按钮颜色跟随主题；exe 图标为新 logo。
- 质量门禁：`pnpm lint`、`pnpm typecheck`、`pnpm format:check`、`pnpm install --frozen-lockfile` 与 `pnpm run verify` 通过。`pnpm test` 共 221 项通过（contracts 68、engine 80、desktop 73）。主进程颜色常量与 CSS 明暗 token 的一致性测试通过；偏好覆盖缺失、JSON 损坏、版本／主题非法、覆盖写入、重读与替换失败；IPC 覆盖不可信来源、非法参数、合法主题、写入失败和全部窗口命令。
- 颜色门禁：`.cache/verify-theme-lint.mjs` 的 8 项类名反例、2 项内联颜色反例均触发预期规则，语义 token 与尺寸任意值正例通过。真实临时 `.tsx` 中的 `bg-zinc-800`、`text-[#333]`、未知类使 `pnpm lint` 报三条对应错误；删除探针后全仓 lint 与格式检查通过。
- UI 基础：shadcn 4.22.1 生成 7 份组件源码（含 ToggleGroup 必需的 Toggle），手动适配本地 `cn` 与补充颜色 token。根 tsconfig 别名修正后 `add button --dry-run` 指向正确源码路径；上游 registry 的 `cn` 依赖仍需在后续生成时人工替换，README 已说明。
- 打包：`pnpm --filter @frame-loom/desktop package:dir --config.electronDist=E:/Workspace/project/personal_project/frame-loom/apps/desktop/node_modules/electron/dist` 通过，复用本地 Electron 45.0.0，生产 fuse 未改。exe 提取的图标是新 logo，原生截图已查看；asar 只有 `out/` 与 `package.json`，没有 `resources/`。
- e2e：`pnpm --filter @frame-loom/desktop test:e2e` 2 项通过，保留健康状态、hash 路由、隔离和退出检查；新增损坏偏好回退、即时切换、窗口背景同步、非法主题拒绝、重启保持、系统模式与退出 IPC。主题用例清除 Playwright 默认明亮模拟，测试实际媒体查询。
- 实机：`.cache/verify-theme-runtime.mjs dev` 和 `packaged` 通过，开发由根 `pnpm dev` 启动，加固 exe 直接启动。两者均验证损坏回退、明暗切换、重启保持、无页面错误／CSP 违规和正常退出；加固 exe 另验证真实 Windows 应用主题切换，跟随系统的 renderer 与原生按钮同步，结束后恢复系统设置。`.cache/06-theme-{dev,packaged}-*.png` 为原生窗口截图，明暗与系统切换截图已核对；`.cache/06-exe-icon.png` 为 exe 图标证据。

## 进度

- 2026-10-24：创建子计划草稿。
- 2026-10-24：用户授权执行 06，05 已完成；按既有提案实施主题、窗口 IPC、组件基础设施和图标，07 保持 draft。
- 2026-10-24：T1～T11 完成，221 项单测、2 项桌面 e2e、质量门禁、颜色反例、开发窗口和真实加固 exe 的主题／图标检查通过；随实现同步笔记、README 和父计划并独立提交。

## 发现与偏差

- shadcn CLI 未解析 renderer 专用 tsconfig 的别名，初次生成在错误物理目录；迁移源码并在根 tsconfig 补工具别名，dry-run 验证路径。当前上游源码还导入独立 `cn` 包，按提案复用本地工具并移除该包；UI 包保留 desktop 开发依赖，两个 lint／格式插件放在根配置所在包。
- Tailwind lint 必须指定 desktop 为解析 `cwd`，否则根目录没有 Tailwind，插件会警告并停用规则；现已配置，并通过反例确认生效。旧健康页样式暂时保留布局，所有硬编码颜色改 token 并放在 components 层；头部保留拖动区域，避免隐藏系统标题栏后无法移动窗口，07 再替换为完整外壳。
- 首轮同时运行打包和全仓单测时，原有 engine 无配置启动测试超过五秒；停止并行打包后原命令通过，没有改测试阈值。Playwright 默认模拟明亮模式会掩盖 Electron 主题变化，用例已显式清除模拟。
- Computer Use 缺少 `@oai/sky` 运行模块，实机使用 CDP 与 Win32 原生窗口截图核对；截图处理 DPI 缩放。测试加固 exe 以正常可见窗口启动，避免测试启动参数隐藏应用。未重做 NSIS 安装／卸载、Dialog 打开时的 CSP 或远端 CI，设置中心验收留给 07。
- 共享主题笔记仍包含 07 外壳与设置中心的验收，本次同步其已实现事实并保留 proposed，依父计划在 07 整体验收后流转；未提前标记整个提案完成。

## 交接

无。

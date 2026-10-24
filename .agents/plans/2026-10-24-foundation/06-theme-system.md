# Plan: 主题系统与窗口标题栏

Status: draft
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

- [ ] T1 在 `packages/contracts` 新增 `ThemeSource` 与 `WindowCommand` 两个 zod 枚举并导出 — 验证：contracts 测试覆盖合法值和非法值
- [ ] T2 新增主进程模块 `src/main/preferences.ts`：同步读取并校验 `preferences.json`，文件缺失、损坏或校验失败时回退为 `system`；写入时先写临时文件再重命名 — 验证：单测覆盖缺失、损坏、非法值、写入后重新读取
- [ ] T3 `src/main/index.ts` 在创建窗口前读取偏好并设置 `nativeTheme.themeSource`，按 `shouldUseDarkColors` 选择 `backgroundColor`；设置 `titleBarStyle: 'hidden'` 与 `titleBarOverlay: { color, symbolColor, height: 42 }`，在 `nativeTheme` 的 `updated` 事件中调用 `setTitleBarOverlay`；开发模式下设置 `icon` — 验证：`pnpm dev` 中原生按钮颜色与主题一致；Windows 切换系统主题后，「跟随系统」模式的按钮同步变化
- [ ] T4 新增 `theme:get`、`theme:set`、`window:command` 三个 IPC，都先经过 `isTrustedSender`，参数用 contracts 的 schema 校验；`quit` 调用 `app.quit()`；preload 暴露 `frameLoom.theme.get/set` 与 `frameLoom.window.command`，`desktop-bridge.ts` 同步补充类型 — 验证：单测覆盖不可信调用方、非法参数、合法调用
- [ ] T5 以精确版本安装笔记版本表中的 UI 依赖，编写 `components.json`（别名指向 `@/components`、`@/lib/utils`，CSS 指向 `src/renderer/src/styles/globals.css`）；运行 `pnpm dlx shadcn@4.22.1 add dialog tabs toggle-group button menubar tooltip`，CLI 失败时按官方手动安装文档复制组件源码 — 验证：组件位于 `components/ui/`，`pnpm --filter @frame-loom/desktop typecheck` 通过
- [ ] T6 编写 `styles/theme.css`（`:root` 为明亮取值，`@media (prefers-color-scheme: dark)` 为暗黑取值）和 `styles/globals.css`（导入 tailwindcss、tw-animate-css、theme.css；删除 shadcn 生成的 `@custom-variant dark`；设置字体、13px 基础字号、滚动条）；`lib/utils.ts` 导出 `cn` — 验证：开发者工具中模拟 `prefers-color-scheme` 时，明暗 token 正确切换
- [ ] T7 主进程新增 `TITLE_BAR_COLORS` 常量，单测解析 `theme.css`，断言其中的 `background` 与 `muted-foreground` 明暗值与常量一致 — 验证：修改任意一侧的颜色时测试失败
- [ ] T8 ESLint 加入 `eslint-plugin-better-tailwindcss` 的 correctness 规则，用 `no-restricted-classes` 禁止调色板颜色类与任意值颜色，并设置入口 CSS；Prettier 加入 `prettier-plugin-tailwindcss`，`tailwindStylesheet` 指向 `globals.css`，对 renderer 执行一次格式化 — 验证：临时文件中写 `bg-zinc-800`、`text-[#333]` 和未知类时 `pnpm lint` 报错，删除临时文件后通过
- [ ] T9 生产 CSP 的 `style-src` 改为 `'self' 'unsafe-inline'`，开发 CSP 保持现状 — 验证：`src/main/security.test.ts` 或协议测试断言新的 CSP 字符串，`script-src` 仍为 `'self'`
- [ ] T10 由 `resources/icon.png` 生成 256×256 的 `src/renderer/src/assets/logo.png`；`electron-builder.yml` 设置 `win.icon: resources/icon.png` — 验证：`package:dir` 产物 exe 显示新图标；asar 中不包含 `resources/`
- [ ] T11 提交 `feat(desktop): 新增主题系统与自定义标题栏`，带 `Note:` 与 `Plan:` 尾注 — 验证：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm run verify` 通过

## 验证

- 预期：偏好损坏时应用照常启动；IPC 拒绝不可信调用方和非法参数；token 一致性测试与 lint 反例生效；首帧背景与主题一致；原生按钮颜色跟随主题；exe 图标为新 logo。
- 实际：未执行。

## 进度

- 2026-10-24：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始，等待 05 完成。

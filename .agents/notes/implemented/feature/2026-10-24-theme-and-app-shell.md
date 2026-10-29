# Agent Note: 主题系统与应用外壳

Status: implemented

## Problem

引入前 renderer 只有一个健康状态页，颜色直接写在 `styles.css` 里，只有一套暗色，窗口使用系统默认标题栏。用户提供了主界面的明亮与暗黑两份设计稿，以及项目 logo，要求：

- 按设计稿实现自定义窗口标题栏、左侧栏和主画布。
- 左栏底部的「设置中心」点击后打开弹窗，主题设置和现有的 engine 健康检查都放在弹窗里。
- 建立主题系统，后续所有业务界面都必须使用它，不能各自写颜色。
- logo 使用用户提供的图片。

两份设计稿的 HTML 结构完全相同（逐行比对 `<body>` 部分，只有一行注释不同），差别只在 CSS 变量和少数直接写在选择器里的颜色。所以一套语义 token 加明暗两组取值，就能覆盖两种模式。

约束：

- 主题必须在第一帧就正确，不能先闪一下另一种颜色。窗口背景色、Windows 标题栏上的原生窗口按钮、原生右键菜单和滚动条都要跟着主题变。
- 原生产 CSP 是 `style-src 'self'`。设置中心弹窗需要一个成熟的 Dialog 组件，常用的 Radix Dialog 会动态插入 `<style>` 标签。
- 不改变 engine 的启动和鉴权方式。preload 新增的接口必须和现有 `engine:connection` 一样校验调用方。

## Decision

### 技术选择

- 样式继续用 Tailwind CSS 4。组件用 shadcn/ui：组件源码由 CLI 生成到工作区包 `packages/ui/src/components/`（最初在 desktop 的 `components/ui/`，画布需要复用时迁出），底层是 Radix（`radix-ui` 包），配套 `class-variance-authority`、`clsx`、`tailwind-merge`、`tw-animate-css`。图标用 `lucide-react`。设计稿的图标是 Feather 风格，lucide 从 Feather 分叉而来，图形一致。
- 主题偏好由主进程保存，并设置 Electron 的 `nativeTheme.themeSource`。按 [nativeTheme 文档](https://www.electronjs.org/docs/latest/api/native-theme)，设置之后 renderer 的 CSS 媒体查询 `prefers-color-scheme` 会跟着变，Windows 上的原生菜单和开发者工具也会切换明暗。renderer 只需要用这个媒体查询，不必用 JS 给页面加 `.dark` class。
- Tailwind 4 的 `dark:` 变体默认就基于 `prefers-color-scheme`，和这套机制一致。shadcn CLI 生成的 `globals.css` 里有 `@custom-variant dark (&:is(.dark *))`，必须删掉，不能保留基于 class 的切换。

### 主题 token

`styles/theme.css` 是颜色的唯一来源：`:root` 写明亮取值，`@media (prefers-color-scheme: dark) { :root { … } }` 写暗黑取值，再用 `@theme inline` 映射成 Tailwind 颜色。命名优先沿用 shadcn 的标准名，这样生成的组件不用改就能用上主题；设计稿里有、shadcn 没有的，才补自定义名。

| token | 明亮 | 暗黑 | 设计稿变量 | 用途 |
| --- | --- | --- | --- | --- |
| `background` | `#f6f7f9` | `#0d0d0f` | `--bg-app` | 窗口底层、标题栏、侧栏 |
| `canvas` | `#ffffff` | `#141416` | `--bg-main` | 主画布 |
| `card`、`popover` | `#ffffff` | `#1c1c1f` | `--bg-input` | 输入框、弹窗、下拉菜单 |
| `muted` | `#f7f7f8` | `#161618` | `--bg-input-bottom` | 次级底座 |
| `foreground` | `#1a1a1a` | `#e4e4e7` | `--text-primary` | 正文 |
| `foreground-strong` | `#1a1a1a` | `#ffffff` | `--text-white` | 首页大标题、logo 选框 |
| `muted-foreground` | `#8c8c8c` | `#a1a1aa` | `--text-secondary` | 次要文字、图标 |
| `placeholder` | `#b3b3b3` | `#52525b` | `--text-tertiary` | 占位文字 |
| `border` | `#eaeaea` | `#2d2d31` | `--border-color` | 分隔线、卡片边框 |
| `border-strong` | `#d1d5db` | `#3f3f46` | `--border-light` | 聚焦边框、滚动条 |
| `accent` | `#eef0f3` | `#27272a` | `--hover-bg` | 悬停 |
| `accent-active` | `#e4e6e9` | `#323236` | `--active-bg` | 选中导航 |
| `primary` / `primary-foreground` | `#333333` / `#ffffff` | `#ffffff` / `#000000` | 发送按钮 | 主操作按钮 |
| `brand` | `#1c64f2` | `#3b82f6` | `--blue-accent` | 强调图标、焦点环 |
| `dot` | `#e5e7eb` | `rgb(255 255 255 / 0.08)` | 点阵背景 | 主画布 24px 点阵 |

- 设计稿没有、但 shadcn 组件需要的 token 由本篇补齐，并标注为补充值：`ring` 指向 `brand`，保证键盘焦点清晰可见；`destructive` 明亮用 `#dc2626`、暗黑用 `#ef4444`，`destructive-foreground` 固定为 `#ffffff`；`secondary` 指向 `accent`；Dialog 遮罩的 `overlay` 固定为 `#000000`，由透明度控制遮罩强度，替代组件默认的 `bg-black/50`。
- 阴影 token 有 `shadow-panel` 和 `shadow-panel-focus` 两个，取设计稿里输入框的两组阴影，明暗各一组。
- 圆角直接用 Tailwind 默认刻度，正好和设计稿一致：`rounded-md` 6px、`rounded-lg` 8px、`rounded-2xl` 16px、`rounded-full` 胶囊。`--radius` 设为 `0.5rem` 供 shadcn 组件使用。
- 字体：
  - `--font-sans` 用设计稿的系统字体栈，补上 `"Microsoft YaHei UI"` 和 `"PingFang SC"` 作中文后备。
  - `--font-serif` 用设计稿的 `Georgia, Cambria, "Times New Roman"`，补上 `"Songti SC"` 和 `"SimSun"`。补宋体的原因是 Georgia 没有中文字形，首页标题「帧织」实际显示的是后备字体。
  - 字号补两个：`--text-ui`（13px，设计稿正文字号）和 `--text-display`（34px，首页标题）。
- 暗黑模式滚动条用 `border-strong` 和 `placeholder`，对应设计稿的 `#3f3f46` 和 `#52525b`。明亮稿没有定义滚动条，用同名 token 的明亮取值。

### 主题模式与持久化

- `packages/contracts` 新增 `ThemeSource = z.enum(['system', 'light', 'dark'])`，默认 `system`。
- 主进程在 `<userData>/preferences.json` 保存 `version: 1`、`theme` 及可选的项目保存位置、排序、资产布局；主题与项目偏好共享读取、合并、原子替换流程，避免互相覆盖。项目字段与桥接见[项目库方案](../../implemented/feature/2026-10-26-project-library.md)：
  - 启动时、创建窗口之前同步读取。文件不存在、JSON 损坏或校验失败时使用默认值，不阻止启动。
  - 写入时先写临时文件再重命名。
  - 读取后立即设置 `nativeTheme.themeSource`，再根据 `nativeTheme.shouldUseDarkColors` 选窗口 `backgroundColor`：明亮 `#f6f7f9`，暗黑 `#0d0d0f`。这样窗口第一帧就和页面一致。
- IPC 新增 `theme:get` 和 `theme:set`：
  - 都必须通过 `isTrustedSender` 校验调用方；`theme:set` 的参数先经 `ThemeSource.parse` 校验。
  - 设置成功后依次写文件、更新 `themeSource`、更新标题栏原生按钮颜色。
- preload 新增 `frameLoom.theme.get()` 和 `frameLoom.theme.set(source)`。renderer 中只有 `lib/desktop-bridge.ts` 可以访问 `window.frameLoom`。
- `nativeTheme` 的 `updated` 事件触发时，主进程更新标题栏原生按钮颜色，这样「跟随系统」模式下切换系统主题也能同步。
- 主进程只复制两个颜色：原生按钮底色（等于 `background`）和图标色（等于 `muted-foreground`）。单测解析 `theme.css`，断言这两个值与 CSS 一致，防止两边不同步。

### 窗口标题栏

自绘窗口按钮由[自定义标题栏窗口按钮](2026-10-24-custom-window-controls.md)承接；本篇保留原生按钮选型的依据，主题持久化与媒体查询机制仍成立。

- `BrowserWindow` 设置 `titleBarStyle: 'hidden'` 和 `titleBarOverlay: { color, symbolColor, height: 42 }`。最小化、最大化、关闭三个按钮使用 Windows 原生按钮，颜色跟随主题。做法见 [Electron 自定义标题栏教程](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)。
- renderer 绘制 42px 高的标题栏：
  - 整条标题栏设 `app-region: drag`，可以拖动窗口；按钮、菜单等可交互元素设 `no-drag`。
  - 内容宽度用 `env(titlebar-area-width)` 限制，不压到原生按钮上。
  - 左侧依次是「Frame Loom」文字和菜单栏（文件、窗口、帮助）。
- 菜单栏用 shadcn `Menubar`，颜色走主题。菜单项只放已经能用的操作：
  - 文件：退出。
  - 窗口：最小化、最大化或还原、全屏。
  - 帮助：关于 Frame Loom，打开设置中心的「关于」页。
- 窗口操作通过新增的 `window:command` IPC 执行：
  - 参数用 zod 枚举 `minimize | toggle-maximize | toggle-fullscreen | quit` 校验，同样校验调用方。
  - `quit` 调用 `app.quit()`，走现有的 engine 关闭流程。
  - preload 对应新增 `frameLoom.window.command(name)`。

### 应用外壳与页面

- `app/shell/` 组合标题栏、侧栏、主画布和设置中心弹窗。它属于 app 层，可以同时引用多个 feature。
- 侧栏宽 260px，背景透明（显示 `background`）。从上到下：
  - 品牌区：20px 圆角 logo 加衬线体「Frame Loom」；右侧有折叠和搜索两个按钮。折叠用组件内状态实现，不持久化；搜索按钮暂时禁用。
  - 导航：「开始创作」（`/`）和「项目库」（`/projects`）。旧画布测试页已删除，图片／视频生成由项目画布节点承接；文本与 TTS 接口保留，迁移边界见[模型管理](../../proposed/architecture/2026-10-24-model-management.md)。
  - 「项目」分组标题：右侧的新建按钮打开项目对话框；项目树按剧集组织剧本和创作页，未分集页面单独分组。
  - 底部的「设置中心」按钮。
- 主画布背景为 `canvas` 加 24px 的 `dot` 点阵。左上角 16px 圆角，上边和左边有 `border` 描边，主内容区单独滚动。
- 首页（`/`）：
  - hero：设计稿 logo 选框的四角控制点保留，选框里换成用户提供的 logo，旁边是「帧织」标题和副标题。
  - 输入区：外观按设计稿实现，但文本框、模型、技能、版本、发送、选择项目全部禁用，并用提示说明「创作功能尚未开放」。
  - 公告胶囊「首版发布」在有发布说明之前不显示。
- 未开放的按钮使用 `aria-disabled` 并阻止操作，文本框为只读；保留键盘焦点，用 Tooltip 和常驻 `aria-describedby` 提供提示，避免原生 `disabled` 导致提示无法被键盘访问。版本选择只标为「版本」，不宣称存在设计稿的 V3；输入提示移除尚不存在的 Design 使用指南。
- 项目库（`/projects`）显示项目卡片、搜索、排序和项目操作；详情页承载剧集、创作页、设定库与项目资产。`/projects/$projectId/pages/$pageId` 画布页与 `/projects/$projectId/episodes/$episodeId` 剧本页都使用 `fullBleed` 铺满主区，规格见[剧集与结构化剧本](2026-10-29-episodes-and-structured-scripts.md)。
- 健康查询在外壳挂载时执行一次。查询失败时，设置中心按钮上显示一个 `destructive` 圆点，否则 engine 出错用户无从得知。
- 健康结果在外壳和设置面板间共享，`staleTime: Infinity`、`retryOnMount: false` 避免打开页签重复查询或自动重试；重新检查按钮显式刷新，主进程以 `engine:exited` 通知退出，页面保留当前编辑内容。

### 设置中心弹窗

设置入口与窗口布局由[设置快捷面板与分栏模态窗口](2026-10-24-settings-quick-panel.md)承接；本篇保留原始交互选择及主题、窗口机制的依据。

- 使用 shadcn `Dialog` 加竖向 `Tabs`，共四个页签：
  - **外观**：用 `ToggleGroup` 选择跟随系统、明亮、暗黑，切换后立即生效。
  - **本地引擎**：显示连接状态、engine 版本、schema 版本、启动时间和「重新检查」按钮，内容来自 `features/engine-status`。
  - **模型服务**：渠道列表、渠道详情与独立模型编辑弹窗（读取草稿后勾选、显式选协议、四类能力卡、请求预览与测试），内容来自 `features/model-services`；读响应不含明文密钥和附加请求头值。见[模型服务配置层重构](../architecture/2026-10-28-model-service-rebuild.md)。
  - **默认模型**：每个类别选择一个已启用模型，内容来自 `features/model-services/model-defaults.tsx`。
  - **关于**：显示 logo、应用名和版本号。版本号由 Vite `define` 在构建时从 `apps/desktop/package.json` 注入。
- 弹窗开关和当前页签写在根路由的 search 参数里：`settings?: 'appearance' | 'engine' | 'models' | 'defaults' | 'storage' | 'about'`，由 zod 校验。engine 退出时页面不重载，弹窗保持打开并停在同一个页签上显示错误；手动重载时 hash 同样保留弹窗与页签。
- 非法 search 值回退为关闭；打开、切页和关闭保留当前路径。Dialog 关闭后焦点恢复到侧栏设置入口。外观读写使用 Query 与 mutation，读取失败可重试，写入失败保留原选择并显示中文错误；保存期间禁用切换，避免并发覆盖。

### logo 资源

- 原图放 `apps/desktop/resources/icon.png`（1024×1024 PNG，750,524 字节）。这张图同时用于：
  - electron-builder 的 `win.icon`，作为安装包和 exe 图标；
  - 开发模式下 `BrowserWindow` 的 `icon`。打包后 exe 自带图标，不需要设置。
- renderer 使用由原图缩成 256×256 的 `src/renderer/src/assets/logo.png`，不加载 1024 原图。
- `resources/` 不在 electron-builder 的 `files` 里，不会进入 asar。

### CSP

- 生产 CSP 的 `style-src` 为 `'self' 'unsafe-inline'`，`img-src` 与 `media-src` 允许 `frame-media:`、`frame-project:`，其余指令不变，`script-src` 仍是 `'self'`。项目协议只代理 engine 的项目文件接口，携带主进程令牌，限制 CORS 源；开发 CSP 同步允许该协议。
- 原因：Radix Dialog 的滚动锁依赖 `react-remove-scroll`，它通过 `react-style-singleton` 动态插入 `<style>`，`style-src 'self'` 会拦截它。用 nonce 的话，需要在协议处理函数里改写 `index.html` 注入 nonce，并在 renderer 调用 `get-nonce` 的 `setNonce`，改动落在安全相关代码里。
- 内联样式只能改变外观，不能执行脚本；React 会转义文本，页面中也没有拼接 HTML 的地方。

### 后续界面的约束

- 颜色只能用语义 token 类，例如 `bg-canvas`、`text-muted-foreground`。不能用 Tailwind 调色板类（`bg-zinc-800`），不能用任意值颜色（`text-[#333]`），也不能在 `style` 属性里写颜色。
- 用 `eslint-plugin-better-tailwindcss` 自动检查：
  - 只启用 correctness 规则：`no-unknown-classes`、`no-conflicting-classes`、`no-deprecated-classes`、`no-duplicate-classes`。
  - 用 `no-restricted-classes` 拦截调色板颜色类和任意值颜色。
  - 类名排序交给 Prettier 官方的 `prettier-plugin-tailwindcss`，ESLint 不启用排序和换行规则，避免两者冲突。
- 新组件优先用 shadcn CLI 添加到 `packages/ui/src/components/`，图标只用 lucide。
- 每个新界面都必须在明亮和暗黑两种模式下检查一遍。
- 这些规则写进 `docs/ui-guidelines.md`，`AGENTS.md` 加一条指向它，后续的 AI 会话也能读到。

### 设计稿入库

- 两份设计稿原样放在 `docs/design/home-ui-light.html` 和 `docs/design/home-ui-black.html`，作为 2026-10-24 的参考快照，入库后不再修改。
- `docs/design/README.md` 说明三点：
  - 颜色以 `styles/theme.css` 为准；
  - 已知偏差见本篇；
  - 新设计稿使用新文件名入库。
- 入库的理由：
  - 实施计划跨多次提交和会话，后续会话需要读取设计稿的原始尺寸、间距和颜色，而用户的下载目录不在仓库里。
  - 两个文件共约 50 KB，都是纯文本，可以做 diff。
  - `docs/` 已在 Prettier 忽略列表中，ESLint 也不检查 HTML，入库不会触发格式化。

### 与设计稿的已知偏差

| 位置 | 设计稿 | 实现 | 原因 |
| --- | --- | --- | --- |
| 窗口按钮 | 12px 自绘图标，间距 16px | Windows 原生按钮，颜色跟随主题 | 保留 Windows 11 的贴靠布局、双击最大化和无障碍支持 |
| logo | CSS 拼出的紫色小怪兽 | 用户提供的猫咪图片，hero 保留四角选框 | 用户指定 |
| 侧栏品牌图标 | 「M」字 SVG，暗黑模式反色 | 圆角 logo 图片，不反色 | 用户指定 logo |
| 公告胶囊 | 「首版发布 >」 | 暂不显示 | 还没有可链接的发布说明 |
| 输入区控件 | 可交互 | 禁用并提示尚未开放 | 创作功能还没有实现 |
| 版本与使用指南 | V3 新版、Design 使用指南 | 仅显示「版本」，移除指南占位 | 不展示不存在的版本或入口 |
| 中文衬线字体 | 未指定 | 补充宋体后备 | Georgia 没有中文字形 |

### 待确认

- 明亮模式的 `muted-foreground`（`#8c8c8c`）在 `background` 上的对比度是 3.14:1，在悬停底色上是 2.95:1，低于 WCAG AA 对 13px 文字要求的 4.5:1。暗黑模式是 7.58:1，没有问题。可选做法：
  - 照设计稿保留原值；
  - 改为 `#6b6b6b`，在 `background` 上约 5:1，在悬停底色上 4.67:1。
  需要设计方决定。在决定之前，本篇按设计稿原值实施。

### 版本

2026-10-24 查询 npm registry 的最新版本，作为精确锁定的起点，实际以锁文件为准：

| 包 | 版本 | 兼容性 |
| --- | --- | --- |
| shadcn | 4.22.1 | 只通过 `pnpm dlx shadcn@4.22.1` 运行，不加入依赖 |
| radix-ui | 1.8.1 | peer 支持 React 19 |
| class-variance-authority | 0.7.1 | |
| clsx | 2.1.1 | |
| tailwind-merge | 3.7.0 | |
| tw-animate-css | 1.4.0 | |
| lucide-react | 1.61.0 | |
| eslint-plugin-better-tailwindcss | 4.10.0 | peer 要求 ESLint 10、tailwindcss `^4.1.17` |
| prettier-plugin-tailwindcss | 0.8.1 | peer 要求 prettier `^3` |

UI 包都放在 desktop 的 `devDependencies`，由 electron-vite 打进产物，`dependencies` 继续为空。ESLint 与 Prettier 插件由仓库根配置消费，放在根 `devDependencies`；Tailwind 插件显式以 desktop 为 `cwd`，指定 CSS 入口、web tsconfig 并启用现有 CSS 类检测，避免在根目录找不到 Tailwind 而静默关闭规则。

### 主题基础设施的实现与验证

- 主题 token、`nativeTheme` 首帧设置、`preferences.json` 原子替换、三个可信 IPC、preload 和 renderer 桥接、隐藏标题栏与 42px 原生按钮区已落地。偏好写入失败不改变当前主题，IPC 返回错误；偏好损坏回退 `system`。`nativeTheme.updated` 同时更新窗口背景与原生按钮颜色。
- shadcn 4.22.1 已生成 Dialog、Tabs、ToggleGroup、Button、Menubar、Tooltip，以及 ToggleGroup 依赖的 Toggle。CLI 在根 tsconfig 只有 references 时把文件写入了 `@/components/ui` 物理目录；源码已迁到 `src/renderer/src/components/ui`，根 tsconfig 补充工具使用的 `@/*` 映射，dry-run 确认后续路径正确。当前上游 registry 组件另外导入并安装 `cn` 包；本仓库按既定方案改为 `@/lib/utils` 并移除该依赖，后续新增组件仍需检查这一点。node／web 继续分别类型检查，不给 renderer 加入 Node 全局。
- 生成组件的硬编码黑白改为补充语义 token，关闭按钮文案为中文。Fast Refresh 只为 Button、Toggle、Tabs 放行其命名变体导出。完整 42px 标题栏由 `app/shell/title-bar.tsx` 提供，菜单区 no-drag；旧健康页和 `styles.css` 已删除，所有界面复用主题 token。
- 颜色检查覆盖调色板、十六进制／函数／命名／CSS 变量任意值、任意属性颜色及直接 JSX 内联颜色。尺寸任意值与语义 token 正例通过；8 项类名反例、2 项内联反例通过，临时探针删除后全仓 lint 通过。CSS 文件中的取色仍需评审，ESLint 不检查 CSS。
- `pnpm test` 221 项通过（contracts 68、engine 80、desktop 73）；类型检查、格式检查、冻结安装及笔记／计划校验通过。第一次把打包和全仓单测同时运行时，原有 engine 冷启动测试超过五秒；停止并行打包后原命令通过，未扩大测试超时。
- 桌面 e2e 2 项通过，覆盖损坏偏好、主题切换、窗口背景、非法输入、重启保持和退出命令。Playwright 默认模拟明亮模式，主题用例通过 `page.emulateMedia({ colorScheme: null })` 清除模拟，测试 Electron 实际驱动的媒体查询。
- `package:dir` 复用本机同版本 Electron 45.0.0，通过生产 fuse 打包。开发模式和真实加固 exe 均完成即时切换、损坏回退、重启保持与正常退出检查，无页面错误或 CSP 违规；真实 Windows 应用主题切换后，跟随系统的页面和原生按钮同步变化，测试结束已恢复系统设置。`.cache/06-theme-{dev,packaged}-*.png` 是原生窗口截图，已核对明暗按钮；exe 提取图标是新 logo，asar 无 `resources/`，仅含 `out/` 与 `package.json`。
- Computer Use 运行模块 `@oai/sky` 不可用，窗口通过 CDP 和 Win32 截图核对。完整外壳、Dialog CSP 与窗口操作已在真实加固 exe 验证；本轮不重复 NSIS 安装／卸载，不将自动化检查描述为人工点击。

## Alternatives considered

- **renderer 用 localStorage 保存主题，或使用 next-themes**：只改 renderer，不新增 IPC。next-themes 是 shadcn 文档推荐的主题库，生态成熟。不选的原因：
  - 主进程在创建窗口时不知道主题，第一帧背景色会错，标题栏原生按钮颜色也会错。
  - 原生菜单和滚动条跟随的是 `nativeTheme`，不跟随页面上的 class。
  - 开发模式的源是 `http://127.0.0.1:<port>`，生产是 `app://frame-loom`，localStorage 是两份，开发和生产的主题不一致。
- **主题偏好存在 engine 的 SQLite**：所有设置集中在一处，以后的 API Key 等设置也会放在 engine。不选的原因是 engine 异步启动，最多等 30 秒，窗口不能等 engine 就绪后才决定颜色。主题属于窗口级设置，由主进程管理。
- **用 electron-store 保存偏好**：成熟的 Electron 偏好存储库，自带 schema 校验和原子写入。现在只有一个字段，zod 校验加临时文件重命名大约 20 行。偏好项变多、需要迁移或监听时再引入。
- **`frame: false` 加自绘窗口按钮**：能和设计稿像素级一致。代价是失去 Windows 11 悬停最大化按钮时的贴靠布局，还要自己同步最大化状态、处理双击标题栏。原生按钮已经能按主题设置颜色和高度，差别只在图标形状。
- **原生菜单弹出（`Menu.popup`）代替 HTML 菜单栏**：菜单项和快捷键原生实现，Windows 上会跟随 `nativeTheme` 变暗。但原生菜单的字体、间距、圆角和设计稿不一致；HTML 菜单栏用 shadcn 组件就能和弹窗、下拉菜单保持同一套主题。
- **CSP 使用 nonce，保持 `style-src 'self'`**：CSP 更严格。需要在协议处理函数中改写 HTML 注入 nonce，并在 renderer 中调用 `setNonce`，开发模式由 Vite 提供页面，还得另写一套。内联样式的风险是改变外观，`script-src` 不受影响，所以接受放开 style。
- **不用 Radix，自己写 Dialog（原生 `<dialog>`）**：没有动态样式注入，CSP 不用改。但焦点管理、Esc 关闭、页面滚动锁定和读屏语义都要自己实现，以后还要做下拉菜单、Tabs、Tooltip，用户也要求优先使用成熟三方库。
- **设计稿不入库，只在笔记中摘录 token**：仓库更干净，不会有过期的参考文件。但间距、尺寸、阴影和结构细节无法全部摘录，后续会话找不到原始文件。设计稿作为不再修改的快照入库，以 `theme.css` 为准。
- **主题切换用 `.dark` class（shadcn 默认）**：和 shadcn 文档、生成的组件完全一致。但需要 JS 在首帧之前加 class，还要和 `nativeTheme` 双向同步。用 `prefers-color-scheme` 由 Electron 驱动，不需要 JS。shadcn 组件里的 `dark:` 写法在 Tailwind 4 默认就是媒体查询，组件不用改。

## Verification

- 明暗两组原生窗口截图覆盖首页、项目库、外观、本地引擎和关于，布局与快照主体及偏差表相符；额外检查最小窗口与引擎错误截图。证据为忽略目录 `.cache/07-shell-{dev,packaged}-*.png`。
- 设置中心切换主题后立即生效。关闭应用后用同一个 userData 重新启动，主题不变，首帧没有闪烁。「跟随系统」模式下切换 Windows 主题，界面和原生按钮同步变化。
- `.cache/verify-shell-runtime.mjs dev` 和 `packaged` 通过；Win32 原生输入验证标题栏拖动和双击最大化／还原，CDP 点击菜单后用 Win32 读取窗口状态，确认退出、最小化、最大化、全屏与关于均正常。最终加固 exe 另通过设置界面选择「跟随系统」并实际切换 Windows 应用明暗偏好，媒体查询和原生按钮同步，截图已核对，系统设置已恢复。无页面错误、CSP 违规或退出残留。
- 「本地引擎」页签显示版本、schema 和启动时间。手动结束 engine 后，页面重载，弹窗仍停在「本地引擎」页签并显示中文错误，设置中心按钮出现错误圆点。
- `theme:set` 和 `window:command` 拒绝非法参数和不可信调用方，有单测覆盖。`preferences.json` 损坏时应用照常启动，使用「跟随系统」。
- 打包的加固 exe 打开设置中心时，控制台没有 CSP 违规；exe、安装包和任务栏显示新 logo。
- `pnpm lint` 能拦截调色板颜色类和任意值颜色（有反例验证）。`theme.css` 与主进程颜色常量的一致性测试通过。
- e2e 冒烟覆盖：打开设置中心查看健康状态、切换到暗黑后 `prefers-color-scheme: dark` 生效、重启后主题保持。
- 全仓 230 项单测通过，desktop 82 项中的 renderer 27 项覆盖路由、侧栏、设置、主题失败及菜单桥接；桌面 e2e 3 项通过，保留隔离与退出断言，并覆盖引擎故障后的路由／页签保留。`pnpm lint`、`pnpm typecheck` 通过，desktop 直接声明复用锁定的 zod 4.6.7，构建注入应用版本。

## Consequences

- 收益：标题栏、外壳与设置统一使用语义 token 和成熟交互组件；主题由主进程持久化并驱动原生窗口及媒体查询，健康故障可见且保留诊断页签。
- 代价：需要维护两份主题值、生成组件源码和原生／renderer 颜色一致性测试；生产样式 CSP 放宽，明亮次要文字保持设计稿原值仍有对比度缺口。

- shadcn CLI 依赖 `packages/ui/components.json`，生成后仍须核对实际路径、`cn` 导入和颜色 token；前述 06 验证保留这项兼容成本。
- 默认应用菜单已移除（见[桌面壳](../architecture/2026-10-24-desktop-shell.md)），生产包不再响应重新加载、开发者工具和页面缩放快捷键；标题栏的 HTML 菜单栏不受影响。
- 原生按钮的图标和设计稿不同，属于已接受的偏差；如果设计方坚持自绘，需要另写笔记重新评估 `frame: false`。
- 明亮模式次要文字对比度不足，等待设计确认，见上文「待确认」。
- engine 退出不再重载页面，改由类型化 `engine:exited` 事件刷新健康状态（见[桌面壳](../../implemented/architecture/2026-10-24-desktop-shell.md)），首页等页面以后开放输入也不会因此丢失内容。
- `style-src 'unsafe-inline'` 放宽了 CSP。以后如果页面需要渲染外部 HTML（例如模型返回的富文本），必须先做净化，并重新评估这条 CSP。
- 未覆盖 Windows 高对比度模式（forced colors）。

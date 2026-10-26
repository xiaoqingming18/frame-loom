# UI 开发规范

Frame Loom 的颜色、字体与阴影统一来自 `apps/desktop/src/renderer/src/styles/theme.css`。设计快照见[设计稿说明](design/README.md)，取舍见[主题与应用外壳笔记](../.agents/notes/implemented/feature/2026-10-24-theme-and-app-shell.md)与[设置快捷面板笔记](../.agents/notes/implemented/feature/2026-10-24-settings-quick-panel.md)。

## 主题与颜色

- 使用语义类：`bg-background` 是窗口底层，`bg-canvas` 是主画布，`bg-card` 是输入区／弹窗；`text-foreground` 是正文，`text-muted-foreground` 是次要文字，`text-destructive` 是错误。描边、焦点、阴影分别用 `border-border`、`ring-ring`、`shadow-panel`。
- 禁止 Tailwind 调色板颜色（如 `bg-zinc-800`）、任意值颜色（如 `text-[#333]`）、任意属性颜色和 JSX 内联颜色。尺寸任意值可以使用。`pnpm lint` 检查 TSX 类名和直接内联颜色；CSS 中仍须人工确认没有绕过 token。
- 新颜色先判断现有 token 是否足够；确需新增时在 `theme.css` 中同时定义明暗值，并说明语义。主进程窗口背景色由单测与 CSS 对齐，不另建 palette。
- 主题由主进程 `nativeTheme` 驱动，CSS 使用 `prefers-color-scheme`，不添加 `.dark` class，也不使用 localStorage 保存第二份偏好。设置只能经 `lib/desktop-bridge.ts` 读写。
- 明亮模式次要文字保留设计稿原值，对比度偏低；后续设计调整应同步 token，不局部加深文字。

## 组件与结构

- 基础交互优先复用 `@frame-loom/ui`（`packages/ui/src/components/`）的 shadcn 组件，以 `@frame-loom/ui/components/<name>` 导入；图标使用 `lucide-react`，装饰图标对辅助技术隐藏；纯图标按钮提供中文可访问名称。
- 添加组件：在 `packages/ui` 运行 `pnpm dlx shadcn@4.22.1 add <组件> --dry-run`，确认路径后生成。检查上游的 `cn` 导入，包内改用相对路径 `../lib/utils`，移除多余依赖并替换硬编码颜色。工作区包经 node_modules 链接引入，新增含 Tailwind 类名的包时要在 `globals.css` 用 `@source` 登记源码目录。
- 跨 feature 的布局放 `app/shell/`，业务界面放 `features/<feature>/`；feature 不互相导入，路由文件保持轻量。服务端数据使用 Query 和唯一 engine client。
- 窗口使用 `frame: false`，标题栏高 42px。空白区域使用 `app-region: drag`，菜单和自绘窗口按钮使用 `no-drag`。右侧最小化、最大化／还原、关闭按钮经可信桥接操作窗口，最大化状态以主进程查询和事件为准，不能仅在点击时翻转图标。设置模态框打开时窗口按钮仍可点击，操作不关闭设置。
- 自绘按钮适配明暗主题和中文可访问名称，关闭按钮悬停使用 `destructive`。不提供 Windows 11 原生最大化按钮悬停的贴靠弹层，系统拖动贴靠和快捷键保留。
- 侧栏展开宽 260px；主画布采用左上 16px 圆角、上／左描边及 24px 语义点阵，内容独立滚动。

## 交互与验收

- 弹窗复用 Dialog 的焦点锁、Esc 关闭与读屏语义，关闭后恢复到可操作入口；Tabs 支持键盘导航。
- 左栏底部的设置中心先向上打开快捷面板，提供主题三段切换与设置入口。快捷面板使用 Radix Popover，主题切换后保持打开；Esc 和点击外部可关闭。设置行关闭面板并将焦点交给模态窗口，避免关闭面板时抢回入口。
- 设置模态窗口采用大圆角底座、左侧分类导航和右侧独立滚动内容面板；设置行优先左侧标题／描述、右侧控件。快捷面板与外观页复用主题组件和保存状态，保存期间两处均禁用重复写入。
- 未开放的创作控件使用 `aria-disabled` 和只读文本框，阻止实际操作，同时保留键盘聚焦。通过 Tooltip 与常驻 `aria-describedby` 提示「创作功能尚未开放」，不添加虚假项目或版本数据。
- 设置中心开关与页签保存在路由 search 的 `settings` 参数中，允许 `appearance`、`engine`、`models`、`defaults`、`storage`、`about`；非法值回退为关闭。引擎退出后不重载页面，保留路径、页签与画布内容。健康查询在外壳执行，失败时设置入口显示错误圆点；本地引擎页提供手动重查。
- 图片与视频节点内提供模型、提示词和档案参数；生成使用持久化任务，连线素材按档案校验后提交。档案要求 URL 的参考素材（包括图片）需要对象存储，未配置时显示说明并阻止生成。媒体预览与参数区分开，参数独立滚动且不触发画布缩放；低于 40% 缩放时保留轻量节点，仅选中节点挂载表单，放大后恢复表单与视口裁剪；不支持的生成方式隐藏，明确禁止的端口禁用。
- 每个新界面检查明亮、暗黑两种模式、最小窗口尺寸、键盘焦点、禁用和错误状态。设置中心等 Portal 组件还需在加固 exe 检查 CSP。
- 提交前运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`、`pnpm run verify`；涉及桌面交互时运行桌面 e2e，自动测试不能代替原生窗口与加固产物验证。

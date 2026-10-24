# UI 开发规范

Frame Loom 的颜色、字体与阴影统一来自 `apps/desktop/src/renderer/src/styles/theme.css`。设计快照见[设计稿说明](design/README.md)，取舍见[主题与应用外壳笔记](../.agents/notes/implemented/feature/2026-10-24-theme-and-app-shell.md)。

## 主题与颜色

- 使用语义类：`bg-background` 是窗口底层，`bg-canvas` 是主画布，`bg-card` 是输入区／弹窗；`text-foreground` 是正文，`text-muted-foreground` 是次要文字，`text-destructive` 是错误。描边、焦点、阴影分别用 `border-border`、`ring-ring`、`shadow-panel`。
- 禁止 Tailwind 调色板颜色（如 `bg-zinc-800`）、任意值颜色（如 `text-[#333]`）、任意属性颜色和 JSX 内联颜色。尺寸任意值可以使用。`pnpm lint` 检查 TSX 类名和直接内联颜色；CSS 中仍须人工确认没有绕过 token。
- 新颜色先判断现有 token 是否足够；确需新增时在 `theme.css` 中同时定义明暗值，并说明语义。原生标题栏复制的颜色由单测与 CSS 对齐，不另建 palette。
- 主题由主进程 `nativeTheme` 驱动，CSS 使用 `prefers-color-scheme`，不添加 `.dark` class，也不使用 localStorage 保存第二份偏好。设置只能经 `lib/desktop-bridge.ts` 读写。
- 明亮模式次要文字保留设计稿原值，对比度偏低；后续设计调整应同步 token，不局部加深文字。

## 组件与结构

- 基础交互优先复用 `components/ui/` 的 shadcn 组件，图标使用 `lucide-react`，装饰图标对辅助技术隐藏；纯图标按钮提供中文可访问名称。
- 添加组件：在 `apps/desktop` 运行 `pnpm dlx shadcn@4.22.1 add <组件> --dry-run`，确认路径后生成。检查上游的 `cn` 导入，改用 `@/lib/utils`，移除多余依赖并替换硬编码颜色。
- 跨 feature 的布局放 `app/shell/`，业务界面放 `features/<feature>/`；feature 不互相导入，路由文件保持轻量。服务端数据使用 Query 和唯一 engine client。
- 标题栏高 42px，可拖动区域使用 `app-region: drag`；菜单使用 `no-drag`，内容宽度受 `env(titlebar-area-width)` 限制，不覆盖原生按钮。
- 侧栏展开宽 260px；主画布采用左上 16px 圆角、上／左描边及 24px 语义点阵，内容独立滚动。

## 交互与验收

- 弹窗复用 Dialog 的焦点锁、Esc 关闭与读屏语义，关闭后恢复到可操作入口；Tabs 支持键盘导航。
- 未开放的创作控件使用 `aria-disabled` 和只读文本框，阻止实际操作，同时保留键盘聚焦。通过 Tooltip 与常驻 `aria-describedby` 提示「创作功能尚未开放」，不添加虚假项目或版本数据。
- 设置中心开关与页签保存在路由 search 的 `settings` 参数中，允许 `appearance`、`engine`、`about`；非法值回退为关闭。引擎故障重载后保留路径与页签。健康查询在外壳执行，失败时设置入口显示错误圆点；本地引擎页提供手动重查。
- 每个新界面检查明亮、暗黑两种模式、最小窗口尺寸、键盘焦点、禁用和错误状态。设置中心等 Portal 组件还需在加固 exe 检查 CSP。
- 提交前运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`、`pnpm run verify`；涉及桌面交互时运行桌面 e2e，自动测试不能代替原生窗口与加固产物验证。

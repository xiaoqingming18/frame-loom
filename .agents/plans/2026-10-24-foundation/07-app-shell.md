# Plan: 应用外壳与设置中心

Status: draft
Parent: plan.md
Note: ../../notes/proposed/feature/2026-10-24-theme-and-app-shell.md

## 目标

- 按 `docs/design/` 中的两份设计稿实现标题栏、侧栏、主画布、首页和项目库空状态，与笔记偏差表相符。
- 设置中心弹窗提供外观、本地引擎、关于三个页签，开关状态与当前页签保存在路由 search 中。
- `docs/ui-guidelines.md` 与 `docs/design/README.md` 写明后续界面规则，`AGENTS.md` 加入指向。
- 三篇笔记移入 `implemented/`，父计划转 `done`。

## 前置条件

- 06 完成，主题 token、shadcn 组件、IPC 与 logo 可用。

## 步骤

- [ ] T1 新建 `app/shell/title-bar.tsx`：42px 高，`app-region: drag`，宽度受 `env(titlebar-area-width)` 限制；左侧放「Frame Loom」与 `Menubar`（文件：退出；窗口：最小化、最大化/还原、全屏；帮助：关于），菜单项通过 `desktop-bridge` 调用 `window.command` — 验证：拖动和双击标题栏正常，菜单可点击且不触发拖动，各菜单项行为正确
- [ ] T2 新建 `app/shell/sidebar.tsx`：260px 宽；品牌区、折叠与搜索按钮（搜索禁用）、「开始创作」与「项目库」导航（按当前路由高亮）、「项目」分组（新建按钮禁用）、底部「设置中心」按钮；健康查询失败时按钮显示 `destructive` 圆点 — 验证：组件测试覆盖路由高亮、折叠、错误圆点
- [ ] T3 新建 `app/shell/app-shell.tsx`，在 `routes/__root.tsx` 中使用：主画布为 `canvas` 背景、24px `dot` 点阵、左上 16px 圆角与上、左描边，主内容区单独滚动 — 验证：明暗截图与设计稿主体布局一致
- [ ] T4 `routes/index.tsx` 实现首页：hero 保留四角选框，内放 logo、「帧织」与副标题；输入区和选择项目底座按设计稿实现，所有控件禁用并用 Tooltip 提示「创作功能尚未开放」；不显示公告胶囊。新增 `routes/projects.tsx` 空状态 — 验证：明暗截图与设计稿相符，禁用控件可通过键盘聚焦并读出提示
- [ ] T5 根路由用 zod 校验 search 参数 `settings?: 'appearance' | 'engine' | 'about'`；新建 `app/shell/settings-dialog.tsx`，使用 `Dialog` 加竖向 `Tabs`。外观页使用 `features/theme`（ToggleGroup，通过 `desktop-bridge` 读写），本地引擎页使用 `features/engine-status`，关于页显示 logo、应用名与由 Vite `define` 注入的版本号 — 验证：组件测试覆盖打开与关闭、页签切换、主题切换调用、健康状态三种显示
- [ ] T6 删除旧健康页的 `styles.css` 和遗留组件，只用主题 token 类 — 验证：`pnpm lint` 通过，renderer 中检索不到十六进制颜色（`styles/theme.css` 除外）
- [ ] T7 更新 `apps/desktop/e2e/smoke.test.ts`：打开设置中心，在「本地引擎」页检查健康状态与非空版本；切换为暗黑后断言 `matchMedia('(prefers-color-scheme: dark)').matches`；用同一个临时 userData 重启后主题保持；保留现有的隔离与退出断言 — 验证：`pnpm --filter @frame-loom/desktop test:e2e` 通过
- [ ] T8 运行 `package:dir`，启动加固 exe：明暗两种模式各截一组图；打开设置中心，检查控制台无 CSP 违规；在任务管理器中结束 engine，确认弹窗停在「本地引擎」页并显示中文错误；关闭后无残留进程 — 验证：截图已检查，结果记入本计划
- [ ] T9 编写 `docs/design/README.md`（快照日期、颜色以 `theme.css` 为准、新设计稿使用新文件名）和 `docs/ui-guidelines.md`（token 使用、禁止的颜色写法、shadcn 与 lucide、明暗双检）；`AGENTS.md` 增加一条指向 `docs/ui-guidelines.md`；README 更新界面说明 — 验证：`pnpm format:check` 通过
- [ ] T10 提交 `feat(desktop): 新增应用外壳与设置中心`，带 `Note:` 与 `Plan:` 尾注 — 验证：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm run verify` 通过
- [ ] T11 三篇笔记（基础设施、lint 与格式化、主题与外壳）移入 `implemented/`，按实际结果改写为现在时的 `## Decision`、`## Consequences` 与 `## Verification`；同步应用骨架与桌面壳笔记中 preload API、CSP、renderer 结构、退出重载的事实；所有计划的 `Note:` 改到新路径，本计划与父计划转 `done` — 验证：`pnpm run verify` 通过

## 验证

- 预期：明暗截图与设计稿相符；设置中心各页签正常，主题持久化并跟随系统；engine 退出后弹窗显示错误；加固 exe 无 CSP 违规；e2e 通过。
- 实际：未执行。

## 进度

- 2026-10-24：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始，等待 06 完成。

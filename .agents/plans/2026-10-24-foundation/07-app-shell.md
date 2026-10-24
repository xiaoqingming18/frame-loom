# Plan: 应用外壳与设置中心

Status: done
Parent: plan.md
Note: ../../notes/implemented/feature/2026-10-24-theme-and-app-shell.md

## 目标

- 按 `docs/design/` 中的两份设计稿实现标题栏、侧栏、主画布、首页和项目库空状态，与笔记偏差表相符。
- 设置中心弹窗提供外观、本地引擎、关于三个页签，开关状态与当前页签保存在路由 search 中。
- `docs/ui-guidelines.md` 与 `docs/design/README.md` 写明后续界面规则，`AGENTS.md` 加入指向。
- 基础设施与主题笔记移入 `implemented/`，原地更新已实现的 lint 笔记，父计划转 `done`。

## 前置条件

- 06 完成，主题 token、shadcn 组件、IPC 与 logo 可用。

## 步骤

- [x] T1 新建 `app/shell/title-bar.tsx`：42px 高，`app-region: drag`，宽度受 `env(titlebar-area-width)` 限制；左侧放「Frame Loom」与 `Menubar`（文件：退出；窗口：最小化、最大化/还原、全屏；帮助：关于），菜单项通过 `desktop-bridge` 调用 `window.command` — 验证：拖动和双击标题栏正常，菜单可点击且不触发拖动，各菜单项行为正确
- [x] T2 新建 `app/shell/sidebar.tsx`：260px 宽；品牌区、折叠与搜索按钮（搜索禁用）、「开始创作」与「项目库」导航（按当前路由高亮）、「项目」分组（新建按钮禁用）、底部「设置中心」按钮；健康查询失败时按钮显示 `destructive` 圆点 — 验证：组件测试覆盖路由高亮、折叠、错误圆点
- [x] T3 新建 `app/shell/app-shell.tsx`，在 `routes/__root.tsx` 中使用：主画布为 `canvas` 背景、24px `dot` 点阵、左上 16px 圆角与上、左描边，主内容区单独滚动 — 验证：明暗截图与设计稿主体布局一致
- [x] T4 `routes/index.tsx` 指向 `features/home/components/home-page.tsx` 实现首页：hero 保留四角选框，内放 logo、「帧织」与副标题；输入区和选择项目底座按设计稿实现，所有控件禁用并用 Tooltip 提示「创作功能尚未开放」；不显示公告胶囊。新增 `routes/projects.tsx` 空状态 — 验证：明暗截图与设计稿相符，禁用控件可通过键盘聚焦并读出提示
- [x] T5 根路由用 zod 校验 search 参数 `settings?: 'appearance' | 'engine' | 'about'`；新建 `app/shell/settings-dialog.tsx`，使用 `Dialog` 加竖向 `Tabs`。外观页使用 `features/theme`（ToggleGroup，通过 `desktop-bridge` 读写），本地引擎页使用 `features/engine-status`，关于页显示 logo、应用名与由 Vite `define` 注入的版本号 — 验证：组件测试覆盖打开与关闭、页签切换、主题切换调用、健康状态三种显示
- [x] T6 删除旧健康页的 `styles.css` 和遗留组件，只用主题 token 类 — 验证：`pnpm lint` 通过，renderer 中检索不到十六进制颜色（`styles/theme.css` 除外）
- [x] T7 更新 `apps/desktop/e2e/smoke.test.ts`：打开设置中心，在「本地引擎」页检查健康状态与非空版本；切换为暗黑后断言 `matchMedia('(prefers-color-scheme: dark)').matches`；用同一个临时 userData 重启后主题保持；保留现有的隔离与退出断言 — 验证：`pnpm --filter @frame-loom/desktop test:e2e` 通过
- [x] T8 运行 `package:dir`，启动加固 exe：明暗两种模式各截一组图；打开设置中心，检查控制台无 CSP 违规；终止 engine，确认弹窗停在「本地引擎」页并显示中文错误；关闭后无残留进程 — 验证：截图已检查，结果记入本计划
- [x] T9 编写 `docs/design/README.md`（快照日期、颜色以 `theme.css` 为准、新设计稿使用新文件名）和 `docs/ui-guidelines.md`（token 使用、禁止的颜色写法、shadcn 与 lucide、明暗双检）；`AGENTS.md` 增加一条指向 `docs/ui-guidelines.md`；README 更新界面说明 — 验证：`pnpm format:check` 通过
- [x] T10 提交 `feat(desktop): 新增应用外壳与设置中心`，带 `Note:` 与 `Plan:` 尾注 — 验证：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm run verify` 通过
- [x] T11 基础设施与主题笔记移入 `implemented/`，原地更新已实现的 lint 笔记，按实际结果改写 `## Decision`、`## Consequences` 与 `## Verification`；同步应用骨架与桌面壳笔记中 preload API、CSP、renderer 结构、退出重载的事实；所有计划的 `Note:` 改到新路径，本计划与父计划转 `done` — 验证：`pnpm run verify` 通过

## 验证

- 预期：明暗截图与设计稿相符；设置中心各页签正常，主题持久化并跟随系统；engine 退出后弹窗显示错误；加固 exe 无 CSP 违规；e2e 通过。
- 质量门禁：`pnpm lint`、`pnpm typecheck`、`pnpm format:check`、`pnpm install --frozen-lockfile --offline`、`pnpm run verify` 与 `git diff --check` 通过。全仓 `pnpm test` 共 230 项（contracts 68、engine 80、desktop 82）；renderer 27 项包含新外壳、路由和设置交互，旧 main／preload 覆盖保持。
- 组件验证：覆盖侧栏高亮与折叠、错误圆点、健康的加载／成功／失败及重查、设置打开／关闭／切页／非法参数、关闭恢复焦点、主题读取与切换、保存失败保留原选择、四种窗口命令桥接与关于入口。首页只读输入可聚焦，按钮 `aria-disabled`，Tooltip 和常驻描述提供提示；关闭／重开引擎页不自动重试。
- 桌面 e2e：`pnpm --filter @frame-loom/desktop test:e2e` 3 项通过，包含设置中心真实健康版本、损坏偏好回退、界面切换主题、媒体查询与原生背景同步、同一 userData 重启保持、跟随系统、窗口菜单退出、404／hash 重载、全局隔离、正常退出及终止 engine 后页签保留。
- 打包：`pnpm --filter @frame-loom/desktop package:dir --config.electronDist=E:/Workspace/project/personal_project/frame-loom/apps/desktop/node_modules/electron/dist` 通过，复用本机 Electron 45.0.0，保持既有生产 fuse。没有为测试开放主进程调试。
- 真实运行：`.cache/verify-shell-runtime.mjs dev` 和 `packaged` 通过；开发由根 `pnpm dev` 启动，加固 exe 直接启动。CDP 检查明暗界面、Dialog／Tabs／Tooltip／Menubar、主题重启、故障重载保留路径及页签、中文错误与圆点、无 CSP／页面错误及退出无残留。Win32 输入验证标题栏拖动和双击，菜单操作后检查最小化、最大化／还原和全屏状态；脚本仅操作临时应用窗口，不宣称人工点击。
- 视觉：`.cache/07-shell-{dev,packaged}-*.png` 为原生窗口截图，覆盖两种主题的首页、项目库、外观、本地引擎、关于，以及引擎错误和最小窗口；截图已核对。最小逻辑视口 720×560 无主画布横向溢出，弹窗宽度额外限制为窗口减 32px，保留留白。
- 跟随系统：在最终加固 exe 的外观页选择「跟随系统」，实际切换 Windows 应用明暗偏好，媒体查询、页面与原生按钮同步；`.cache/07-shell-packaged-system-{light,dark}.png` 已核对，测试后恢复原系统偏好。

## 进度

- 2026-10-24：创建子计划草稿。
- 2026-10-24：用户授权执行 07；06 已完成，沿用既有提案、设计稿和组件，不新增产品方向取舍。
- 2026-10-24：T1～T11 完成；外壳、首页、设置中心、UI 规范及笔记流转同批交付。230 项单测、3 项桌面 e2e、质量门禁、开发窗口与最终加固 exe 的原生交互／主题／故障检查通过；父计划同步 done。

## 发现与偏差

- desktop 原先仅通过 contracts 间接使用 zod，本次路由直接使用，新增精确开发依赖 `zod@4.6.7` 并同步锁文件；复用仓库已有版本，不新增第二个校验库。
- 为保持薄路由，首页实际放在 `features/home/`，路由只指向组件；不存在的 V3 和 Design 指南改为通用版本占位／移除，偏差同步主题笔记。未开放控件用 `aria-disabled`／只读，避免原生 disabled 让键盘无法访问提示。
- Computer Use 初始化因缺少 `@oai/sky` 失败，改用 CDP 和 Win32 原生截图／输入。T8 通过识别当前应用的 Node utility PID 后终止进程复现故障，未打开任务管理器；验证行为相同，保留真实重载链路。
- Electron 的 CDP 不提供 `Browser.getWindowForTarget`，窗口状态改用 Win32 读取；最小尺寸按 DPI 换算并核对实际 `innerWidth/innerHeight`，不把物理像素当逻辑像素。
- lint 笔记早在 02 已转入 implemented，本次原地更新；只迁移其余两篇，并修复所有入站链接。未重复 NSIS 安装／卸载、远端 CI、其他系统或高对比度模式。

## 交接

无。

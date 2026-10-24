# Plan: engine 与 renderer 基础设施

Status: active
Note: ../../notes/proposed/architecture/2026-10-24-engine-and-renderer-foundation.md
Note: ../../notes/implemented/process/2026-10-24-lint-and-format.md
Note: ../../notes/proposed/feature/2026-10-24-theme-and-app-shell.md

## 目标

达成三篇笔记的验收标准：

- [engine 与 renderer 基础设施](../../notes/proposed/architecture/2026-10-24-engine-and-renderer-foundation.md)：
  - engine 位于 `apps/engine`，按 `core/` 加 `modules/` 组织；
  - 所有错误响应符合 contracts 的 `ErrorResponse`，日志只写 stderr；
  - renderer 使用文件路由、hash history、`features/` 目录和唯一的 engine client；
  - 开发、构建产物和加固 exe 的行为与迁移前一致。
- [ESLint 与 Prettier](../../notes/implemented/process/2026-10-24-lint-and-format.md)：
  - `pnpm lint`、`pnpm format:check` 全仓通过并接入 CI；
  - 导入边界有反例验证。
- [主题系统与应用外壳](../../notes/proposed/feature/2026-10-24-theme-and-app-shell.md)：
  - 明暗主题由 token 驱动，偏好持久化并跟随系统，首帧无闪烁；
  - 自定义标题栏、侧栏、主画布与设计稿一致；
  - 设置中心弹窗包含主题设置与 engine 健康检查，logo 使用用户提供的图片；
  - lint 能拦截不走 token 的颜色写法。

## 范围与非目标

- 范围：
  - `services/engine` 迁到 `apps/engine`，同步代码路径、文档、活跃笔记和锁文件；
  - 根目录 ESLint、Prettier、`.git-blame-ignore-revs` 与 CI 步骤；
  - engine 目录调整、`package-root.ts`、`ErrorResponse`、`ZodValidationPipe`、`DomainError`、全局异常过滤器、stderr 日志；
  - desktop tsconfig 拆分、`@/` 别名、TanStack 文件路由、hash history、engine client、Vitest 分 project；
  - 主题 token、shadcn 组件、偏好持久化、`theme:*` 与 `window:command` IPC、`titleBarOverlay`、CSP 的 `style-src` 调整、logo 与应用图标；
  - 标题栏、侧栏、首页与项目库静态界面、设置中心弹窗、`docs/design/` 设计稿快照、`docs/ui-guidelines.md`。
- 非目标：
  - 任何业务模块，包括创作输入、项目创建与列表数据、搜索、任务表、SSE、Agent 与 pi；
  - Zustand、`@xyflow/react`、i18n、devtools、MSW、Storybook；
  - 非 GET 接口及对应的 CORS 放开；
  - 修改 `app://` 协议的路径映射或 engine 的 ready/shutdown 协议；
  - 包名、进程名、打包后的 `resources/engine` 路径；
  - Windows 高对比度模式适配、macOS 与 Linux 窗口样式。

## 子计划

| 编号 | 子计划 | 状态 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| 01 | [engine 迁到 apps/engine](01-move-engine.md) | done | — | `services/` 不存在，开发、打包、e2e 行为不变 |
| 02 | [ESLint 与 Prettier](02-lint-format.md) | active | 01 | `pnpm lint`、`pnpm format:check` 通过，CI 已接入，格式化提交独立 |
| 03 | [engine 目录调整](03-engine-structure.md) | draft | 02 | `core/` 加 `modules/health` 结构，现有测试与部署入口通过 |
| 04 | [engine 错误契约与日志](04-engine-http-baseline.md) | draft | 03 | 所有错误响应符合 `ErrorResponse`，日志只写 stderr |
| 05 | [renderer 骨架](05-renderer-skeleton.md) | draft | 02、04 | 文件路由、hash history、engine client、拆分的 tsconfig 与测试环境 |
| 06 | [主题系统与窗口标题栏](06-theme-system.md) | draft | 05 | 明暗 token、偏好持久化、主题与窗口 IPC、原生按钮配色、shadcn、颜色 lint、新图标 |
| 07 | [应用外壳与设置中心](07-app-shell.md) | draft | 06 | 与设计稿一致的外壳和首页、设置中心弹窗、UI 规范文档，笔记转入 implemented |

## 依赖与顺序

- 关键路径：01 → 02 → 03 → 04 → 05 → 06 → 07。
- 02 排在 03 之前，是为了让目录调整后的新文件直接符合 lint 和格式规则，不必再格式化一次。
- 可并行：
  - 05 中 tsconfig 拆分、Vitest 分 project、路由插件接入只依赖 02，可以和 03、04 并行；engine client 解析 `ErrorResponse` 的部分要等 04 完成。
  - 06 中主进程的偏好持久化、IPC 与 `titleBarOverlay`（T1 至 T4）不依赖 engine，可以在 02 完成后和 03、04 并行；token、shadcn 与颜色 lint 要等 05 的别名与测试环境。

## 验收

- [x] `services/` 不存在，`pnpm dev`、`package:dir`、`test:e2e` 和加固 exe 启动都通过 — 证据：01 验证
- [ ] `pnpm lint`、`pnpm format:check` 通过，边界反例报错，CI 包含两步 — 证据：02 验证
- [ ] engine 结构调整后测试全过，`db:generate` 无变化，部署入口黑盒通过 — 证据：03 验证
- [ ] 401、403、400、500 响应体符合 `ErrorResponse`，日志无 token，stdout 只有 ready — 证据：04 验证
- [ ] 加固 exe 中结束 engine 后，hash 路由重载仍在原路由并显示中文错误；renderer 中的 `process` 无法通过 web 类型检查 — 证据：05 验证
- [ ] 偏好损坏时照常启动，IPC 拒绝非法输入，颜色 lint 反例报错，exe 显示新图标 — 证据：06 验证
- [ ] 明暗截图与设计稿相符，主题重启后保持并跟随系统，设置中心显示健康状态，加固 exe 无 CSP 违规 — 证据：07 验证
- [ ] 三篇笔记移入 `implemented/` 并按实际结果改写，计划转 `done` — 证据：07 收尾步骤

## 发现与偏差

- 2026-10-24 收到主界面明暗设计稿与 logo，新增[主题系统与应用外壳](../../notes/proposed/feature/2026-10-24-theme-and-app-shell.md)笔记和子计划 06、07；05 只保留骨架，收尾步骤移到 07。shadcn 从延后项改为随 06 引入，CSP 调整从风险项改为 06 的明确步骤。

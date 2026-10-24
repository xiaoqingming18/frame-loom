# Plan: engine 错误契约与日志

Status: done
Parent: plan.md
Note: ../../notes/proposed/architecture/2026-10-24-engine-and-renderer-foundation.md

## 目标

- contracts 新增 `ErrorResponse`，engine 的所有错误响应体都符合它，包括边界中间件和鉴权 guard 产生的 403、401。
- engine 提供按参数使用的 `ZodValidationPipe` 与 `DomainError`，全局过滤器按笔记的映射表输出中文消息，500 不暴露堆栈。
- 日志只写 stderr，独立运行时 stdout 只有一行 ready JSON；日志中没有 token。

## 前置条件

- 03 完成，`src/core/http/` 与 `src/core/logging/` 目录位置已确定。

## 步骤

- [x] T1 在 `packages/contracts/src/error-response.ts` 定义 `ErrorResponse` schema 与类型并从入口导出 — 验证：contracts 测试覆盖必填字段、可选 issues 与非法输入
- [x] T2 在 `src/core/http/` 实现 `DomainError`、`ZodValidationPipe` 与全局异常过滤器，以 `APP_FILTER` 注册 — 验证：单测覆盖四类异常映射，500 响应体不含堆栈
- [x] T3 确认边界中间件的 403 是否经过全局过滤器；不经过时在中间件内直接写 `ErrorResponse` — 验证：HTTP 测试中错误 Host、错误 Origin、无 Origin 的 OPTIONS 返回 403，响应体通过 `ErrorResponse.parse`
- [x] T4 HTTP 测试补充 401 响应体断言，并用测试专用路由覆盖 400 与 500 — 验证：四种状态的响应体都通过 `ErrorResponse.parse`
- [x] T5 在 `src/core/logging/` 实现写 stderr 的日志（优先继承 `ConsoleLogger`，不可行时实现 `LoggerService`），`createEngine` 使用它替换 `logger: false` — 验证：生产入口测试断言 stdout 只有一行 ready JSON，stderr 中不包含 token
- [x] T6 更新 `apps/desktop/src/renderer/src/health.ts` 的错误处理，非 2xx 时解析 `ErrorResponse` 并显示其中文消息 — 验证：desktop 测试覆盖错误响应解析
- [x] T7 运行 `pnpm test`、`pnpm typecheck`、`pnpm lint`，启动加固 exe 检查健康页 — 验证：全部通过
- [x] T8 同步 engine 服务笔记与 `apps/engine/README.md` 中的错误与日志事实，提交 `feat(engine)!: 统一错误响应与 stderr 日志`，`BREAKING CHANGE:` 说明错误响应体改为 `ErrorResponse`，带 `Note:` 与 `Plan:` 尾注 — 验证：提交钩子与 `pnpm run verify` 通过

## 验证

- 预期：401、403、400、500 响应体都通过 `ErrorResponse.parse`；500 无堆栈；stdout 只有 ready；日志中无 token；renderer 显示中文错误消息。
- 实际：`pnpm test` 通过 172 项（contracts 53、desktop 39、engine 80），`pnpm typecheck`、`pnpm lint`、`pnpm format:check` 与 `pnpm run verify` 通过。HTTP 覆盖四类异常、未知路由、原始响应无堆栈／内部字段，以及中间件与 guard 的 403／401；日志覆盖全部级别、无堆栈错误、消息／对象／堆栈脱敏，生产入口断言 stdout 只有单行 ready。最终加固包使用 `pnpm --filter @frame-loom/desktop package:dir --config.electronDist=E:/Workspace/project/personal_project/frame-loom/apps/desktop/node_modules/electron/dist` 构建，`test:e2e` 1 项通过。`.cache/verify-foundation-ui.mjs 04` 检查真实加固 exe 的“运行正常”、engine 0.1.0、schema 1，再用测试响应触发 401，页面显示“连接中断”和“访问令牌无效”；截图 `.cache/04-foundation-packaged.png`、`.cache/04-foundation-packaged-error.png` 已检查。关闭退出码 0，4 个子进程全部退出。

## 进度

- 2026-10-24：创建子计划草稿。
- 2026-10-24：03 已独立提交为 `e85e9b7`；开始 contracts、全局过滤器、stderr 日志与 renderer 错误消息的联动实现。
- 2026-10-24：T1～T8 完成，共享契约、HTTP 映射、日志、renderer、测试和既有笔记同批落地；全部检查、桌面 e2e 与真实加固窗口验证通过，按计划独立提交。

## 发现与偏差

- 实测边界中间件的 `next(error)` 会进入 `APP_FILTER`，保留现有错误传递，不另建中间件错误响应实现。
- `ConsoleLogger.printStackTrace` 实际可能收到 undefined，声明未反映这一点；首次测试发现它会使错误日志打断清理，已保留空值处理，并用无堆栈日志与监听失败退出测试回归。
- 最后一轮默认目录打包在 Electron 下载／解包阶段超过 5 分钟无进展，终止该打包器后，临时用 `--config.electronDist` 复用已安装的 Electron 45.0.0 完成构建。仓库打包配置、生产 fuse 与依赖版本未改；未重新执行 NSIS 安装／卸载。
- 共享基础设施笔记仍包含 05 的 renderer 工作，继续保留 proposed，并已标明 engine 部分落地；事实同步到 implemented 的 engine 服务与共享契约笔记。
- 清理 03 仓库外临时部署目录的命令被自动审批以 `blocked by policy` 拒绝，未提供更具体原因；目录保留，不影响验证。

## 交接

无。

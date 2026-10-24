# Plan: engine 服务骨架

Status: done
Parent: plan.md
Note: ../../notes/implemented/architecture/2026-10-24-engine-service.md

## 目标

建立 `services/engine`（包名 `@frame-loom/engine`），一个 NestJS 12 的 ESM 应用，基于 Express。具体要求：

- 启动时读取环境变量 `FRAME_LOOM_TOKEN` 和 `FRAME_LOOM_DATA_DIR`；
- 在 `<dataDir>/data/frame-loom.sqlite` 上执行 Drizzle 迁移；
- 监听 `127.0.0.1:0`；
- 在 Electron `utilityProcess` 环境下，通过 `process.parentPort` 上报 `{ type: 'ready', port }`；
- 提供 `GET /health`，必须鉴权，返回 `HealthResponse`。

engine 不依赖 Electron，用 Node 24.22 直接运行 `node dist/main.js` 就能单独启动和测试。

## 前置条件

- 02 完成，`@frame-loom/contracts` 可以构建。

## 步骤

- [x] T1 参考 `@nestjs/schematics` 的 `ts-esm` 模板建立 `services/engine`，保留 ESM、NodeNext、装饰器元数据、`nest-cli.json` 和精确依赖，移除示例与多余模板工具 — 验证：`pnpm --filter @frame-loom/engine build` 生成 `dist/main.js`，输出不含测试
- [x] T2 用 zod 校验 64 位十六进制 token、绝对数据目录与 JSON 允许源列表 — 验证：配置测试通过，生产入口无配置时输出中文错误并以 1 退出，不泄露无效令牌
- [x] T3 用 better-sqlite3 与 Drizzle 在监听前完成 WAL、外键和 `app_meta` 迁移，入库生成的 SQL 与快照，并初始化 schema 版本；按实际安装登记构建许可 — 验证：冻结安装成功；真实 SQLite 测试覆盖版本、迁移日志、幂等、已有数据保留和损坏数据库失败
- [x] T4 用全局 guard 与 `timingSafeEqual` 校验 Bearer，在 CORS 前检查 Host 与 Origin，只允许环境变量指定的源 — 验证：单测与真实 HTTP 测试覆盖缺失／错误 token 的 401、错误 Host／Origin 的 403、合法请求的 200，以及可信预检
- [x] T5 实现 `HealthController`，通过 `HealthResponse.parse` 校验健康响应，读取包版本和落盘 schema 版本 — 验证：HTTP 与生产入口黑盒测试均通过共享契约检查
- [x] T6 实现迁移后随机端口监听、parentPort／stdout ready 与 shutdown／SIGTERM／SIGINT 关闭，处理初始化期间退出 — 验证：生产入口子进程测试从临时工作目录启动，用 HTTP 请求确认 200，并检查正常退出、端口关闭与 WAL 清理
- [x] T7 配置单测与 e2e 共用的 Vitest，先实测隐式注入再决定是否加 SWC — 验证：controller → service 注入正常，无需 SWC，engine 68 项测试通过
- [x] T8 增加根 `deploy:engine` 脚本，构建后执行 `pnpm --filter @frame-loom/engine deploy --prod <输出目录>`，确认迁移、生产依赖与 contracts 产物 — 验证：部署目录独立启动并通过生产入口测试，无需 `injectWorkspacePackages`
- [x] T9 提交 `feat(engine): 新增本地服务骨架`，带 `Note:` 和 `Plan:` 尾注 — 验证：`pnpm run verify` 与 `pnpm -r test` 通过，与本计划收尾同批提交

## 验证

- 预期：
  - engine 用 Node 24.22 能单独启动并完成迁移；
  - 无 token 返回 401，`Host` 错误返回 403，正确请求返回 200，且响应符合契约；
  - `deploy` 产物能独立运行。
- 实际：Node 24.22.1、pnpm 12.15.0 下，冻结安装、workspace 构建与 `pnpm typecheck` 通过；再次执行 `db:generate` 无 schema 变更。
- `pnpm -r test` 通过：contracts 43 项、engine 68 项，覆盖配置、元数据注入、真实 SQLite 迁移、HTTP 边界、健康响应及编译入口的启动与关闭。
- 生产入口无配置或数据库损坏时以 1 退出，不上报 ready；有效配置从临时工作目录启动，迁移后输出端口，带 Bearer 的 `/health` 返回 200。
- `pnpm deploy:engine` 产物含 `dist/`、`drizzle/`、生产依赖及 contracts 的 `dist`；另向仓库外的系统临时目录执行生产部署，复用 `src/main.test.ts` 检查入口、鉴权、健康响应与退出。
- 既有 `test:plans` 37 项、`test:commit-convention` 29 项通过，包含真实 Git 钩子校验；`pnpm run verify` 与 `git diff --check` 通过。

## 进度

- 2026-10-24：创建子计划草稿。
- 2026-10-24：用户授权执行子计划 03；确认 02 完成、工作区干净，开始实现独立 engine 与部署验证。
- 2026-10-24：完成 T1–T8、68 项 engine 测试和仓库外部署验证；engine 笔记移入 `implemented/`，同步父计划、项目现状与 04 对接说明，与 T9 同批提交。

## 发现与偏差

- 完整架构仍需 04、05 验证，保持 `proposed`；本次 engine 的独立决策笔记转入 `implemented`，与完整架构及共享契约笔记互链。
- `FRAME_LOOM_ALLOWED_ORIGINS` 固定为 JSON 字符串数组，省略时 `[]`；退出消息为 `{ type: 'shutdown' }`。04 的主进程必须遵守这两项格式。
- Host 与 Origin 检查放在 CORS 前的全局中间件，Bearer 放在全局 guard；可信 OPTIONS 预检无 Bearer，实际接口仍鉴权。未带 Origin 的预检拒绝。
- better-sqlite3 13.0.3 自带预编译包，无安装生命周期脚本，构建许可登记 `false`。drizzle-kit 带入的 esbuild 0.18.20 与 0.25.12 初次安装被审核拦截；核对安装脚本后按精确版本许可，冻结安装通过。
- 首份表结构由 drizzle-kit 生成，补充 schema_version 的种子 SQL；迁移与快照一起入库。测试验证重复启动不会覆盖已有元数据。
- Vitest 已能生成隐式注入所需元数据，不加 SWC；pnpm deploy 已能携带 workspace 产物，不开启注入。生产入口测试代替人工 curl 验证；parentPort 与信号事件使用 shim，真实 Electron、操作系统信号投递和安装包验证留到后续。

## 交接

无。

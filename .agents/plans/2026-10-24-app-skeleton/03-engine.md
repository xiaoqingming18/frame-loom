# Plan: engine 服务骨架

Status: draft
Parent: plan.md

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

- [ ] T1 以 `@nestjs/schematics` 的 `ts-esm` 应用模板为起点，手动建出 `services/engine`：`package.json` 写 `"type": "module"`，`tsconfig.json` 继承根目录的 `tsconfig.base.json`，并开启 `experimentalDecorators` 和 `emitDecoratorMetadata`，再加上 `nest-cli.json`。不需要的模板内容（`@nestjs/mau`、`deploy` 脚本、示例 controller）不保留。依赖全部写精确版本，`@frame-loom/contracts` 用 `workspace:*` — 验证：`pnpm --filter @frame-loom/engine build` 生成 `dist/main.js`
- [ ] T2 写配置读取：从环境变量取 token 和数据目录，用 zod 校验。token 必须是 64 位十六进制；数据目录必须是绝对路径。校验失败时打印原因，以非零退出码退出 — 验证：不设环境变量运行 `node dist/main.js`，进程以非零码退出，并输出中文错误
- [ ] T3 写数据库模块：用 better-sqlite3 打开数据库，设置 `journal_mode = WAL` 和 `foreign_keys = ON`；在 Nest 监听端口之前，用 `drizzle-orm/better-sqlite3/migrator` 执行 `services/engine/drizzle/` 下的迁移。第一份迁移只建 `app_meta` 表（`key`、`value`），用来记录 schema 版本。迁移文件由 `drizzle-kit generate` 生成后入库。在 `pnpm-workspace.yaml` 的 `allowBuilds` 里登记 better-sqlite3。如果安装后发现它不需要构建，按实际情况写 `false` — 验证：`pnpm install` 没有 `ERR_PNPM_IGNORED_BUILDS` 报错；engine 启动后数据库文件存在，`app_meta` 表存在
- [ ] T4 写鉴权：全局 guard 校验 `Authorization: Bearer <token>`，用 `crypto.timingSafeEqual` 比较；同时校验 `Host` 等于 `127.0.0.1:<实际端口>`。CORS 只放行 renderer 的源，开发模式是 electron-vite 开发服务器的源，打包后是 `app://` 源，源列表通过环境变量 `FRAME_LOOM_ALLOWED_ORIGINS` 传入。不提供免鉴权的接口 — 验证：单测和 e2e 覆盖四种情况：无 token 返回 401；token 错误返回 401；`Host` 错误返回 403；正确请求返回 200
- [ ] T5 写 `HealthController`，`GET /health` 返回 `HealthResponse`。返回前用 contracts 的 schema 做一次 `parse`，确保响应和契约一致 — 验证：e2e 测试断言响应能通过 `HealthResponse.parse`
- [ ] T6 写 `main.ts` 启动流程：读配置 → 执行迁移 → `app.listen(0, '127.0.0.1')` → 读取实际端口 → 如果存在 `process.parentPort` 就上报 ready，否则把端口打印到 stdout，供单独调试用。另外处理 `SIGTERM` 和 parentPort 的退出消息：调用 `app.close()` 并关闭数据库 — 验证：用 PowerShell 设置环境变量后运行 `node dist/main.js`，输出端口；`curl -H "Authorization: Bearer <token>" http://127.0.0.1:<port>/health` 返回 200
- [ ] T7 配置 Vitest，单测和 e2e 共用一套设置。先不加 SWC，跑一个依赖注入用例：controller 注入 service。如果注入结果是 `undefined`，加上 `unplugin-swc`，并把这件事记进本文件的「发现与偏差」 — 验证：`pnpm --filter @frame-loom/engine test` 通过，覆盖鉴权、迁移、健康检查
- [ ] T8 加 `deploy` 脚本：`pnpm --filter @frame-loom/engine deploy --prod <输出目录>`。确认产物里有 `dist/`、`drizzle/`、生产依赖和 contracts 的 `dist`。如果 workspace 依赖没有被正确带上，就开启 `injectWorkspacePackages` — 验证：在产物目录里设置环境变量运行 `node dist/main.js`，`/health` 返回 200
- [ ] T9 提交 `feat(engine): 新增本地服务骨架`，带 `Note:` 和 `Plan:` 尾注 — 验证：`pnpm run verify` 和 `pnpm -r test` 通过

## 验证

- 预期：
  - engine 用 Node 24.22 能单独启动并完成迁移；
  - 无 token 返回 401，`Host` 错误返回 403，正确请求返回 200，且响应符合契约；
  - `deploy` 产物能独立运行。
- 实际：未执行。

## 进度

- 2026-10-24：创建子计划草稿。

## 发现与偏差

无。

## 交接

02 已完成；本计划尚未开始。`@frame-loom/contracts` 已提供 `HealthResponse`、`EngineConnection` 的 schema 与同名类型；开始本计划时先构建 contracts，再通过 `workspace:*` 引用。

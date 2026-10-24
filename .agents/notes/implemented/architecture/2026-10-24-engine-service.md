# Agent Note: 本地 engine 的启动、安全边界与部署

Status: implemented

## Problem

[桌面架构提案](../../proposed/architecture/2026-10-24-desktop-stack-and-process-model.md)中的 engine 需要在桌面壳落地前独立验证：数据库迁移必须先于监听，HTTP 只能由持有令牌的应用访问，生产部署必须带齐 SQLite 原生模块与共享契约。仅通过开发目录启动，无法证明安装包中的独立服务可用。

检索活跃笔记后，桌面架构、[共享契约](../../implemented/architecture/2026-10-24-shared-contracts.md)与[工具链](../../implemented/process/2026-10-24-pnpm-node24-toolchain.md)均为部分重叠，保留各自决定并互链。本篇落实 engine；真实 Electron 对接与退出差异见[桌面壳](2026-10-24-desktop-shell.md)，安装包仍待验证。

## Decision

- 沿用 Nest 官方 `ts-esm` 模板的 ESM、装饰器元数据和 `nest build`，以 Express 适配器运行；生产入口为 `dist/main.js`，测试不进入产物。
- zod 校验环境变量：64 位十六进制 token、绝对数据目录；`FRAME_LOOM_ALLOWED_ORIGINS` 使用 JSON 字符串数组，省略时不允许浏览器源。只接受完整 HTTP(S) 或 `app://<host>` 源，不接受通配符、`null`、凭据和路径。Node 调试请求可以不带 Origin。
- 启动时创建 `data/`、`media/`，打开 better-sqlite3、启用 WAL 和外键，按相对模块位置寻找 `drizzle/` 并迁移。首份迁移由 drizzle-kit 生成表结构，补充 `schema_version=1` 数据初始化；健康检查读取落盘版本。
- 请求边界中间件检查实际 socket 端口对应的 Host 与 Origin，再配置仅允许指定源、GET 与 Authorization 的 CORS。浏览器的 OPTIONS 预检不能携带 Bearer，因此只在 Host 和允许列表中的 Origin 合法时返回预检响应；实际接口由全局 guard 使用等长检查与 `timingSafeEqual` 校验 Bearer，不存在匿名健康接口。缺少 Origin 的 OPTIONS 也拒绝。
- 监听 `127.0.0.1:0` 后上报 `{ type: 'ready', port }`；在普通 Node 中向 stdout 输出同一 JSON。Electron 通过 `process.parentPort` 发送 `{ type: 'shutdown' }` 退出；SIGTERM、SIGINT 同样关闭 Nest 与数据库。启动期间收到退出请求时，等待监听初始化完成再关闭，且不再上报 ready；入口不导入 Electron。Electron 45 的 utilityProcess 在清空监听后仍驻留，因此有 parentPort 时在关闭资源后显式 `process.exit`，启动失败显式退出 1；普通 Node 维持自然退出。
- Vitest 4.1.12 的实际转换保留 Nest 注入所需的元数据，无需 SWC。engine 测试脚本先构建自身和 contracts，黑盒测试直接执行生产入口。
- 根 `deploy:engine` 脚本先构建再执行 `pnpm --filter @frame-loom/engine deploy --prod <输出目录>`。pnpm 12.15.0 已能带齐 contracts，继续保持默认 isolated 链接方式，不启用 `injectWorkspacePackages`。
- better-sqlite3 13.0.3 没有安装生命周期脚本且自带 Node-API 预编译文件，`allowBuilds` 精确登记为 `false`。drizzle-kit 传递依赖的 esbuild 0.18.20 与 0.25.12 安装脚本负责定位／校验平台二进制，按精确版本登记 `true`；保留已有 esbuild 0.28.2 许可，不关闭默认审核。

## 版本依据

2026-10-24 通过 pnpm 查询 npm registry 并核对本机安装包；基于在线查询结果，版本与内容可能随时间变化，实际安装以锁文件为准：

- [Nest core 12.2.0](https://registry.npmjs.org/@nestjs/core/12.2.0)、[Nest schematics 12.0.10](https://registry.npmjs.org/@nestjs/schematics/12.0.10)：实际读取安装包 `dist/lib/application/files/ts-esm/` 的构建与测试模板，保留 ESM 和元数据配置，省略部署平台、示例和多余工具。
- [better-sqlite3 13.0.3](https://registry.npmjs.org/better-sqlite3/13.0.3)、[Drizzle ORM 0.45.4](https://registry.npmjs.org/drizzle-orm/0.45.4)、[drizzle-kit 0.31.11](https://registry.npmjs.org/drizzle-kit/0.31.11)。

## Alternatives considered

- **依赖浏览器的 CORS 限制而不主动拒绝 Origin**：配置少，浏览器会阻止读取响应。但它不阻止请求执行，且不能校验 Host，因此在进入 CORS 和路由前检查边界。
- **OPTIONS 也要求 Bearer**：规则表面统一，但跨源 fetch 的预检没有 Bearer，合法 renderer 也无法调用。仅对经过 Host、Origin 检查的预检允许无 token，不开放实际接口。
- **一开始就给 Vitest 加 SWC**：能生成 Nest 所需元数据，减少测试与生产转换差异。但增加工具依赖，最小注入用例已通过，因此不添加。

## Consequences

- 收益：engine 可独立构建、鉴权访问、迁移和部署；不依赖 Electron 或工作目录，接口响应复用 contracts。测试覆盖生产入口，避免只验证源码转换。
- 代价：Nest 与原生数据库增加依赖和部署体积；启动同步执行迁移，失败时整个服务不可用。这符合迁移完成前不提供服务的边界。
- 桌面主进程需要遵守 JSON 允许源格式与 shutdown 消息。CORS 预检允许无 Bearer 是浏览器协议要求，不能扩展为匿名业务接口。以后新增 HTTP 方法与请求头时，必须同步检查 CORS 列表。
- 发布 schema 改动时在对应迁移中更新 app_meta 的 schema_version，已分发的迁移不可重写。启动代码不覆盖版本或用户元数据。
- Electron 45 的 Node-API 加载与真实 parentPort 的 ready/shutdown 已由桌面壳验证；操作系统信号投递、NSIS 安装和跨平台运行仍待验证。本机测试使用 Node 24.22.1 与 Windows x64。数据目录与令牌不能防御同用户权限下读取进程环境的恶意程序。

## Verification

- `pnpm install --frozen-lockfile`、`pnpm typecheck` 通过；`nest build` 生成 `dist/main.js`，生产输出不含测试。再次执行 `db:generate` 报告无 schema 变更。
- `pnpm -r test` 通过：contracts 43 项、engine 70 项。engine 覆盖配置校验、隐式依赖注入、WAL／外键／幂等迁移／损坏数据库、401／403／200、Origin 和预检，以及生产入口的无配置失败、ready、健康响应和退出清理。parentPort shim 保持活动定时器，验证关闭与启动失败均不依赖句柄自然清空；监听失败保留退出码 1 且数据库已关闭。
- 启动测试使用独立 Node 子进程与仓库外临时工作目录；parentPort、SIGTERM／SIGINT 由 shim 注入，检查退出码、端口关闭与 WAL 清理，包含初始化期间退出不再上报 ready。
- `pnpm deploy:engine` 生成包含 `dist/`、`drizzle/`、生产依赖与 contracts `dist` 的目录；仓库外部署目录通过生产入口测试，无需 workspace 注入。
- 既有 `test:plans` 37 项、`test:commit-convention` 29 项通过，含真实 Git 钩子检查；笔记和计划按项目 `verify` 门禁校验。

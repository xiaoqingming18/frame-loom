# Agent Note: 本地 engine 的启动、安全边界与部署

Status: implemented

2026-11-01 后续[标准剧本与项目 SQLite 重构](../../proposed/architecture/2026-11-01-standard-script-rebuild.md)需要独立的项目数据库生命周期。代码尚未实施；现有应用级数据库、鉴权与部署边界继续有效，本轮不会把剧本写入应用级数据库。

## Problem

[桌面架构](2026-10-24-desktop-stack-and-process-model.md)中的 engine 需要独立验证：数据库迁移必须先于监听，HTTP 只能由持有令牌的应用访问，生产部署必须带齐 SQLite 原生模块与共享契约。仅通过开发目录启动，无法证明安装包中的独立服务可用。

检索活跃笔记后，桌面架构、[共享契约](../../implemented/architecture/2026-10-24-shared-contracts.md)与[工具链](../../implemented/process/2026-10-24-pnpm-node24-toolchain.md)均为部分重叠，保留各自决定并互链。本篇落实 engine；真实 Electron 对接与退出差异见[桌面壳](2026-10-24-desktop-shell.md)，安装分发验证见整体架构。

## Decision

- 项目存储使用 `modules/projects` 与 `ProjectStore`／`LocalProjectStore`。engine 在登记目录内检查 junction／符号链接和 realpath 边界，提供项目、页面、媒体与资产鉴权接口。0006 增加注册表、页面视图和任务归属列，0007 增加任务待复制产物哈希，0008 删除旧画布表，schema_version 为 4；媒体服务由 projects 模块导出，供生成与对象存储解析项目文件；调度启动前完成全局媒体清理，离线产物恢复后清除待复制标记。项目生命周期、revision 冲突、媒体清理与资产边界由真实 SQLite／HTTP 与临时目录测试覆盖；桌面接入与项目画布已按[项目库方案](../../implemented/feature/2026-10-26-project-library.md)完成。

- engine 位于 `apps/engine`，沿用 Nest 官方 `ts-esm` 模板的 ESM、装饰器元数据和 `nest build`，以 Express 适配器运行；生产入口为 `dist/main.js`，测试不进入产物。
- zod 校验环境变量：64 位十六进制 token、绝对数据目录；`FRAME_LOOM_SECRET_KEY` 为可省略、可为空的 64 位十六进制主密钥，未配置时健康检查正常，但 `SecretCipher` 拒绝加解密。桌面主进程用 Electron 45 异步 safeStorage 解封 `<userData>/secret-key.bin` 后经环境变量传入，不经 preload 或 HTTP 返回。`FRAME_LOOM_ALLOWED_ORIGINS` 使用 JSON 字符串数组，省略时不允许浏览器源。只接受完整 HTTP(S) 或 `app://<host>` 源，不接受通配符、`null`、凭据和路径。Node 调试请求可以不带 Origin。
- `src/core/core.module.ts` 是全局模块，提供配置、数据库与鉴权 guard；`src/modules/health/health.module.ts` 声明健康检查。`AppModule.register(config)` 只组合这两个模块，领域模块从 core 获取横切设施。目录约定与 HTTP 基线见[基础设施笔记](2026-10-24-engine-and-renderer-foundation.md)。
- 启动时创建 `data/`、`media/`，打开 better-sqlite3、启用 WAL 和外键，按 `src/package-root.ts` 的包根定位点寻找 `drizzle/` 并迁移；健康服务也从包根读取 `package.json` 版本。drizzle-kit 汇总 `src/**/*.schema.ts`，当前元数据表位于 `src/core/database/app-meta.schema.ts`。首份迁移由 drizzle-kit 生成表结构，补充 `schema_version=1` 数据初始化；健康检查读取落盘版本。
- 请求边界中间件检查实际 socket 端口对应的 Host 与 Origin，再配置仅允许指定源的 CORS，方法为 GET、POST、PATCH、PUT、DELETE，请求头为 Authorization、Content-Type。浏览器的 OPTIONS 预检不能携带 Bearer，因此只在 Host 和允许列表中的 Origin 合法时返回预检响应；实际接口由全局 guard 使用等长检查与 `timingSafeEqual` 校验 Bearer，不存在匿名健康接口。缺少 Origin 的 OPTIONS 也拒绝。
- `core/http/` 提供 `DomainError(code, status, message)`、按参数使用的 `ZodValidationPipe` 与全局 `EngineExceptionFilter`（`APP_FILTER`）。领域异常保留自身状态和代码；zod 错误返回 400、`VALIDATION_FAILED` 与点分路径的 issues；其他 HTTP 异常保留状态、返回 `HTTP_<status>` 和统一中文消息；未知异常返回 500、`INTERNAL`，响应不暴露详情或堆栈。所有错误体符合 contracts 的 `ErrorResponse`，包括由边界中间件 `next(error)` 传出的 403，无需重复写响应。pipe 使用中文默认校验消息，并保留 schema 显式消息。
- `core/logging/engine-logger.ts` 继承 `ConsoleLogger`，默认开启 error、warn、log，全部级别写 stderr。正文、对象与堆栈屏蔽令牌、主密钥、Authorization、x-api-key、api-key、x-goog-api-key；URL 的 key、X-Amz-*、OSS/COS 签名参数也屏蔽。`registerSecret()` 登记运行期明文，`SecretCipher` 在加解密时自动登记；`createEngine` 把同一日志实例交给 Nest 和全局 CoreModule，避免动态屏蔽失效。未知异常详情只进入日志。进程入口的启动／关闭错误也使用脱敏日志，独立运行时 stdout 仅输出一行 ready JSON。`ConsoleLogger.printStackTrace` 实际可能收到 undefined，子类保留这一空值处理，避免错误日志打断关闭清理。
- `core/crypto/secret-cipher.ts` 使用 AES-256-GCM，密文 Buffer 为 `12 字节 IV | 16 字节 tag | ciphertext`；AAD 为 `[table, rowId]` 的 JSON 编码，避免拼接歧义。缺少主密钥返回 `SECRET_KEY_UNAVAILABLE`，密文损坏、错行、错表或主密钥变化返回 `SECRET_DECRYPTION_FAILED`，由领域模块处理为重新填写凭据，不阻止启动。
- `core/events` 提供类型化 EventBus 与鉴权的 `GET /events` SSE。事件来自 contracts 的 EngineEvent，发布时验证；建立连接立即发送 heartbeat，此后每 15 秒一次。`generation.job.updated` 仅携带 jobId，调用方重新查询任务；不持久化或重放事件。取消订阅与应用关闭会释放流和心跳计时器。模型管理的其余模块仍见[模型管理提案](../../proposed/architecture/2026-10-24-model-management.md)。
- 监听 `127.0.0.1:0` 后上报 `{ type: 'ready', port }`；在普通 Node 中向 stdout 输出同一 JSON。Electron 通过 `process.parentPort` 发送 `{ type: 'shutdown' }` 退出；SIGTERM、SIGINT 同样关闭 Nest 与数据库。启动期间收到退出请求时，等待监听初始化完成再关闭，且不再上报 ready；入口不导入 Electron。Electron 45 的 utilityProcess 在清空监听后仍驻留，因此有 parentPort 时在关闭资源后显式 `process.exit`，启动失败显式退出 1；普通 Node 维持自然退出。
- Vitest 4.1.12 的实际转换保留 Nest 注入所需的元数据，无需 SWC。engine 测试脚本先构建自身和 contracts，黑盒测试直接执行生产入口。
- 根 `deploy:engine` 脚本先构建再执行 `pnpm --filter @frame-loom/engine deploy --prod <输出目录>`。pnpm 12.15.0 已能带齐 contracts，仓库继续保持默认 isolated 链接方式，不启用 `injectWorkspacePackages`；Windows 安装分发单独在 deploy 命令加 `--node-linker=hoisted`，避免分发目录链接指回仓库。
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
- 错误响应体由 Nest 默认格式切换为 `ErrorResponse`；同包发布的 renderer 已同步解析中文消息。新调用方必须使用共享契约，不能依赖旧 `statusCode`／`error` 字段。通用 HTTP 异常使用固定中文提示，具体业务提示应通过 `DomainError` 表达；普通运行日志仍保留 Nest 内置文案。
- 发布 schema 改动时在对应迁移中更新 app_meta 的 schema_version，已分发的迁移不可重写。启动代码不覆盖版本或用户元数据。
- Electron 45 的 Node-API 加载与真实 parentPort 的 ready/shutdown 已由桌面壳验证；NSIS 安装后健康检查、正常退出与卸载保留数据库也已通过。操作系统信号投递和跨平台运行仍待验证。本机测试使用 Node 24.22.1 与 Windows x64。数据目录与令牌不能防御同用户权限下读取进程环境的恶意程序。

## Verification

- 模型管理 01：全仓 285 项单测（contracts 77、engine 95、desktop 113）、4 项桌面 e2e、类型／lint／格式／笔记与计划门禁通过。真实 HTTP 覆盖 POST 预检、SSE 的 401、心跳、任务通知与流打开时关闭应用；日志集成测试确认注入的 SecretCipher 登记明文后，Nest 日志和 EngineLogger 都屏蔽该值。开发窗口与加固目录产物明暗健康页、鉴权事件流和正常退出通过；本轮未重做 NSIS 安装／卸载与远端 CI。
- HTTP 基线实现后，`pnpm test` 通过共 172 项（contracts 53、desktop 39、engine 80），类型检查、lint、格式检查及 `verify` 通过。HTTP 测试覆盖领域异常、zod 校验、普通 HTTP 异常、未知异常与 404，并检查原始响应无额外内部字段；错误 Host、错误 Origin、无 Origin 的 OPTIONS 均返回契约化 403。生产入口断言 stdout 仅一行 ready、stderr 无正确／错误令牌，并保留监听失败与退出清理检查；日志测试覆盖全部级别、无堆栈错误、对象与字符串认证值脱敏。
- HTTP 基线的目录打包、1 项桌面 e2e 和真实加固 exe 验证通过：健康状态显示 engine 0.1.0、schema 1；注入测试错误响应后显示中文“访问令牌无效”；关闭后退出码 0，子进程全部退出。默认打包最后一轮停在 Electron 下载／解包阶段，临时通过 `--config.electronDist` 复用已安装的 Electron 45.0.0 完成，未改仓库打包配置或生产 fuse；本轮未重测 NSIS 安装／卸载。
- 调整为 `core/` 与 `modules/health/` 后，原有 70 项 engine 测试、类型检查、lint 和格式检查通过；`db:generate` 无 schema 变化，迁移文件未改。仓库外部署入口的 10 项黑盒测试通过；目录打包、1 项桌面 e2e 与真实加固 exe 均显示 engine 0.1.0、schema 1，关闭退出码 0 且子进程全部退出。
- 迁到 `apps/engine` 后，冻结安装、类型检查及全仓 150 项单测通过；开发窗口、目录打包、desktop e2e 和真实加固 exe 均显示健康状态，关闭后无残留进程。包名、ready/shutdown 与安装后的 `resources/engine` 路径保持不变。
- `pnpm install --frozen-lockfile`、`pnpm typecheck` 通过；`nest build` 生成 `dist/main.js`，生产输出不含测试。再次执行 `db:generate` 报告无 schema 变更。
- `pnpm -r test` 通过：contracts 43 项、engine 70 项。engine 覆盖配置校验、隐式依赖注入、WAL／外键／幂等迁移／损坏数据库、401／403／200、Origin 和预检，以及生产入口的无配置失败、ready、健康响应和退出清理。parentPort shim 保持活动定时器，验证关闭与启动失败均不依赖句柄自然清空；监听失败保留退出码 1 且数据库已关闭。
- 启动测试使用独立 Node 子进程与仓库外临时工作目录；parentPort、SIGTERM／SIGINT 由 shim 注入，检查退出码、端口关闭与 WAL 清理，包含初始化期间退出不再上报 ready。
- `pnpm deploy:engine` 生成包含 `dist/`、`drizzle/`、生产依赖与 contracts `dist` 的目录；仓库外部署目录通过生产入口测试，无需 workspace 注入。
- 既有 `test:plans` 37 项、`test:commit-convention` 29 项通过，含真实 Git 钩子检查；笔记和计划按项目 `verify` 门禁校验。

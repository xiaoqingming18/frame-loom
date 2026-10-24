# 本地 engine

Node.js 24.22.x 下独立运行的 NestJS 12 ESM 服务；已通过 Electron 45 `utilityProcess` 的真实联调。安全边界与取舍见[决策笔记](../../.agents/notes/implemented/architecture/2026-10-24-engine-service.md)。

## 构建与运行

在仓库根目录使用 PowerShell：

```powershell
pnpm --filter @frame-loom/engine... build
$env:FRAME_LOOM_TOKEN = node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('hex'))"
$env:FRAME_LOOM_DATA_DIR = Join-Path $env:LOCALAPPDATA 'FrameLoom-dev'
$env:FRAME_LOOM_ALLOWED_ORIGINS = '["http://localhost:5173"]'
node apps/engine/dist/main.js
```

必填配置：`FRAME_LOOM_TOKEN` 是 64 位十六进制字符串；`FRAME_LOOM_DATA_DIR` 是绝对目录，桌面主进程传 `app.getPath('userData')`。允许源是 JSON 字符串数组；开发时传开发服务器的完整源，打包后例如 `["app://frame-loom"]`，具体主机名由桌面壳统一确定。省略时默认为 `[]`，仅允许不带 Origin 的本地调试请求。

可选配置：`FRAME_LOOM_SECRET_KEY` 是 64 位十六进制主密钥，省略或为空时仍可启动，但拒绝凭据加解密。桌面应用用 safeStorage 保护并持久化主密钥；独立运行时需自行安全保存同一主密钥，不能每次启动随机更换，否则旧凭据无法解密。不要将 token 或主密钥写入日志、URL 或源码。

启动先创建 `<dataDir>/data/` 与 `<dataDir>/media/`，然后在 `data/frame-loom.sqlite` 上启用 WAL、外键并执行入库迁移。迁移失败时非零退出，不提供服务。只有迁移成功并监听 `127.0.0.1:0` 后，stdout 才输出单行 JSON，例如 `{"type":"ready","port":45678}`。`src/core/logging/engine-logger.ts` 继承 Nest `ConsoleLogger`，默认开启 error、warn、log，所有级别都写 stderr；启动与关闭失败也使用它。日志屏蔽令牌、主密钥、认证与厂商密钥头、URL key 和预签名参数；领域模块可用注入的 `EngineLogger.registerSecret()` 登记明文，SecretCipher 加解密时自动登记。不记录请求头。

保持服务运行，在另一个已设置相同令牌的 PowerShell 中测试，替换实际端口：

```powershell
Invoke-RestMethod 'http://127.0.0.1:45678/health' -Headers @{ Authorization = "Bearer $env:FRAME_LOOM_TOKEN" }
```

缺少或错误令牌返回 401，错误 Host 或未允许 Origin 返回 403。Host 必须为 `127.0.0.1:<实际端口>`；不接受 `localhost`。可信浏览器的 OPTIONS 预检无需 Bearer，所有实际接口仍必须携带 Bearer；CORS 允许 GET、POST、PATCH、PUT、DELETE 和 Authorization、Content-Type。健康响应使用 contracts 的 `HealthResponse.parse` 校验，包含包版本、落盘 schema 版本和启动时间。

`GET /events` 是鉴权 SSE 端点，连接时立即发送 heartbeat，随后每 15 秒发送一次；事件 payload 使用 contracts 的 `EngineEvent`。EventBus 发布的 `generation.job.updated { jobId }` 只通知重新查询，不替代任务持久化。断线后调用方负责重连并补拉，取消连接和关闭服务会停止心跳。

所有错误响应使用 contracts 的 `ErrorResponse`：`{ code, message, issues? }`，`issues` 为 `{ path, message }[]`。这是对 Nest 默认错误体的不兼容调整；调用方需同时改为 `ErrorResponse.parse`，健康页已同步显示中文消息，错误体损坏时回退到中文 HTTP 状态提示。

`src/core/http/engine-exception.filter.ts` 由 `CoreModule` 通过 `APP_FILTER` 注册，统一处理路由、guard 和边界中间件的错误：

| 异常                                 | 状态与响应                                                              |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `DomainError(code, status, message)` | 保留领域状态、代码与中文消息                                            |
| `ZodError`                           | 400、`VALIDATION_FAILED`，附字段问题；路径用点连接，例如 `items.0.name` |
| 其他 `HttpException`                 | 保留状态码、`HTTP_<status>`，使用统一中文消息                           |
| 未知异常                             | 500、`INTERNAL`、`本地服务内部错误`；详情和堆栈仅写脱敏日志             |

参数校验按需使用 `ZodValidationPipe`，例如 `@Query(new ZodValidationPipe(schema))`；它返回 schema 解析后的值，使用中文默认校验消息。不注册全局 pipe。

## 主进程对接

engine 不导入 Electron。存在 `process.parentPort` 时，通过 `postMessage({ type: 'ready', port })` 上报端口；主进程使用 `child.postMessage({ type: 'shutdown' })` 请求退出。普通 Node 则从 stdout 读取 ready。SIGTERM、SIGINT 与 shutdown 都关闭 HTTP 和数据库。utilityProcess 不会在清空 Node 句柄后自动退出，因此有 parentPort 时在完成资源关闭后显式结束进程，启动失败以 1 退出；普通 Node 维持自然退出。首次骨架不自动重启服务。

## 迁移与验证

```sh
pnpm --filter @frame-loom/engine db:generate
pnpm --filter @frame-loom/engine test
pnpm typecheck
```

修改 `src/**/*.schema.ts` 后用 drizzle-kit 生成迁移并提交整个 `drizzle/`。当前元数据表定义在 `src/core/database/app-meta.schema.ts`。首份迁移的表结构由工具生成，随后添加 `schema_version=1` 的数据初始化；后续改变 schema 时，在对应迁移中更新这条元数据，不在启动时覆盖版本。不要修改已经分发的迁移。

`src/core/` 放配置、安全边界、数据库、日志、SecretCipher 与 EventBus 等横切设施，由全局 `CoreModule` 提供；健康检查放在 `src/modules/health/`，由 `HealthModule` 声明。`AppModule.register(config, logger)` 只组合模块，日志实例与 Nest 共用。`src/package-root.ts` 统一定位包根，迁移目录与包版本都从这里解析，不随文件深度或工作目录变化。

测试脚本先构建自身及 contracts。Vitest 同时检查环境配置、Nest 元数据注入、真实 SQLite 迁移、HTTP 鉴权与 CORS，以及编译入口的独立启动和关闭。进程测试用本地 shim 模拟 parentPort 和信号事件，并通过活动句柄验证显式退出；真实 Electron 的联调见[桌面壳说明](../../apps/desktop/README.md)，操作系统信号投递和安装包行为仍需后续验证。

## 独立部署

```sh
pnpm deploy:engine .cache/engine-deploy
```

输出目录需为空或尚不存在。产物包括 `dist/`、`drizzle/`、`package.json`、生产依赖与 contracts 的 `dist`，可移出仓库后设置同样的环境变量，再运行 `node <输出目录>/dist/main.js`。入口与迁移位置不依赖当前工作目录；部署包需要 Node 24.22.x。当前部署的是本机平台依赖，跨平台发布需在目标平台构建和验证。

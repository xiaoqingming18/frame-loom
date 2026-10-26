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

## 项目与创作页存储

`modules/projects` 提供鉴权的项目／页面接口，契约见 `packages/contracts/src/projects.ts`，整体设计与尚未实现的阶段见[项目库方案](../../.agents/notes/proposed/feature/2026-10-26-project-library.md)。

- `GET /projects` 返回注册表与 `available | missing | mismatch | unreadable | too_new` 状态；`POST /projects { name, location }` 在已存在的绝对位置下新建项目；`POST /projects/open { rootPath, asCopy?, name? }` 登记已有项目。复制目录的 id 若仍在可用原路径登记，返回 `PROJECT_ALREADY_REGISTERED`，可显式 `asCopy: true` 创建新 id，或用 `name` 解决库内重名。
- `GET /projects/:id` 读取清单；`POST /projects/:id/relocate { rootPath }` 校验 id 后重新定位；`PATCH /projects/:id { name }` 只改显示名；`DELETE /projects/:id` 只删本机注册行和视图，不删项目目录。
- `POST /projects/:id/pages { name }` 创建 revision 1 的空画布；页面 `GET`／`PUT`／`PATCH`／`DELETE` 路径为 `/projects/:id/pages/:pageId`。保存传 `{ revision, document }`，自动补齐全部版本和封面媒体，返回 `{ revision, missing }`，媒体缺失不阻止保存；过期 revision 或外部修改返回 409 `PAGE_REVISION_CONFLICT`，需重新加载。重命名传 `{ name }`；删除移入 `.frameloom/trash/pages/`。
- `PUT /projects/:id/pages/:pageId/view` 接受 `CanvasView`，只写 SQLite 的本机视图，页面 GET 返回文件内容与 `view`。文件夹清单、页面 JSON 是事实来源；SQLite 注册表可通过打开项目重建。

内部 JSON 经项目串行队列写入 `.frameloom/tmp/`，fsync 后 rename，遇 EPERM／EBUSY 最多退避重试 2 秒。清单保留未知字段。页面保存先写页面再写清单，下次读页面修复摘要；多文件操作不是事务。系统回收站和桌面界面待后续阶段；旧画布测试仍可用。

## 项目媒体与资产

以下路径均以 `/projects/:id` 为前缀，实际请求必须带 Bearer。

- `POST /media` 接受 `application/octet-stream`，流式上限 256 MiB（图片沿用 64 MiB）；`POST /media/adopt { sha256: [] }` 从全局、其他已登记项目及回收区复制，返回 `{ missing: [] }`。解析顺序为项目媒体、项目回收区（自动找回）、全局目录；缺少 SQLite 元数据时重新探测。
- 生成请求可带 `projectId`／`pageId`，提交时验证归属；输入与对象存储上传均通过媒体解析器读取。产物写项目，项目离线时写全局暂存；任务 `staged_outputs_json` 记录待复制哈希，项目列表、详情、打开、重新定位和启动恢复时补齐，成功后清除标记。0007 迁移将 schema_version 升至 3。
- `POST /sessions/open`／`close` 标记画布会话；打开期间跳过该项目的自动与手动清理。项目详情、删除页面和关闭会话触发自动清理，无引用媒体移到 `trash/media/`；回收区页面与媒体保留 30 天，`tmp/` 保留 1 小时。引用包括所有页面的全部版本、poster、未结束任务和页面 pending 任务的输入与产物；页面不可读时停止清理。
- `POST /media/cleanup?dryRun=true|false` 默认只统计，返回 `{ files, bytes, skipped }`；执行时直接删除无引用媒体并清空无引用回收媒体。统计为本轮处理文件量，自动清理的移入回收区不等于释放空间。启动调度前清理全局无引用文件，保留未结束任务、未复制暂存和无法确定引用的文件；旧无项目完成任务只保留记录。
- `GET /assets?path=` 列目录；`GET /assets/search?q=` 搜索全项目文件名，最多 500 条并返回 `truncated`。路径使用 `/` 分隔的相对路径，空串表示根；拒绝设备名、越界、内部目录、符号链接与 junction，列表和搜索跳过链接与无权限内容。
- `POST /assets/folders { path, name }`；`POST /assets/files?path=&name=` 二进制上传，4 GiB 上限并检查可用空间，同名自动加 `(2)` 等后缀；`PATCH /assets { path, name }` 重命名；`POST /assets/move { path, destination }` 移动。重命名与移动遇同名报错，不能移入自身或子目录。上传 120 秒超时／中断后清除临时文件。
- `POST /media/from-asset { path }` 仅导入图片、视频；`POST /assets/from-media { sha256, path, name }` 复制导出并自动改同名。上传写完并 fsync 后通过同卷硬链接发布，再清除临时链接；文件移动也先创建目标链接再移除源，防止覆盖外部刚创建的文件，因此需要支持硬链接的本地磁盘（已验证 Windows NTFS）。
- `GET /files/media/:sha256` 与 `GET /files/assets?path=` 使用 `sendFile` 支持 Range，设置 `nosniff`；图片、视频、音频扩展白名单可内联，其余类型以 `application/octet-stream` 附件返回。资产删除由后续桌面主进程回收站实现。

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

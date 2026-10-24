# Agent Note: engine 与 renderer 的目录约定和基础设施

Status: proposed

## Problem

[应用骨架](../../implemented/architecture/2026-10-24-desktop-stack-and-process-model.md)只验证了一个健康页：engine 的 `src/` 是 15 个平铺文件，renderer 只有一个 `main.tsx`，所有组件都写在里面。接下来要连续加入剧本、资产、分镜、出图、出视频等领域能力，之后 Agent 还要包装同一批领域服务（见 [Agent 内核选型](../../proposed/architecture/2026-10-24-agent-runtime-pi.md)）。如果第一个业务能力落地前不定下目录和横切设施，每个模块会各写一套错误格式、校验方式和请求封装，跨模块导入也没有边界。

现状里有几处已知缺口，会在业务出现时直接变成故障：

- engine 的错误响应用的是 Nest 默认格式，contracts 没有错误契约，renderer 只能显示 HTTP 状态码。
- engine 没有统一日志。独立运行时 stdout 输出 ready JSON；而主进程只转发 utilityProcess 的 stderr，stdout 没有人读取。
- renderer 的 `app://` 协议处理函数 `rendererFile` 把请求路径直接映射成文件，未知路径返回 404，不回退到 `index.html`。engine 退出时主进程会调用 `reload()`，如果使用浏览器 history 路由，深层路由重载后就是空白页。
- desktop 只有一份 tsconfig，同时覆盖 main、preload 和 renderer，renderer 代码里写 `process` 也能通过类型检查，运行时却会报错。
- 顶层原 `services/engine` 是自定义约定，已迁到 `apps/engine`。调研的 15 个同类仓库都没有使用顶层 `services/`。

约束：engine 继续保持 ESM、NodeNext、`nest build`（tsc）编译；SQLite 与 Drizzle、zod 契约包、Vitest、TanStack Router/Query、Tailwind 4 都已确定，不在本篇重新选择。

## Proposal

### 仓库布局

- engine 已从 `services/engine` 移到 `apps/engine`。包名 `@frame-loom/engine`、utilityProcess 的 `serviceName` `Frame Loom Engine`、打包后的 `resources/engine` 路径都不变。其余基础设施仍为提案，不视为已实现。
- `pnpm-workspace.yaml` 只保留 `apps/*` 和 `packages/*`。
- renderer 继续留在 `apps/desktop/src/renderer`，不拆成独立包。它只有一个使用者，electron-vite 的约定也是 main、preload、renderer 放在同一个包里。
- 迁移是单独的 `refactor` 提交，不改变任何行为。必须同步的位置：
  - 主进程 `engineEntry` 的开发路径改为 `resolve(appPath, '../engine/dist/main.js')`，同步改对应单测。
  - README、AGENTS.md、engine README 中的命令路径。
  - 活跃笔记里的路径：应用骨架、[engine 服务](../../implemented/architecture/2026-10-24-engine-service.md)、[工具链](../../implemented/process/2026-10-24-pnpm-node24-toolchain.md)、Agent 内核选型。已完成计划中的路径属于当时的执行记录，不改。
  - 提交重新安装后的 `pnpm-lock.yaml`，否则 CI 的 `--frozen-lockfile` 失败。
- 本机 `git mv` 连同未跟踪的 `node_modules` 和 `dist` 一起迁移；旧 `services/` 为空后删除，重新安装修复 workspace 链接。其他副本迁移时仍需先核对残留，再清理旧目录。

### engine 目录

```text
apps/engine/
├─ drizzle/                        # 迁移，由 drizzle-kit 生成并入库
├─ drizzle.config.ts               # schema: './src/**/*.schema.ts'
├─ src/
│  ├─ main.ts                      # 进程入口：parentPort、信号、ready
│  ├─ application.ts               # createEngine：边界中间件、CORS、全局过滤器
│  ├─ app.module.ts                # 只导入 CoreModule 与领域模块
│  ├─ package-root.ts              # 唯一的包根定位点
│  ├─ core/
│  │  ├─ core.module.ts            # @Global：EngineConfig、DatabaseService、EngineGuard
│  │  ├─ config/                   # zod 解析环境变量，EngineConfig 兼作注入令牌
│  │  ├─ security/                 # EngineGuard（Host、Origin、Bearer）与 CORS 配置
│  │  ├─ database/                 # DatabaseService、app-meta.schema.ts
│  │  ├─ http/                     # ZodValidationPipe、DomainError、全局异常过滤器
│  │  └─ logging/                  # 写 stderr 的日志实现
│  └─ modules/
│     └─ health/                   # health.module / controller / service
└─ test/                           # 出现重复代码后再抽测试辅助
```

- `core/` 只放横切设施，不包含业务；`modules/<domain>/` 一个领域一个 Nest 模块。领域模块可以依赖 `core/` 和 contracts，不能导入其他模块的内部文件，需要协作时导入对方模块导出的 service。
- 领域模块文件模板：

  | 文件 | 职责 |
  | --- | --- |
  | `<domain>.module.ts` | 声明 controller、provider 与对外导出 |
  | `<domain>.controller.ts` | 只处理 HTTP：校验入参、调用 service、返回 contracts 类型 |
  | `<domain>.service.ts` | 业务逻辑；Agent 工具只包装这一层 |
  | `<domain>.repository.ts` | 模块内唯一 import drizzle 的文件 |
  | `<domain>.schema.ts` | drizzle 表定义 |
  | `*.test.ts` | 与源码放在同目录 |

- 外部 AI 接口、ffmpeg、文件系统等副作用写成各自的适配器 provider，测试替换这些适配器。数据库测试默认使用临时目录中的真实 SQLite，不整层 mock repository。
- 事务由 service 调用 drizzle better-sqlite3 的同步 `db.transaction()` 发起。
- `package-root.ts` 导出 `new URL('../', import.meta.url)`。迁移目录和 `package.json` 版本都从这里拼接，文件移动到更深的目录时不会算错相对层级。
- engine 内部不配置路径别名，继续使用带 `.js` 后缀的相对导入；tsc 不改写别名，产物运行时无法解析。

### engine 的 HTTP 基线

- contracts 新增 `ErrorResponse`：`{ code: string; message: string; issues?: { path: string; message: string }[] }`。engine 的所有错误响应体都必须符合它，包括鉴权失败和边界检查失败。
- `ZodValidationPipe` 按参数使用，例如 `@Body(new ZodValidationPipe(CreateProject))`，schema 直接复用 contracts。全局 pipe 拿不到各参数的 schema，因此不注册全局 pipe。
- 领域层抛 `DomainError(code, status, message)`。全局 `APP_FILTER` 的映射：

  | 异常 | 响应 |
  | --- | --- |
  | `DomainError` | 自身的 status 与 code |
  | `ZodError` | 400，`VALIDATION_FAILED`，附带 issues |
  | 其他 `HttpException` | 原状态码，`HTTP_<status>` |
  | 未知异常 | 500，`INTERNAL`；堆栈只写日志，不进入响应体 |

  消息使用中文。边界中间件由 `app.use` 注册，它抛出的错误如果不经过 Nest 过滤器，就在中间件里直接写出 `ErrorResponse`。
- 日志继承 Nest `ConsoleLogger`，所有级别都写 stderr，默认级别为 `error`、`warn`、`log`。stdout 只保留独立运行时的单行 ready JSON。token 和 `Authorization` 头永远不写日志。
- 第一个非 GET 接口上线时，CORS 的 `methods` 和 `allowedHeaders`（加 `Content-Type`）必须在同一提交中放开，并补充预检测试。

### renderer 目录

```text
apps/desktop/src/renderer/src/
├─ main.tsx                     # 创建 engine client、QueryClient、router 并挂载
├─ app/                         # providers.tsx、router.tsx
├─ routes/                      # TanStack 文件路由，只放薄路由文件
│  ├─ __root.tsx                # createRootRouteWithContext、布局、错误页、404 页
│  └─ index.tsx
├─ routeTree.gen.ts             # 由 @tanstack/router-plugin 生成并入库
├─ features/<feature>/{api,components,hooks,stores}
│  ├─ engine-status/            # 现有健康检查，显示在设置中心
│  └─ theme/                    # 主题模式读取与切换
├─ components/
│  └─ ui/                       # shadcn 生成的基础组件
├─ assets/                      # logo 等静态资源
├─ lib/
│  ├─ desktop-bridge.ts         # 唯一读取 window.frameLoom 的模块
│  ├─ engine-client.ts          # 唯一接触 engine 连接信息的模块
│  └─ utils.ts                  # cn()
└─ styles/                      # globals.css、theme.css
```

- 应用外壳（标题栏、侧栏、主画布、设置中心弹窗）放在 `app/shell/`，由 `app` 层组合多个 feature，避免 feature 互相导入。主题 token、外壳布局和设置中心的具体规则见[主题系统与应用外壳](../feature/2026-10-24-theme-and-app-shell.md)。
- 依赖方向固定为 `lib`、`components` → `features` → `routes`、`app`。feature 之间不能互相导入，renderer 不能导入 main、preload 或 engine。规则由 ESLint 检查（见 [lint 与格式化](../../implemented/process/2026-10-24-lint-and-format.md)）。
- 路由使用 `createHashHistory()`。路径在 `#` 之后，重载始终请求 `/`，`rendererFile` 和协议处理函数不改。
- 路由文件只负责：用 zod 校验 params 和 search、在 loader 中调用 `ensureQueryData`、把 `component` 指向 feature。
- `engine-client.ts` 导出 `createEngineClient(getConnection)`：
  - 首次请求时从 preload 获取连接并缓存；获取失败时清除缓存，下一次请求重新获取。
  - token 只存在闭包里，不写 storage、cookie 或 URL。
  - `request(path, schema, init)` 默认 5 秒超时，用调用方传入的 schema 解析成功响应；非 2xx 响应按 `ErrorResponse` 解析，抛出 `EngineRequestError { status, code, message }`。
  - SSE 的 `stream()` 在第一个 SSE 端点出现时加入，使用 fetch 读流，token 放请求头。
- engine client 和 QueryClient 通过路由 context 注入，组件和测试都不直接 import 单例。每个 feature 的 `api/` 导出 query key 工厂和 `queryOptions`。mutation 只使精确的 key 失效。QueryClient 默认关闭 `retry` 和 `refetchOnWindowFocus`。
- 服务端数据只走 TanStack Query；Zustand 只保存界面状态和画布编辑状态，在第一个需要它的功能中引入。
- desktop 的 tsconfig 拆成两份：`tsconfig.node.json` 覆盖 main、preload 和配置文件，只有 node 类型；`tsconfig.web.json` 覆盖 renderer，只有 DOM 和 `vite/client`。`@/` 别名指向 `src/renderer/src`，只在 web 配置和 Vite renderer 配置中声明。
- Vitest 分成两个 project：main、preload 使用 node 环境，renderer 使用 jsdom 环境并收集 `.tsx`。组件测试使用 Testing Library，通过路由 context 传入替身 engine client。

### 延后建立

以下设施只约定位置，等第一个使用者出现时再建，不提前写空壳：

- engine：`modules/jobs`（SQLite 任务表、进程内 runner、启动恢复）、`core/events`（类型化事件总线）、`@Sse()` 端点、`modules/agent`。
- renderer：Zustand、`@xyflow/react`、i18n、devtools。shadcn、`cn` 与 lucide 随主题系统和设置中心弹窗一起引入，不再延后。

### 调研依据

2026-10-24 读取 GitHub 仓库目录与原文件，以下为记录时的事实，上游可能变化：

- 后端目录：[openwork](https://github.com/different-ai/openwork) 与 [lobe-chat](https://github.com/lobehub/lobe-chat) 放 `apps/server`，[Novu](https://github.com/novuhq/novu) 放 `apps/api`，[Teable](https://github.com/teableio/teable) 放 `apps/nestjs-backend`；[AFFiNE](https://github.com/toeverything/AFFiNE)、[Twenty](https://github.com/twentyhq/twenty)、[Hoppscotch](https://github.com/hoppscotch/hoppscotch) 放 `packages/`。[Turborepo 仓库结构文档](https://github.com/vercel/turborepo/blob/main/apps/docs/content/docs/crafting-your-repository/structuring-a-repository.mdx)写明 "`apps/` for applications and services"。
- Nest 内部结构：AFFiNE 为 `base/` 横切加 `core/<domain>`；Teable 为 `features/<domain>` 加 `configs/`、`filter/`；[immich](https://github.com/immich-app/immich/tree/main/server) 按层组织，所有副作用放在 `repositories/`，用 zod 解析环境变量而不用 `@nestjs/config`。
- renderer：[shadcn-admin](https://github.com/satnaing/shadcn-admin) 使用 React 19、TanStack 文件路由与 Query、Tailwind 4、Vite 8、Vitest 4，`routes/` 只放薄文件；[bulletproof-react](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) 禁止 feature 互相导入，并用 `import/no-restricted-paths` 检查；[Cherry Studio](https://github.com/CherryHQ/cherry-studio) 在 Electron renderer 中使用 TanStack 文件路由与内存 history。

### 相关笔记核对

- [应用骨架](../../implemented/architecture/2026-10-24-desktop-stack-and-process-model.md)、[engine 服务](../../implemented/architecture/2026-10-24-engine-service.md)、[桌面壳](../../implemented/architecture/2026-10-24-desktop-shell.md)部分重叠：进程模型、鉴权边界和 ready/shutdown 协议都不变；落地时原地同步其中的路径和目录事实，本篇记录新增的目录约定与横切设施。preload API 的扩展和 CSP 调整由[主题系统与应用外壳](../feature/2026-10-24-theme-and-app-shell.md)负责。
- [共享契约](../../implemented/architecture/2026-10-24-shared-contracts.md)部分重叠：继续使用 zod schema 与同名类型的约定，本篇只新增 `ErrorResponse`。
- [工具链](../../implemented/process/2026-10-24-pnpm-node24-toolchain.md)部分重叠：只同步 workspace 目录列表，Node 与 pnpm 的决定不变。
- [Agent 内核选型](2026-10-24-agent-runtime-pi.md)部分重叠：`modules/agent` 的位置与本篇的模块约定一致，只同步路径。
- 其余流程笔记无关。

## Alternatives considered

- **保留 `services/engine`**：不需要任何迁移，现有笔记和命令全部有效。但调研的 15 个同类仓库没有一个使用顶层 `services/`，`apps/` 存放可运行服务有 Turborepo 的明文约定和 4 个仓库的先例。engine 内部路径都相对 `import.meta.url` 解析，迁移只改一处代码路径和文档，现在没有业务代码时成本最低。
- **改名为 `apps/server` 或 `apps/gateway`**：更贴近"本地服务网关"的称呼，和 openwork、lobe-chat 的命名一致。但包名、进程名、e2e 中按进程名查找 pid 的断言和全部文档都要跟着改，名称本身不带来行为差异。
- **engine 按层组织（immich 方式）**：`controllers/`、`services/`、`repositories/` 分目录，所有副作用经 repository 隔离，测试可以整层替换。但 Agent 工具按领域包装 service，按领域分模块后一个模块就是一组工具边界；immich 一次注入 60 多个依赖的 BaseService 在本项目规模下只增加耦合。保留它的 repository 隔离思路，不采用按层目录。
- **整层 mock repository**：单测不碰数据库，运行更快。但临时目录中的真实 SQLite 只需毫秒级初始化，现有 70 项 engine 测试就是这样运行的，还能覆盖迁移和约束；mock 会让 SQL 错误逃过测试。
- **引入 nestjs-zod**：提供全局 pipe、序列化拦截器和 OpenAPI 集成，immich 在用。它与 Nest 12、zod 4 的兼容性尚未验证；手写的按参数 pipe 约 10 行，直接复用 contracts。
- **引入 pino 或 winston**：结构化日志与多输出目标。桌面单用户场景只需要把日志交给主进程，继承内置 `ConsoleLogger` 写 stderr 即可，不增加依赖。
- **协议处理函数回退到 `index.html`，使用浏览器 history**：URL 没有 `#`，和普通 Web 应用一致。但需要修改 `rendererFile` 的路径安全逻辑并补测试，而桌面应用没有地址栏，URL 形态没有用户价值；hash history 不改主进程。
- **renderer 拆成 `apps/web` 或 `packages/ui`**：以后做网页版时可以复用。现在没有第二个使用者，拆包会多一套构建、tsconfig 和 electron-vite 的 root 配置。
- **使用 ts-rest、oRPC 或生成 OpenAPI 客户端**：端点、方法和类型由一处定义，客户端自动获得类型。现在只有一个端点，contracts 中的 zod schema 已能在两端复用；接口达到 3 到 5 个时再评估手写端点描述 `{ method, path, request, response }`，不引入框架。
- **Feature-Sliced Design 全套分层**：`app`、`pages`、`widgets`、`features`、`entities`、`shared` 六层规则完整。项目还没有业务，四层（`lib`/`components`、`features`、`routes`、`app`）已能表达依赖方向，层数随实际需要再加。

## Acceptance criteria

- `services/` 目录不存在，`apps/engine` 构建、测试通过；`pnpm dev` 健康页正常；`package:dir` 产物与 e2e 冒烟通过；加固 exe 能启动并显示健康状态。
- engine 结构调整后，现有 engine 测试全部通过，`db:generate` 报告没有 schema 变化，部署目录的生产入口黑盒测试通过。
- 401、403、400、500 的响应体都能用 `ErrorResponse.parse` 解析，500 响应体不包含堆栈；测试断言日志中没有 token，独立运行时 stdout 只有一行 ready JSON。
- renderer 健康检查迁入 `features/engine-status`，使用 hash 路由；在加固 exe 中手动结束 engine，重载后仍停留在原路由，设置中心里显示中文错误。
- renderer 中引用 `process` 的代码无法通过 `tsconfig.web.json` 的类型检查；renderer 组件测试在 jsdom 中使用替身 engine client 通过。
- `pnpm typecheck`、`pnpm test`、`pnpm lint` 全部通过。

## Risks

- 边界中间件的错误可能绕过 Nest 全局过滤器，403 响应体不符合 `ErrorResponse`；需用测试确认，必要时在中间件中直接写响应。
- Nest 12 的 `ConsoleLogger` 可能无法通过子类把全部级别改写到 stderr；不行时改为实现约 20 行的 `LoggerService`。
- 错误响应体格式改变，renderer 必须同时改为解析 `ErrorResponse`。engine 与 renderer 在同一安装包内发布，不需要兼容旧格式。
- `@tanstack/router-plugin` 在 electron-vite 中的 root 与 cwd 不同，`routesDirectory` 和 `generatedRouteTree` 必须写绝对路径，否则可能在错误位置生成路由树。
- 迁移、engine 结构调整和 renderer 骨架都会影响开发路径或打包产物，每一步都要重跑加固 exe 的启动验证，自动 e2e 不能替代。
- 回滚：每一步是独立提交，可以单独 revert；迁移提交被 revert 时，需要同时恢复锁文件并重装依赖。

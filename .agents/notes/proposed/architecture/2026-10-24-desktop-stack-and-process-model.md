# Agent Note: 桌面应用技术栈、进程模型与仓库骨架

Status: proposed

## Problem

Frame Loom 要做多模态 AI 影视工作台：剧本、角色和场景资产、分镜、出图、出视频、合成，后期由 Agent 串起全流程。仓库目前只有笔记和流程工具，没有应用代码。动手前需要定下几件事：桌面壳、界面、本地服务、数据库、媒体处理、进程之间怎么通信、仓库怎么分包。这些决定会落到跨进程契约、落盘格式和打包方式上，事后改动的成本高。

约束：

- 先做剧本、分镜、出图、出视频等基础能力。Agent 全流程自动化后期再接入，到时手动界面和 Agent 要调用同一批能力。
- 视频生成是耗时几分钟的远程异步任务，应用重启后不能丢。
- 本地服务会持有用户的模型 API Key 和素材文件，本机其他程序和浏览器页面不能随意访问它。
- Agent 内核选 pi（见 [Agent 内核选型](2026-10-24-agent-runtime-pi.md)），pi 只发布 ESM，要求 Node 22.19 以上。NestJS 12 也只发布 ESM。
- 工具链已切到 pnpm 和 Node 24.22（见 [工具链笔记](../../implemented/process/2026-10-24-pnpm-node24-toolchain.md)）。

## Proposal

### 参考依据

2026-10-24 解包了本机安装的竞品 MiniMax Design 3.0.14（`D:\Program Files\hailuo\MiniMax Design\current\resources`），观察到的结构如下：

- Electron 43.1.0，用 electron-vite 构建。窗口开启 `contextIsolation` 和 `sandbox`，关闭 `nodeIntegration`，界面通过 `app://` 协议加载。
- 渲染层用 React 19、TanStack Router 和 Query、Zustand、`@xyflow/react`。
- NestJS 网关跑在 Express 上，打成一个 16 MB 的 `gateway/dist/main.js`，用 better-sqlite3 和手写 SQL 迁移。主进程以 `ELECTRON_RUN_AS_NODE=1` 启动它，固定监听 8001 端口。
- 内置 `opencode.exe` 作为 Agent，另外自带 ffmpeg 和 ffprobe。

开源项目参考：

- [OpenWork](https://github.com/different-ai/openwork)：Electron、React，加一个本地服务。
- [火宝短剧](https://github.com/chatfire-AI/huobao-drama)：用 `utilityProcess` 托管后端，后端用 better-sqlite3 加 Drizzle。它为了拿到 better-sqlite3 的预编译包，把 Electron 锁在 37.x。
- [LocalMiniDrama](https://github.com/xuanyustudio/LocalMiniDrama)：本地 SQLite，列表视图和画布视图共用同一份数据。

### 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面壳 | Electron 45.x，精确锁定版本，用 electron-vite 构建 |
| 渲染层 | React 19、TanStack Router 和 Query、Tailwind 加 shadcn 风格组件、Zustand；画布用 `@xyflow/react` |
| 本地服务 engine | NestJS 12 加 Express 适配器，整体 ESM，运行在 Electron `utilityProcess` 里 |
| 数据库 | SQLite（WAL 模式）、better-sqlite3 13.x、Drizzle ORM，迁移文件由 drizzle-kit 生成后入库 |
| 媒体 | 自带 ffmpeg 和 ffprobe 二进制，图片处理用 sharp |
| AI 接入 | engine 内自写一层 Provider 适配，统一文本、图片、视频接口；视频生成走 SQLite 任务表 |
| 共享契约 | `packages/contracts` 用 zod 定义 schema 和类型，renderer 和 engine 都只认这一份 |
| 打包和更新 | electron-builder 打 NSIS 安装包；更新用 electron-updater，首个里程碑不接入 |
| 测试 | Vitest 跑单元和契约测试；Playwright 的 `_electron` 跑打包后的冒烟测试 |

2026-10-24 在 npm 上查到的最新版本，作为初始锁定版本的参考：electron 45.0.0、electron-vite 6.0.0、@nestjs/core 12.2.0、better-sqlite3 13.0.3、drizzle-orm 0.45.4、drizzle-kit 0.31.11、@playwright/test 1.64.1。安装时以锁文件为准。

### 进程模型与通信契约

```text
Electron 主进程 ──utilityProcess.fork──> engine（NestJS，Electron 内置 Node 24.22）
     │  ready: { port }  <──parentPort──      │ 监听 127.0.0.1:<随机端口>
     │                                         │ SQLite / 文件存储 / Provider / 任务表
     └─ ipcMain.handle('engine:connection') ─> preload（contextBridge）─> renderer
                                                  renderer ──HTTP + Bearer token──> engine
```

- 主进程启动时用 `crypto.randomBytes(32)` 生成一次性 token，通过环境变量交给 engine，同时传入 `FRAME_LOOM_DATA_DIR`。
- engine 只监听 `127.0.0.1`，端口填 0 让系统分配。监听成功后，通过 `process.parentPort.postMessage({ type: 'ready', port })` 把实际端口告诉主进程。主进程收到之前，renderer 拿不到连接信息。
- engine 的每个请求都要校验三项：`Authorization: Bearer <token>`；`Host` 必须是 `127.0.0.1:<port>`，用来防 DNS rebinding；CORS 只放行应用自己的源。三项都不满足的请求一律拒绝，不存在免鉴权的接口，`/health` 也要鉴权。
- preload 只通过 `contextBridge` 暴露 `frameLoom.getEngineConnection()`，返回 `{ baseUrl, token }`。不暴露 `ipcRenderer`，也不暴露 Node 能力。
- 实时推送用 SSE（Nest 的 `@Sse()`）。浏览器原生的 `EventSource` 不能带请求头，所以 renderer 用 `fetch` 读流来消费 SSE，token 始终放在请求头里，不放进 URL。界面发出的命令都走普通 HTTP。
- engine 退出时，主进程记录退出码，并把状态告诉 renderer。首个里程碑不自动重启 engine。

### 数据位置

- 数据库：`<userData>/data/frame-loom.sqlite`。迁移在 engine 启动时、开始监听之前执行，迁移失败则 engine 退出，不提供服务。
- 生成的媒体文件：`<userData>/media/`，按内容 SHA-256 命名。首个里程碑只建目录，暂不写入文件。
- 开发模式也使用 Electron 的 `userData`，不往仓库目录里写数据。

### 模块格式

| 位置 | 格式 | 说明 |
| --- | --- | --- |
| `services/engine` | ESM：`"type": "module"`，`module` 和 `moduleResolution` 都设为 `nodenext` | 以 Nest 官方 `ts-esm` 模板为起点，用 `nest build`（tsc）编译。相对路径 import 要写 `.js` 后缀。 |
| `packages/contracts` | ESM，用 tsc 编译出 JS 和 `.d.ts` | `exports` 声明 `types` 和 `default` 两个条件 |
| Electron 主进程 | ESM | 应用 ready 之前要完成的工作都必须 `await` |
| preload | 打包成 CommonJS | sandbox 模式下的 preload 不支持 ESM。Electron 45 还移除了 sandbox preload 里的 `Buffer`、`events`、`timers`、`url` |
| renderer | 由 Vite 打包 | — |

- TypeScript 锁在 6.x。TypeScript 7 不提供编译器 API，`nest build` 用不了。
- 2026-10-24 在 Node 22.23.2 上实测：pi 的 `exports` 只有 `import` 条件，CommonJS 里写 `require('@earendil-works/pi-agent-core')` 会报 `ERR_PACKAGE_PATH_NOT_EXPORTED`；在 ESM 里 `import` 则可以正常构造 `Agent`。所以 engine 不能用 CommonJS。

### 仓库骨架

```text
frame-loom/
├─ apps/desktop/          # electron-vite：src/main、src/preload、src/renderer
├─ services/engine/       # NestJS：health、鉴权、SQLite 迁移；以后的领域服务和 agent 模块
│  └─ drizzle/            # 入库的迁移文件
├─ packages/contracts/    # zod schema 与类型
└─ pnpm-workspace.yaml
```

- 包名：`@frame-loom/desktop`、`@frame-loom/engine`、`@frame-loom/contracts`。
- `packages/contracts` 已实现，字段、校验边界和构建约定见[共享契约包](../../implemented/architecture/2026-10-24-shared-contracts.md)。`services/engine` 已可独立运行，启动、安全边界与部署见[engine 服务](../../implemented/architecture/2026-10-24-engine-service.md)；本篇仍跟踪完整应用骨架，桌面壳与安装包待实现。
- desktop 的运行时依赖全部由 electron-vite 打进产物，`dependencies` 保持为空，这样 electron-builder 不需要收集 pnpm 的 `node_modules`。
- engine 用 `pnpm deploy --prod` 生成一个独立目录，作为 electron-builder 的 `extraResources` 放进安装包。打包后的路径是 `process.resourcesPath/engine`，开发模式下用 `services/engine/dist`。
- 打包时通过 electron-builder 的 `electronFuses` 关闭以下开关：`runAsNode`、`enableNodeOptionsEnvironmentVariable`、`enableNodeCliInspectArguments`。同时打开 `onlyLoadAppFromAsar` 和 ASAR 完整性校验。这样别的程序就不能把安装好的 exe 当作普通 Node 运行时来用。`utilityProcess` 不依赖 `runAsNode`。
- 首个里程碑不做插件机制，不把 engine 打成单文件，也不建 `resources/bin`。ffmpeg 等到第一个媒体能力落地时再加进来。

### 开放问题（首个里程碑验证）

- `utilityProcess.fork()` 能否直接加载 ESM 入口。不行的话，加一个 `.cjs` 引导文件，在里面 `await import()` 真正的入口。
- Vitest 4.1.12 实测能完成 controller → service 的隐式注入，无需 `unplugin-swc`；生产入口同样通过健康检查。
- pnpm 12.15.0 的 `pnpm deploy --prod` 实测能正确带上 `@frame-loom/contracts` 的产物，无需开启 `injectWorkspacePackages`。
- better-sqlite3 13 的 Node-API 预编译包在 Electron 45 的 `utilityProcess` 里能否直接加载。
- 打开 `onlyLoadAppFromAsar` 和 ASAR 完整性校验后，`utilityProcess` 还能否从 asar 外部的 `resources/engine` 加载入口。
- Playwright 的 `_electron` 能否启动 Electron 45 打包后的应用，尤其是在关闭 `enableNodeCliInspectArguments` 之后。如果这个 fuse 让 Playwright 连不上，冒烟测试改为启动 `electron-vite build` 的产物，打包后的 exe 改为人工验证。

## Alternatives considered

- **本地服务用 Hono 加 zod**：依赖少，可以用 esbuild 打成单文件，火宝短剧验证过这条路，产物也比 Nest 小得多。用户明确选了 NestJS：它的依赖注入和模块边界适合后期领域服务多、还要接 Agent 工具层的情况，竞品也用它。体积代价接受。
- **用 `ELECTRON_RUN_AS_NODE=1` 起子进程跑服务**（竞品做法）：行为和普通 Node 子进程一样，经验多。`utilityProcess` 是 Electron 官方提供的服务进程 API，自带 `parentPort` 消息通道，不需要额外的 IPC 或 stdout 协议，所以选它。
- **把 NestJS 直接跑在主进程里**（fast-vite-nestjs-electron 模板）：少一个进程，也不用管端口和 token。代价是 engine 里的同步 SQLite 调用、图片处理和崩溃都会卡住或带崩窗口管理，所以不采用。
- **固定端口 8001**（竞品做法）：实现最简单，调试时地址固定。缺点是可能和别的程序冲突，而且本机任意网页都能探测到这个端口。随机端口加 token 只多一小段握手代码。
- **engine 用 CommonJS，pi 用 `await import()` 加载**：保留 Nest 传统的写法和测试工具。但 Nest 12 本身已经要靠 `require(esm)` 才能在 CommonJS 里运行，pi 也只能异步加载，类型只能 `import type`，等于混用两种格式，没有得到任何好处。
- **把 engine 打成 CommonJS 单文件**：安装包里文件少，`node_modules` 体积可以靠 tree-shaking 压下来。缺点是任何依赖一旦用了顶层 `await` 就打不了包，Nest 的可选依赖也会被动态 `require`。等安装包体积真成问题时，再在 tsc 产物上做 tree-shaking。
- **实时推送用 WebSocket**：双向通信，竞品也用。当前的推送都是 engine 单向发给界面（Agent 流式输出、任务进度），SSE 用原生 HTTP 就能做，鉴权方式也和普通请求一致。出现真正的双向需求时再加 WebSocket。
- **Nest 用 Fastify 适配器**：吞吐更高。本地单用户场景用不上这点性能差距，Express 是 Nest 默认适配器，生态和资料都更多。
- **用 Velopack 打包和更新**（竞品做法）：支持增量更新。electron-builder 加 electron-updater 的资料和社区经验更多，首个里程碑也不做更新。
- **Python 后端**（Jaaz 做法）：可以直接用 Python 的 AI 和媒体生态。代价是要多打包一个 Python 运行时，和 TypeScript 契约也共享不了，所以不采用。

## Acceptance criteria

- 开发模式下 `pnpm dev` 能打开窗口。主进程拉起 engine，engine 完成 SQLite 迁移后上报端口，界面显示 `/health` 的结果，结果里包含 engine 版本和数据库迁移版本。
- 不带 token 访问 engine 返回 401；`Host` 不对的请求被拒绝。
- 渲染层里 `window.require`、`process`、`ipcRenderer` 都不可用。
- 打包出的 NSIS 安装包装好后行为和开发模式一致，数据库落在 `<userData>/data/`。
- Vitest 覆盖 contracts 的 schema、engine 的鉴权守卫、迁移执行。Playwright 冒烟测试能启动打包后的应用，并读到健康状态。

## Risks

- Electron 45.0.0 刚发布两天，可能碰到早期问题。版本精确锁定，跟进补丁版。严重阻塞时退回 44.x：两者内置的 Node 都是 24.22.0，退回不影响 engine。
- 上面列的开放问题里任何一项不通过，都只改骨架配置，各自有退路，不改变本篇的选型。
- NestJS 加 pi 加多厂商 SDK 会让 `node_modules` 偏大。实测 pi 的两个包装出来有 66.2 MB。这个风险接受，等安装包体积成为问题再做 tree-shaking。
- 鉴权只防本机其他进程和网页，防不住和用户同权限、能读进程环境变量的恶意程序。桌面应用接受这个边界。

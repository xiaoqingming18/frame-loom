# Agent Note: 桌面应用技术栈、进程模型与仓库骨架

Status: implemented

## Problem

Frame Loom 要做多模态 AI 影视工作台：剧本、角色和场景资产、分镜、出图、出视频、合成，后期由 Agent 串起全流程。基础骨架需要统一桌面壳、界面、本地服务、数据库、进程通信与仓库分包的边界，并证明安装后也能独立运行。这些决定会落到跨进程契约、落盘格式和打包方式上，事后改动的成本高。

约束：

- 先做剧本、分镜、出图、出视频等基础能力。Agent 全流程自动化后期再接入，到时手动界面和 Agent 要调用同一批能力。
- 视频生成是耗时几分钟的远程异步任务，应用重启后不能丢。
- 本地服务会持有用户的模型 API Key 和素材文件，本机其他程序和浏览器页面不能随意访问它。
- 后续 Agent 内核方案选 pi（见 [Agent 内核选型](../../proposed/architecture/2026-10-24-agent-runtime-pi.md)），pi 只发布 ESM，要求 Node 22.19 以上。NestJS 12 也只发布 ESM；本里程碑不安装 pi。
- 工具链已切到 pnpm 和 Node 24.22（见 [工具链笔记](../../implemented/process/2026-10-24-pnpm-node24-toolchain.md)）。

## Decision

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

| 层 | 当前实现 | 后续边界（未实现） |
| --- | --- | --- |
| 桌面壳 | Electron 45.0.0，electron-vite 6.0.0 | 运行时升级单独验证 |
| 渲染层 | React 19、TanStack Router 和 Query、Tailwind 的健康状态页 | shadcn 风格组件、Zustand、`@xyflow/react` 等到业务需求再引入 |
| 本地服务 engine | NestJS 12 加 Express，整体 ESM，运行在 `utilityProcess` 中 | 领域服务和 Agent 模块 |
| 数据库 | SQLite WAL、better-sqlite3 13.0.3、Drizzle，生成的迁移入库 | 业务表和任务恢复 |
| 媒体 | 仅建立空 `media/` 目录 | ffmpeg、ffprobe、sharp 和按 SHA-256 存储媒体 |
| AI 接入 | 无 | Provider 适配与 SQLite 视频任务表 |
| 共享契约 | zod schema 和类型，renderer 与 engine 共用 | 业务契约随能力扩展 |
| 打包和更新 | electron-builder 26.18.0，Windows x64 NSIS | 不接签名、发布、electron-updater 或自动更新 |
| 测试 | Vitest 单元和契约测试；Playwright `_electron` 启动构建产物 | 加固 exe 与安装／卸载另行本地验证，未接入 CI 自动安装 |

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
- engine 实际接口校验 `Authorization: Bearer <token>`；`Host` 必须是 `127.0.0.1:<port>`，防止 DNS rebinding；携带 Origin 时必须匹配应用自己的完整源。任一校验不满足即拒绝，`/health` 同样鉴权。浏览器可信 OPTIONS 预检不带 Bearer，仅在 Host 和 Origin 都合法时放行，不扩展为匿名业务接口；允许源由主进程以 JSON 数组传入。
- preload 只通过 `contextBridge` 暴露 `frameLoom.getEngineConnection()`，返回 `{ baseUrl, token }`。不暴露 `ipcRenderer`，也不暴露 Node 能力。
- 后续实时推送约定用 SSE（Nest 的 `@Sse()`），当前没有推送端点。浏览器原生 `EventSource` 不能带请求头，因此使用 `fetch` 读流，token 始终放请求头，不放 URL；命令走普通 HTTP。
- engine 退出时，主进程记录退出码，重载当前健康页以显示中文错误。此捷径只适用于无业务状态的单页，引入有状态页面时改为类型化事件。当前不自动重启 engine；启动等待上限为 30 秒，退出先发 shutdown，最多等 5 秒后强杀。

### 数据位置

- 数据库：`<userData>/data/frame-loom.sqlite`。迁移在 engine 启动时、开始监听之前执行，迁移失败则 engine 退出，不提供服务。
- 媒体目录：`<userData>/media/`，当前只建目录，不写文件；内容 SHA-256 命名属于后续能力。
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
- 字段、校验边界和构建约定见[共享契约包](../../implemented/architecture/2026-10-24-shared-contracts.md)；服务启动、安全边界与部署见[engine 服务](../../implemented/architecture/2026-10-24-engine-service.md)；可信页面、生命周期和真实联调见[桌面壳](../../implemented/architecture/2026-10-24-desktop-shell.md)。本篇汇总整体骨架与分发约定，不取代三篇具体边界。
- desktop 的运行时依赖全部由 electron-vite 打进产物，`dependencies` 保持为空，这样 electron-builder 不需要收集 pnpm 的 `node_modules`。
- engine 用 `pnpm deploy --prod` 生成一个独立目录，作为 electron-builder 的 `extraResources` 放进安装包。打包后的路径是 `process.resourcesPath/engine`，开发模式下用 `services/engine/dist`。
- 打包时通过 electron-builder 的 `electronFuses` 关闭以下开关：`runAsNode`、`enableNodeOptionsEnvironmentVariable`、`enableNodeCliInspectArguments`。同时打开 `onlyLoadAppFromAsar` 和 ASAR 完整性校验。这样别的程序就不能把安装好的 exe 当作普通 Node 运行时来用。`utilityProcess` 不依赖 `runAsNode`。
- 首个里程碑不做插件机制，不把 engine 打成单文件，也不建 `resources/bin`。ffmpeg 等到第一个媒体能力落地时再加进来。
- Windows x64 打包使用 electron-builder 26.18.0；`files` 仅纳入桌面构建产物和 package.json。`pnpm package:win` 构建 contracts、engine，使用 `pnpm deploy --prod --force --node-linker=hoisted` 重新生成 `apps/desktop/build/engine`，再构建 desktop 并打 NSIS。按用户安装，卸载保留 userData，不接签名与发布；electron-winstaller 只用于 Squirrel，其 5.4.0 安装脚本明确禁用，本项目不使用 Squirrel。
- 部署阶段单独使用 `--node-linker=hoisted` 生成无 pnpm 目录链接的生产树，仓库开发依赖仍采用 isolated。extraResources 从 `build` 匹配 `engine/**/*`，避免 electron-builder 默认跳过复制源根部的 `node_modules`；不引入复制脚本或更改全仓依赖布局。
- Playwright 1.64.1 的 `_electron` 依赖主进程 `--inspect`。关闭该 fuse 后连接打包 exe 超时，因此使用同版未加固的 Electron 启动 electron-vite 构建产物；测试使用独立临时 userData，不改生产 fuse，也不写开发数据。目录参数去掉 Windows 尾部反斜杠，避免 launch 失败。`vitest` 仅收集 `src/**/*.test.ts`，不误收 Playwright 用例。
- `.github/workflows/build.yml` 在 Windows 上冻结安装、执行单元测试和类型检查、构建 NSIS、执行 Playwright 冒烟并上传 exe，仅生成构建产物，不发布。

### 打包参考依据

2026-10-24 在线查询并核对本机安装包；基于在线查询结果，版本与内容可能随时间变化，以锁文件和实测为准：

- [electron-builder 26.18.0](https://registry.npmjs.org/electron-builder/26.18.0)、[配置](https://www.electron.build/docs/configuration)、[NSIS](https://www.electron.build/docs/nsis)：核对资源复制、fuse 与卸载保留数据选项；本机 `app-builder-lib/out/util/filter.js` 确认根部 `node_modules` 被跳过。
- [Playwright 1.64.1](https://registry.npmjs.org/@playwright/test/1.64.1)、[Electron 测试说明](https://playwright.dev/docs/api/class-electron)：明确要求 `EnableNodeCliInspectArguments` 不为 false，与本次超时结果一致。
- [Electron fuse 说明](https://www.electronjs.org/docs/latest/tutorial/fuses)：utilityProcess 可替代依赖 `runAsNode` 的 fork；五项 fuse 通过读取最终 exe 验证。

### 运行与分发结论

- Electron 45 的 `utilityProcess.fork()` 已直接加载 ESM 入口，无需 `.cjs` 引导。关闭 HTTP／数据库后 utilityProcess 仍不自然退出，engine 在 parentPort 环境下清理完资源后显式退出；启动失败同样非零退出。
- Vitest 4.1.12 实测能完成 controller → service 的隐式注入，无需 `unplugin-swc`；生产入口同样通过健康检查。
- pnpm 12.15.0 的 `pnpm deploy --prod` 实测能正确带上 `@frame-loom/contracts` 的产物，无需开启 `injectWorkspacePackages`。
- better-sqlite3 13.0.3 的 Node-API 预编译包可在 Electron 45 的 utilityProcess 中直接加载，完成迁移和健康检查；asar 外部署及 NSIS 安装后的独立目录同样可用，无需重编译。
- `onlyLoadAppFromAsar` 和 ASAR 完整性校验只约束应用加载，不阻止 utilityProcess 从 asar 外部的 `resources/engine` 启动 ESM 服务；五项 fuse 保持启用目标值。
- Playwright 依赖主进程调试，与生产 fuse 冲突。自动冒烟按已约定回退测试构建产物，加固 exe 与真实安装另行本地验证；没有为了测试关闭加固。
- 安装在仓库外的 NSIS 应用使用 `%APPDATA%\Frame Loom\data\frame-loom.sqlite`；关闭后 engine 以 0 退出、WAL 清理且无残留，卸载保留数据库，卸载前后 SHA-256 一致。

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
- **在所有环境使用 isolated 部署树**：开发与分发保持一致，沿用已有 `deploy:engine` 即可。但 Windows 目录链接可能指回原部署目录，NSIS 分发需要自足的物理文件；仅分发部署指定 hoisted，避免改变全仓或添加链接复制器。
- **为 Playwright 保留生产主进程调试**：能直接自动化加固 exe，覆盖面一致。但违反已经确定的 fuse 边界；使用构建产物自动冒烟，并单独验证真实加固安装包，接受两条验证路径的维护成本。

## Verification

- Node 24.22.1、pnpm 12.15.0、Windows 11 x64（10.0.26200）：冻结安装、类型检查、150 项应用单测通过（contracts 43、engine 70、desktop 37）；37 项计划测试与 29 项提交规范测试通过。
- 桌面壳已完成干净克隆开发启动与 `app://` 构建预览验证；主进程托管 engine，健康响应显示版本与迁移版本。engine 单测覆盖 401、错误 Host／Origin 的 403、可信预检和迁移幂等性。
- `pnpm --filter @frame-loom/desktop package:dir` 和重复执行的 `pnpm package:win` 均成功。最终 asar 仅含 `out/` 和 package.json；读取 exe 验证五项 fuse。`resources/engine/node_modules` 扫描为 7,676 个文件、零目录链接，部署入口黑盒 10 项通过。
- 加固 win-unpacked 和仓库外 NSIS 安装目录均以真实 exe 启动，窗口显示 engine 0.1.0、schema 1；renderer 调试断言 Node 全局不可用、preload 方法边界、无／错误 token 的 401、新窗口与外部导航被阻止。截图已检查，页面无横向溢出。关闭后无同路径进程残留。
- NSIS 静默安装与卸载退出码为 0；数据库位于 `%APPDATA%\Frame Loom\data\frame-loom.sqlite`，应用正常退出后 WAL 消失，卸载前后数据库 SHA-256 不变。测试使用仓库外的专用临时安装目录，不依赖仓库 node_modules。
- `pnpm --filter @frame-loom/desktop test:e2e` 的 1 项自动冒烟通过：构建页面健康状态、非空版本、隔离全局、独立临时 userData 和 engine 退出。`pnpm run verify` 校验笔记与计划；真实窗口验证脚本、日志和截图位于忽略的 `.cache/`。
- GitHub Actions 仅完成本地审阅，远端尚未执行；本次未验证 Windows 10、其他架构或系统。Windows 窗口工具缺少运行模块，因此安装／卸载使用 NSIS 静默命令，窗口通过 renderer 调试与截图检查，不宣称完成人工点击安装向导。

## Consequences

- 收益：开发、构建和安装后的同一套进程边界可运行；engine 与迁移自足分发，数据离开安装目录存储且卸载保留，生产加固不因测试而降级。
- 代价：Electron 与 Nest 带来安装和压缩成本；最终 NSIS 为 137,197,461 字节（130.84 MiB），engine 生产依赖为 53,885,998 字节（51.39 MiB）。体积仅记录，不设门槛；真的形成分发成本问题时再评估依赖裁剪与 tree-shaking，当前不安装 pi 或厂商 SDK。
- 首次打包需要下载 Electron、NSIS 和压缩工具。未接代码签名、发布、自动更新，使用默认图标；这些不属于已完成能力。
- 主进程等待 engine 最多 30 秒，首轮部署出现过超过原定 15 秒的冷启动。仍保留超时失败和关闭回收，不将等待改为无限期。
- Playwright 自动冒烟与加固 exe 安装验证分开，自动用例不能证明 NSIS 安装行为；修改打包、fuse、原生模块或 engine 部署时需要重跑真实安装验证。CI 尚不自动安装，远端结果不能由本地验证替代。
- Electron 45.0.0 处于早期版本，精确锁定并跟进补丁；运行时升级单独验证。后续媒体、Provider、任务恢复、SSE 与 Agent 能力仍未实现，相关选型不能当成现有功能。
- 鉴权只防本机其他进程和网页，防不住和用户同权限、能读进程环境变量的恶意程序。桌面应用接受这个边界。

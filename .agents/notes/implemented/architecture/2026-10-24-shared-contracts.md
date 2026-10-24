# Agent Note: 共享契约包与最小验证边界

Status: implemented

## Problem

engine 的 HTTP 响应与主进程传给 renderer 的连接信息跨越进程边界。只共享 TypeScript 接口无法检查运行时收到的数据，分别定义 schema 又可能让调用双方逐渐不一致。需要落实[桌面应用架构](2026-10-24-desktop-stack-and-process-model.md)中的 contracts 包，让 engine 和 desktop 使用同一入口。

本篇只记录 contracts 的具体边界；完整桌面架构仍由上文跟踪。检索活跃笔记后，架构提案属于部分重叠，互相链接；已实现的工具链笔记保留 Node 与 pnpm 决定，不重复记录。

## Decision

- `packages/contracts` 发布为私有 ESM workspace 包 `@frame-loom/contracts`，由 tsc 输出 `dist/index.js` 与 `.d.ts`；入口 `exports` 只有 `types`、`default`，分发文件只含 `dist`。相对导出写 `.js` 后缀。
- 用 zod 定义同名的 schema 值和推导类型 `HealthResponse`、`EngineConnection`、`ErrorResponse`。调用方使用 `parse` 检查外部数据，类型直接从 schema 推导。
- `HealthResponse` 要求 `status: 'ok'`、字符串 `engineVersion` 与 `schemaVersion`，以及带时区的 ISO 日期时间 `startedAt`；接受 `Z` 和显式时区偏移，不接受无时区时间或无效日期。
- `EngineConnection.baseUrl` 只接受字面形式 `http://127.0.0.1:<port>`，端口为 1–65535 的十进制整数，不允许前导零、路径、用户信息、查询或片段。这样校验不会把其他主机或附加内容正规化成可信连接。`token` 只要求非空字符串；生成和鉴权规则属于 engine／主进程，不在此实现。
- `ErrorResponse` 要求字符串 `code`、`message`，可选 `issues` 是 `{ path: string; message: string }[]`，不把 HTTP 状态码重复放入响应体。engine 统一错误映射与 stderr 日志见[engine 服务](2026-10-24-engine-service.md)；renderer 健康检查解析此契约，响应损坏时回退到中文 HTTP 状态提示。
- 根 `tsconfig.base.json` 统一 strict、ES2023、NodeNext 与 skipLibCheck。contracts 的 `tsconfig.json` 包含测试，`tsconfig.build.json` 排除测试并输出声明；包内提供 build、test、typecheck，根脚本用 `pnpm -r` 调用。
- TypeScript 6.0.3、Vitest 4.1.12、zod 4.6.7 精确锁定；Vitest 与 Nest 官方 ESM starter 的 4.x 主版本一致，不采用 registry 最新的 5.x。

## 版本依据

2026-10-24 在线查询并核对以下原始来源；版本与在线内容可能随时间变化，实际安装以锁文件为准：

- [TypeScript registry](https://registry.npmjs.org/typescript/6.0.3)
- [Vitest registry](https://registry.npmjs.org/vitest/4.1.12)
- [zod registry](https://registry.npmjs.org/zod/4.6.7)
- [Nest 官方 starter package.json](https://github.com/nestjs/typescript-starter/blob/master/package.json)：ESM、TypeScript 6 与 Vitest 4。

## Alternatives considered

- **只导出 TypeScript 接口**：没有运行时依赖，编译配置更简单。但跨进程收到的数据不会因此获得验证，无法完成计划要求的 schema 校验，因此使用既定的 zod。
- **用通用 URL 校验后只检查主机名**：可直接使用平台 URL 解析，并自然支持 URL 的标准写法。但它还可能接受凭据、路径以及被正规化的地址；本契约只交换主进程拼出的固定格式，直接检查字面格式与端口范围更清晰。
- **只用一份 tsconfig**：文件更少。但单测也需要类型检查，不能随 JS 和声明进入生产包；拆出仅覆盖构建输出与排除规则的配置，让测试参与 typecheck 而不参与分发。

## Consequences

- 收益：后续 engine 和 desktop 可共用运行时校验与推导类型；测试进入类型检查，生产输出不包含测试文件。
- 代价：引入 TypeScript、Vitest 和 zod 的安装量；调用方加载包入口前需要先构建 contracts。没有另加构建封装或其他测试框架。
- 连接地址有意限制为主进程生成的规范形式；将来支持远程 engine 或其他 URL 格式时，必须重新评审契约与校验。
- 连接地址校验只检查数据格式，不能替代 HTTP 鉴权、Host 检查、CORS 或 IPC 来源校验；前三项现由 [engine 服务](2026-10-24-engine-service.md)落实。engine、Electron 与打包行为不在本篇契约验证范围。

## Verification

- 新增 `ErrorResponse` 后，contracts 3 个测试文件、53 项测试通过，覆盖必填 code／message、可选 issues、嵌套字段与非法输入；全仓共 172 项测试、类型检查、lint、格式检查和笔记／计划校验通过。构建入口导出 schema 与同名类型，engine 的真实错误响应及 renderer 的中文提示使用同一契约。
- Node 24.22.1、pnpm 12.15.0 下，`pnpm exec tsc -v` 输出 `Version 6.0.3`，`pnpm install --frozen-lockfile` 通过，无需新增构建脚本许可。
- `pnpm build`、`pnpm typecheck`、`pnpm test` 通过。2 个测试文件共 43 项，覆盖合法输入、必填字段、字段类型、健康状态、ISO 日期时间、回环地址与端口边界。
- 构建目录只有 `index`、`health`、`engine-connection` 各自的 JS 与声明文件，不含测试。
- 临时下游 `.mts` 文件通过包名 `@frame-loom/contracts` 同时导入两个 schema 与同名类型；独立执行 `tsc --noEmit --strict --skipLibCheck --target ES2023 --module NodeNext` 与 Node 运行均成功。验证后删除临时文件。
- `pnpm run verify` 通过；既有 `test:plans` 的 37 项与 `test:commit-convention` 的 29 项通过，包含真实 Git 钩子检查。后续应用启动、跨进程联调与安装包验证仍由其余子计划负责。

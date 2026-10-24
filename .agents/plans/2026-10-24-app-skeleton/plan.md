# Plan: 搭建应用骨架与工具链

Status: done
Note: ../../notes/implemented/architecture/2026-10-24-desktop-stack-and-process-model.md
Note: ../../notes/implemented/process/2026-10-24-pnpm-node24-toolchain.md
Note: ../../notes/implemented/architecture/2026-10-24-engine-service.md
Note: ../../notes/implemented/architecture/2026-10-24-desktop-shell.md

## 目标

达成两篇笔记的验收标准：

- [技术栈与进程模型](../../notes/implemented/architecture/2026-10-24-desktop-stack-and-process-model.md)：开发模式和装好的 NSIS 安装包都能打开窗口，拉起 engine，完成 SQLite 迁移，并在界面上显示鉴权后 `/health` 的结果。
- [工具链切换](../../notes/implemented/process/2026-10-24-pnpm-node24-toolchain.md)：仓库在 Node 24.22 加 pnpm 下安装、校验、提交钩子全部可用。

## 范围与非目标

- 范围：
  - pnpm workspace 和 Node 24.22 工具链迁移；
  - `packages/contracts`、`services/engine`、`apps/desktop` 三个包；
  - engine 鉴权和 SQLite 迁移；
  - Electron 主进程、preload、renderer；
  - NSIS 打包和冒烟测试；
  - 相关文档和 CI 更新。
- 非目标：
  - 剧本、分镜、出图、出视频等业务能力；
  - Provider 适配和任务表；
  - ffmpeg 和 sharp 的引入；
  - 自动更新、代码签名、插件机制；
  - 引入 pi 和建立 agent 模块。pi 的选型见 [Agent 内核选型](../../notes/proposed/architecture/2026-10-24-agent-runtime-pi.md)，这篇笔记不由本计划落地。

## 子计划

| 编号 | 子计划 | 状态 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| 01 | [工具链迁移到 pnpm 与 Node 24.22](01-toolchain.md) | done | — | 现有校验在 pnpm 下全部通过，文档和 CI 已同步 |
| 02 | [workspace 与 contracts 包](02-contracts.md) | done | 01 | 可构建的 `@frame-loom/contracts`，带 schema 测试 |
| 03 | [engine 服务骨架](03-engine.md) | done | 02 | 能单独启动的 NestJS engine，包含鉴权、迁移和 `/health` |
| 04 | [Electron 桌面壳](04-desktop.md) | done | 03 | `pnpm dev` 打开窗口，显示 engine 健康状态 |
| 05 | [Windows 打包与冒烟测试](05-package.md) | done | 04 | 能安装的 NSIS 包，Playwright 冒烟测试通过，笔记转入 implemented |

## 依赖与顺序

- 关键路径：01 → 02 → 03 → 04 → 05。
- 可并行：
  - 02 完成后，04 的 electron-vite 配置和窗口安全设置可以和 03 并行。04 的联调要等 03 完成。
  - 05 的 electron-builder 配置调研可以和 04 并行。

## 验收

- [x] Node 24.22 加 pnpm 下 `pnpm run verify`、`pnpm run test:plans`、`pnpm run test:commit-convention` 通过 — 证据：01 验证
- [x] `pnpm -r test` 覆盖 contracts schema、engine 鉴权守卫、迁移执行 — 证据：02、03 验证，共 111 项通过
- [x] 不带 token 访问 engine 返回 401，`Host` 不对的请求被拒绝 — 证据：03 验证
- [x] `pnpm dev` 打开窗口并显示健康状态；渲染层 `window.require`、`process`、`ipcRenderer` 都不可用 — 证据：04 真实窗口与干净克隆验证
- [x] NSIS 安装后行为一致，数据库落在 `<userData>/data/`，Playwright 冒烟测试通过 — 证据：05 验证；自动冒烟按既定 fuse 回退测试构建产物，真实加固安装包另行验证
- [x] 工具链笔记和架构笔记移入 `implemented/` 并按实际结果改写，计划转 `done` — 证据：01 T9、05 T9

## 发现与偏差

- 01–05 全部完成，完整骨架、工具链、共享契约、engine 与桌面壳笔记均已 implemented。Agent 内核提案保持 proposed，未安装 pi。
- 01 安装时仅为 `esbuild@0.28.2` 登记构建许可；钩子全新安装改用隔离 Git 仓库验证。详情见[01 的发现与偏差](01-toolchain.md#发现与偏差)。
- 02 的构建、类型检查和 43 项契约测试通过，生产输出不含测试；engine 鉴权与迁移另由 03 验证。详情见[02 的验证](02-contracts.md#验证)。
- 03 的 engine 68 项测试与仓库外生产部署验证通过，无需 SWC 或 workspace 注入。允许源 JSON 格式、shutdown 消息与预检边界已明确；Electron 与原生模块的后续联调见 04。详情见[03 的验证](03-engine.md#验证)。
- 04 的桌面 37 项测试、开发与 app 协议窗口、干净克隆冻结安装和启动／关闭通过；真实 ESM utilityProcess 与 better-sqlite3 可用。联调补齐 engine 在 parentPort 下的显式退出，engine 测试增至 70 项，全仓应用测试共 150 项。NSIS、asar 外路径与 fuse 留给 05。详情见[04 的验证](04-desktop.md#验证)。
- 05 验证 NSIS 仓库外安装、健康状态、正常退出和卸载保留数据库通过；加固 fuse 不影响 asar 外 engine 与 SQLite。修正资源复制范围，engine 仅在部署阶段使用 hoisted；首次冷启动超过 15 秒后将等待上限调整为 30 秒并补测。Playwright 按既定回退启动构建产物，1 项通过；Windows CI 完成本地审阅，远端未执行。安装包 130.84 MiB，engine 依赖 51.39 MiB。详情见[05 的验证与偏差](05-package.md#验证)。

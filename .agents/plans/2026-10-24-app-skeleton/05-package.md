# Plan: Windows 打包与冒烟测试

Status: done
Parent: plan.md
Note: ../../notes/implemented/architecture/2026-10-24-desktop-stack-and-process-model.md

## 目标

用 electron-builder 产出 Windows x64 的 NSIS 安装包，engine 以 `pnpm deploy` 的产物形式放在 `resources/engine`。安装后应用的行为和开发模式一致，数据库落在 `%APPDATA%\<productName>\data\`。Playwright 的 `_electron` 冒烟测试能读到健康状态。最后把架构笔记移入 `implemented/`，计划转为 `done`。

## 前置条件

- 04 完成：`pnpm dev` 能显示健康信息。
- 在 Windows 10 1809 以上的 x64 机器上执行。

## 步骤

- [x] T1 在 `apps/desktop` 新增 `electron-builder.yml`，配置如下：
  - `appId: com.frameloom.desktop`、`productName: Frame Loom`，目标是 `nsis` 和 `x64`；
  - `files` 只包含 `out/**` 和 `package.json`；
  - `extraResources` 把 engine 的 deploy 产物映射到 `engine`；
  - `npmRebuild: false`；
  - `asar: true`。

  依赖写精确版本 — 验证：`pnpm --filter @frame-loom/desktop package:dir` 生成 `release/win-unpacked`，其中有 `resources/app.asar` 和 `resources/engine/dist/main.js`
- [x] T2 在根目录加 `package:win` 脚本，依次执行：构建 contracts → 构建 engine → 运行 engine 的 deploy，输出到 `apps/desktop/build/engine` → `electron-vite build` → `electron-builder --win`。`build/` 和 `release/` 已在 `.gitignore` 里 — 验证：`pnpm package:win` 生成 `apps/desktop/release/*.exe`
- [x] T3 配置 `electronFuses`：关闭 `runAsNode`、`enableNodeOptionsEnvironmentVariable`、`enableNodeCliInspectArguments`；打开 `onlyLoadAppFromAsar` 和 `enableEmbeddedAsarIntegrityValidation`。然后确认 `utilityProcess` 仍然能加载 asar 外部的 `resources/engine`，better-sqlite3 的预编译包也能加载 — 验证：运行 `win-unpacked` 里的 exe，窗口显示健康信息
- [x] T4 运行安装包，确认三件事：数据库文件位于 `%APPDATA%\Frame Loom\data\frame-loom.sqlite`；关闭应用后没有残留进程；卸载时不删除用户数据 — 验证：真实 NSIS 静默安装／卸载与窗口检查，结果见「验证」
- [x] T5 写 Playwright 冒烟测试，放在 `apps/desktop/e2e/smoke.test.ts`：用 `_electron.launch` 启动 `win-unpacked` 里的 exe，等窗口显示健康信息，断言 engine 版本非空。如果关闭 `enableNodeCliInspectArguments` 后 Playwright 连不上，改为启动 `electron-vite build` 的产物，打包后的 exe 只做人工验证，并把这个变化记入「发现与偏差」 — 验证：`pnpm --filter @frame-loom/desktop test:e2e` 通过
- [x] T6 记录安装包的体积，以及 `resources/engine/node_modules` 的大小。记录用，不设门槛 — 验证：数值写进本文件的「发现与偏差」
- [x] T7 新增 GitHub Actions 工作流 `.github/workflows/build.yml`，在 `windows-latest` 上执行：`pnpm install --frozen-lockfile`、`pnpm -r test`、`pnpm package:win`，上传安装包作为构建产物，不做发布 — 验证：人工审阅工作流文件。仓库托管之后再确认远端能跑通，在那之前不写成已通过
- [x] T8 回顾 02 到 05 的「发现与偏差」，如果有和架构笔记不一致的事实，先就地修改笔记 — 验证：笔记里的开放问题都有了结论
- [x] T9 收尾：
  1. 把[技术栈与进程模型](../../notes/implemented/architecture/2026-10-24-desktop-stack-and-process-model.md)移到 `implemented/architecture/`，`Status` 改为 implemented；
  2. `## Proposal` 改成现在时的 `## Decision`，「开放问题」改写成实际结论；
  3. 验收标准和风险并入 `## Consequences` 与 `## Verification`；
  4. 更新指向它的相对链接，包括 [Agent 内核笔记](../../notes/proposed/architecture/2026-10-24-agent-runtime-pi.md)、工具链笔记、本计划各文件的 `Note:` 行和正文链接；
  5. 父计划和全部子计划转为 `done`，在 `AGENTS.md` 里删掉「应用骨架尚未建立」的表述。

  Agent 内核笔记保持 proposed，它要等 pi 真正引入时再落地 — 验证：`pnpm run verify` 通过
- [x] T10 提交 `build(desktop): 新增 Windows 打包与冒烟测试`，带 `Note:` 和 `Plan:` 尾注 — 验证：与本计划同批提交，`commit-msg` 钩子与 `pnpm run verify` 通过

## 验证

- 预期：NSIS 安装包能安装并启动，显示健康信息；数据库路径正确；冒烟测试通过；笔记和计划的状态同步完成。
- 实际：Windows 11 x64（10.0.26200）、Node 24.22.1、pnpm 12.15.0；冻结安装、类型检查、150 项应用单测通过，桌面 37 项包含启动等待上限边界；37 项计划测试与 29 项提交规范测试通过。
- `package:dir` 与重复执行的 `pnpm package:win` 均成功。asar 清单仅有 `out/` 与 package.json；读取最终 exe 确认五项 fuse 为 false／false／false／true／true。生产依赖树扫描为 7,676 个文件、零目录链接，contracts 产物和 SQLite 预编译包在分发目录内。
- win-unpacked 真实启动通过 `app://frame-loom/` 显示 engine 0.1.0、schema 1；渲染调试检查确认 Node 全局不可用、preload 仅含约定方法、无令牌及错误令牌均 401，新窗口和外部导航被阻止，截图无横向溢出。关闭窗口后无同路径进程残留。
- `_electron` 按约定回退后通过 1 项冒烟测试，检查健康状态、非空 engine 版本、隔离全局、临时 userData 与关闭后的 engine 退出。部署后的 engine 复用生产入口黑盒测试，10 项通过。
- 最终 NSIS 在仓库外 `C:\Users\xiaoq\AppData\Local\Temp\frame-loom-nsis-05-20261024` 静默安装，退出码 0。安装目录内真实 exe 显示健康信息，截图已检查，并通过同样的页面隔离与鉴权断言。数据库位于 `%APPDATA%\Frame Loom\data\frame-loom.sqlite`（20,480 字节），使用已有数据库，未删除用户数据来测试首次建库；首次迁移另由独立临时 userData 冒烟覆盖。
- 关闭安装应用后 engine 退出码 0，同安装路径无残留进程，SQLite WAL 已清理。NSIS 静默卸载退出码 0，安装 exe 被移除；用户数据库仍存在且卸载前后 SHA-256 一致，测试安装已撤销。
- GitHub Actions 文件完成本地配置审阅；远端尚未执行，不宣称 CI 已通过。

## 进度

- 2026-10-24：创建子计划草稿。
- 2026-10-24：用户授权执行 05，确认 01–04 已完成且工作区干净，开始打包、真实安装验证和冒烟测试。
- 2026-10-24：完成 T1–T8；真实加固 exe、仓库外 NSIS 安装／关闭／卸载保留数据验证通过，补齐资源复制、部署依赖树与冷启动上限；完成应用、流程与自动冒烟验证。
- 2026-10-24：T9–T10 与收尾提交同批落盘；架构笔记移入 implemented，父计划及 01–05 全部 done，Agent 内核提案保持 proposed。

## 发现与偏差

- 精确依赖为 electron-builder 26.18.0、Playwright 1.64.1。首次安装被 pnpm 构建审核拦截；审阅后明确禁止仅用于 Squirrel 的 electron-winstaller 5.4.0 安装脚本，NSIS 不需要它，冻结安装通过。
- electron-builder 26.18.0 的资源过滤器跳过复制源根部 `node_modules`。extraResources 改从 `build` 匹配 `engine/**/*`；engine 仅在 deploy 时使用 `--node-linker=hoisted`，消除 Windows 目录链接，仓库仍为 isolated，不增加复制脚本。
- 关闭主进程调试 fuse 后，Playwright 启动打包 exe 超时；按原计划改测 electron-vite 构建产物，生产 fuse 保持不变。Windows 目录参数必须去掉尾部反斜杠，否则 `_electron.launch` 失败。Vitest 限定只收集 `src` 下用例。
- 首次部署启动触发现有 15 秒等待上限，后续启动正常；为冷启动将上限调整为 30 秒，并验证 15 秒后仍等待、30 秒超时清理。生产入口黑盒首次在 5 秒默认测试上限失败一项，针对部署目录以 `--testTimeout 10000` 验证，10 项全通过；全仓既有单测无需调整测试策略。
- 最终 NSIS 包为 137,197,461 字节（130.84 MiB）；`resources/engine/node_modules` 为 53,885,998 字节（51.39 MiB），仅记录，不做裁剪或体积门槛。
- Windows 窗口工具因缺少 `@oai/sky` 模块不可用，实际窗口使用 renderer 调试接口与截图验证；安装／卸载使用 NSIS 静默命令，不把 `_electron` 冒烟当成安装包验证。

## 交接

无。

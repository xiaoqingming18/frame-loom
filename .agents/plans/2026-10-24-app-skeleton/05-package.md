# Plan: Windows 打包与冒烟测试

Status: draft
Parent: plan.md

## 目标

用 electron-builder 产出 Windows x64 的 NSIS 安装包，engine 以 `pnpm deploy` 的产物形式放在 `resources/engine`。安装后应用的行为和开发模式一致，数据库落在 `%APPDATA%\<productName>\data\`。Playwright 的 `_electron` 冒烟测试能读到健康状态。最后把架构笔记移入 `implemented/`，计划转为 `done`。

## 前置条件

- 04 完成：`pnpm dev` 能显示健康信息。
- 在 Windows 10 1809 以上的 x64 机器上执行。

## 步骤

- [ ] T1 在 `apps/desktop` 新增 `electron-builder.yml`，配置如下：
  - `appId: com.frameloom.desktop`、`productName: Frame Loom`，目标是 `nsis` 和 `x64`；
  - `files` 只包含 `out/**` 和 `package.json`；
  - `extraResources` 把 engine 的 deploy 产物映射到 `engine`；
  - `npmRebuild: false`；
  - `asar: true`。

  依赖写精确版本 — 验证：`pnpm --filter @frame-loom/desktop package:dir` 生成 `release/win-unpacked`，其中有 `resources/app.asar` 和 `resources/engine/dist/main.js`
- [ ] T2 在根目录加 `package:win` 脚本，依次执行：构建 contracts → 构建 engine → 运行 engine 的 deploy，输出到 `apps/desktop/build/engine` → `electron-vite build` → `electron-builder --win`。`build/` 和 `release/` 已在 `.gitignore` 里 — 验证：`pnpm package:win` 生成 `apps/desktop/release/*.exe`
- [ ] T3 配置 `electronFuses`：关闭 `runAsNode`、`enableNodeOptionsEnvironmentVariable`、`enableNodeCliInspectArguments`；打开 `onlyLoadAppFromAsar` 和 `enableEmbeddedAsarIntegrityValidation`。然后确认 `utilityProcess` 仍然能加载 asar 外部的 `resources/engine`，better-sqlite3 的预编译包也能加载 — 验证：运行 `win-unpacked` 里的 exe，窗口显示健康信息
- [ ] T4 运行安装包，确认三件事：数据库文件生成在 `%APPDATA%\Frame Loom\data\frame-loom.sqlite`；关闭应用后没有残留进程；卸载时不删除用户数据 — 验证：人工检查，并把结果记入本文件的「验证」
- [ ] T5 写 Playwright 冒烟测试，放在 `apps/desktop/e2e/smoke.test.ts`：用 `_electron.launch` 启动 `win-unpacked` 里的 exe，等窗口显示健康信息，断言 engine 版本非空。如果关闭 `enableNodeCliInspectArguments` 后 Playwright 连不上，改为启动 `electron-vite build` 的产物，打包后的 exe 只做人工验证，并把这个变化记入「发现与偏差」 — 验证：`pnpm --filter @frame-loom/desktop test:e2e` 通过
- [ ] T6 记录安装包的体积，以及 `resources/engine/node_modules` 的大小。记录用，不设门槛 — 验证：数值写进本文件的「发现与偏差」
- [ ] T7 新增 GitHub Actions 工作流 `.github/workflows/build.yml`，在 `windows-latest` 上执行：`pnpm install --frozen-lockfile`、`pnpm -r test`、`pnpm package:win`，上传安装包作为构建产物，不做发布 — 验证：人工审阅工作流文件。仓库托管之后再确认远端能跑通，在那之前不写成已通过
- [ ] T8 回顾 02 到 05 的「发现与偏差」，如果有和架构笔记不一致的事实，先就地修改笔记 — 验证：笔记里的开放问题都有了结论
- [ ] T9 收尾：
  1. 把[技术栈与进程模型](../../notes/proposed/architecture/2026-10-24-desktop-stack-and-process-model.md)移到 `implemented/architecture/`，`Status` 改为 implemented；
  2. `## Proposal` 改成现在时的 `## Decision`，「开放问题」改写成实际结论；
  3. 验收标准和风险并入 `## Consequences` 与 `## Verification`；
  4. 更新指向它的相对链接，包括 [Agent 内核笔记](../../notes/proposed/architecture/2026-10-24-agent-runtime-pi.md)、工具链笔记、本计划各文件的 `Note:` 行和正文链接；
  5. 父计划和全部子计划转为 `done`，在 `AGENTS.md` 里删掉「应用骨架尚未建立」的表述。

  Agent 内核笔记保持 proposed，它要等 pi 真正引入时再落地 — 验证：`pnpm run verify` 通过
- [ ] T10 提交 `build(desktop): 新增 Windows 打包与冒烟测试`，带 `Note:` 和 `Plan:` 尾注 — 验证：`commit-msg` 钩子通过，`pnpm run verify` 通过

## 验证

- 预期：NSIS 安装包能安装并启动，显示健康信息；数据库路径正确；冒烟测试通过；笔记和计划的状态同步完成。
- 实际：未执行。

## 进度

- 2026-10-24：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始，04 已完成。下一步执行 T1；桌面主入口为 `apps/desktop/out/main/index.js`，preload 为 `out/preload/index.cjs`，构建页面使用 `app://frame-loom`。真实 utilityProcess 已验证可加载 ESM 和 better-sqlite3；engine 清理资源后在 parentPort 环境显式退出。仍需验证 `resources/engine` 的部署路径、fuse、NSIS 和 Playwright，不将 app 协议预览等同于安装包验证。

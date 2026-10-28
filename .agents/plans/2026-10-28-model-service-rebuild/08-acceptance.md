# Plan: 整体验收与收尾

Status: draft
Parent: plan.md

## 目标

逐条对照关联笔记的 `## Acceptance criteria`，给出每条的证据。完成残留扫描、质量门禁和限定范围的 E2E，重写验收文档，并完成笔记与计划的生命周期收尾。不执行任何真实模型服务验收，也不运行与重构无关的测试。

## 前置条件

- 01–07 全部完成，各自的「验证 · 实际」均已填写。
- 工作区干净，所有子计划的改动都已提交。
- 已构建：`pnpm --filter @frame-loom/engine... build`、`pnpm --filter @frame-loom/desktop build`。确认环境中没有 `ELECTRON_RUN_AS_NODE=1`。构建与 E2E 串行执行，不在 E2E 运行期间重建。

## 测试范围

| 类别 | 执行 | 说明 |
| --- | --- | --- |
| 全仓单元 / 集成测试 | `pnpm run test` | 契约变更影响所有 workspace 包，属于直接回归 |
| 类型、lint、格式、构建 | `pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check`、`pnpm run build` | 必须执行 |
| 笔记与计划 | `pnpm run verify`、`git diff --check` | 必须执行 |
| 限定 E2E | `model-management`、`generation-image`、`image-node-acceptance`、`image-edit-runtime`、`canvas-nodes`、`canvas-audio`，以及 07 新增的视频编辑用例 | 只运行这些文件 |
| 不执行 | `smoke`、`canvas-organize`、`canvas-persistence`、`canvas-shell`、`project-assets`、`project-library`、`project-tags` 的 E2E；`package:dir`、`package:win`；安装包检查；原生窗口与输入法检查；任何真实模型服务调用 | 与本次重构无关或不在授权范围内 |

## 步骤

- [ ] T1 残留扫描：在 `packages`、`apps` 目录下运行以下命令，结果应为空，或逐条说明为何允许保留。允许保留的只有迁移映射表和测试中故意构造的旧值。
  - `rg -n "ModelProfile|profileId|profile_json|channelModelId|channel_models|model_catalog|ModelConnection|serviceRoutes|resolveModelOperation|executionContract|retiredVideoIds|sevenVideoModelIds|provider_uploads|providerContent|apiFormat|matchIds|imageRequestSize|imageEditCapabilityIssue|CanvasVideoMode|executableGenerationModes|smoke-providers" packages apps --glob '!**/drizzle/**'`
  - `rg -n "fastaitoken|liuguang" packages apps --glob '!**/*.test.*' --glob '!**/fixtures/**'`：业务代码中不得出现站点名。
  - `rg -n "\.\.\.(request|req)\.params" apps/engine/src`：确认没有把参数整体展开发给上游。

  验证：在「验证 · 实际」中记录命令与输出。
- [ ] T2 网络隔离：确认测试代码中没有外网地址，并确认测试运行期间只有 127.0.0.1 的连接。
  - 扫描 `rg -n --pcre2 "https?://(?!127\.0\.0\.1|localhost)" apps packages -g "*.test.ts" -g "*.test.tsx"`，命中项只能是被断言的字符串常量，例如用于地址解析单测的示例域名，不能是被请求的目标。
  - 在 engine 测试中加一个全局守卫：`vitest` 的 setup 文件包装 `fetch`，非回环地址直接抛错，作为长期防线；desktop E2E 同样只启动本地模拟服务器。

  验证：守卫测试本身能证明非回环请求会抛错。
- [ ] T3 运行全部门禁和限定 E2E — 验证：依次执行并记录结果：`pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check`、`pnpm run build`、`pnpm run test`，以及 `pnpm --filter @frame-loom/desktop test:e2e -- model-management generation-image image-node-acceptance image-edit-runtime canvas-nodes canvas-audio <07 文件>`。如有失败，修复后整套重跑；单独重跑通过不能替代整套通过。
- [ ] T4 人工查看截图：检查 04、05、06 在明暗两种主题和 800×800 窗口下的截图，确认没有错位、溢出、对比度不足或焦点环缺失 — 验证：在「验证 · 实际」中逐项记录看过的截图文件名和结论。
- [ ] T5 重写 `docs/model-service-acceptance.md`。内容包括：
  - 首批 15 个协议的支持矩阵：类别、方式、地址规则、鉴权、交付方式、契约测试文件、文档来源与核对日期。
  - 本次门禁的实际结果。
  - 未验证项：真实服务、第二批协议、原生检查。

  同时删除 `docs/model-service-upgrade.md`；同步 `README.md`、`apps/engine/README.md`、`apps/desktop/README.md` 中与模型服务相关的描述；同步 `docs/ui-guidelines.md` 中画布输入框条目里的「档案」措辞，改为「能力卡与协议规则」。

  验证：`pnpm run verify`，并人工检查文档中的链接有效。
- [ ] T6 笔记收尾，与代码在同一批提交中完成：
  1. `git mv` 新笔记到 `.agents/notes/implemented/architecture/2026-10-28-model-service-rebuild.md`，状态改为 `implemented`。
  2. 将 `## Proposal` 改为现在时的 `## Decision`，`## Acceptance criteria` 与 `## Risks` 并入 `## Consequences`，计划性语句改为事实，并写明实际验证结果与未验证项。
  3. 归档被完全取代的笔记：`pnpm run archive-agent-note .agents/notes/implemented/feature/2026-10-25-channel-centric-model-settings.md --superseded-by .agents/notes/implemented/architecture/2026-10-28-model-service-rebuild.md`，并按脚本报告修复入站链接。
  4. 原地同步部分重叠笔记中的事实：
     - `proposed/architecture/2026-10-24-model-management.md` 的当前实现边界。
     - `implemented/feature/2026-10-26-canvas-image-node.md` 的档案与前缀匹配描述。
     - `2026-10-27-video-composer.md` 的方式来源。
     - `2026-10-28-canvas-image-edit-tools.md` 与 `bug-fix/2026-10-28-canvas-image-edit-runtime.md` 的能力来源。
     - `2026-10-24-theme-and-app-shell.md` 的设置页描述。
     - `architecture/2026-10-24-desktop-stack-and-process-model.md` 的 AI 接入一行。
  5. 更新所有指向 `proposed/architecture/2026-10-28-model-service-rebuild.md` 的链接，包括计划的 `Note:` 行和其他笔记。

  验证：`pnpm run verify-notes`。
- [ ] T7 计划收尾：各子计划勾选全部步骤，状态改为 `done`；父计划表同步状态，`Note:` 改为指向 implemented 路径，状态改为 `done`；「发现与偏差」汇总各子计划的偏差 — 验证：`pnpm run verify`、`git diff --check`

## 验收对照表

T6 之前逐条填写，每条写明证据所在的位置：测试文件、命令输出或截图。

| 笔记验收条目 | 证据 |
| --- | --- |
| 只需理解渠道与模型；未选协议不能启用；读取模型不按名称猜 | 待填 |
| 地址预览与实际请求一致，跨主机需确认，下载不外发凭据 | 待填 |
| 四类能力卡驱动表单；空值语义；上限外开关；协议单一写入口 | 待填 |
| 15 个协议契约测试；附加参数与保留字段 | 待填 |
| 画布完全由能力卡与规则驱动，无写死键、白名单或型号判断 | 待填 |
| 音频节点生成、播放、写回、连接视频；编辑与续写可提交 | 待填 |
| 快照冻结、凭据变化暂停、提交不确定不重投、重启只查询；清库迁移验证 | 待填 |
| 删除清单完成；门禁通过；无真实服务调用 | 待填 |

## 验证

- 预期：T1–T7 全部完成，对照表每行都有证据，`pnpm run verify` 通过。
- 实际：未执行。

## 进度

- 2026-10-28：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始。

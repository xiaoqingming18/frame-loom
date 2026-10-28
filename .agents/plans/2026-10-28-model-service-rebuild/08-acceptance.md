# Plan: 整体验收与收尾

Status: done
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

- [x] T1 残留扫描：在 `packages`、`apps` 目录下运行以下命令，结果应为空，或逐条说明为何允许保留。允许保留的只有迁移映射表和测试中故意构造的旧值。
  - `rg -n "ModelProfile|profileId|profile_json|channelModelId|channel_models|model_catalog|ModelConnection|serviceRoutes|resolveModelOperation|executionContract|retiredVideoIds|sevenVideoModelIds|provider_uploads|providerContent|apiFormat|matchIds|imageRequestSize|imageEditCapabilityIssue|CanvasVideoMode|executableGenerationModes|smoke-providers" packages apps --glob '!**/drizzle/**'`
  - `rg -n "fastaitoken|liuguang" packages apps --glob '!**/*.test.*' --glob '!**/fixtures/**'`：业务代码中不得出现站点名。
  - `rg -n "\.\.\.(request|req)\.params" apps/engine/src`：确认没有把参数整体展开发给上游。

  验证：在「验证 · 实际」中记录命令与输出。
- [x] T2 网络隔离：确认测试代码中没有外网地址，并确认测试运行期间只有 127.0.0.1 的连接。
  - 扫描 `rg -n --pcre2 "https?://(?!127\.0\.0\.1|localhost)" apps packages -g "*.test.ts" -g "*.test.tsx"`，命中项只能是被断言的字符串常量，例如用于地址解析单测的示例域名，不能是被请求的目标。
  - 在 engine 测试中加一个全局守卫：`vitest` 的 setup 文件包装 `fetch`，非回环地址直接抛错，作为长期防线；desktop E2E 同样只启动本地模拟服务器。

  验证：守卫测试本身能证明非回环请求会抛错。
- [x] T3 运行全部门禁和限定 E2E — 验证：依次执行并记录结果：`pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check`、`pnpm run build`、`pnpm run test`，以及 `pnpm --filter @frame-loom/desktop test:e2e -- model-management generation-image image-node-acceptance image-edit-runtime canvas-nodes canvas-audio <07 文件>`。如有失败，修复后整套重跑；单独重跑通过不能替代整套通过。
- [x] T4 人工查看截图：检查 04、05、06 在明暗两种主题和 800×800 窗口下的截图，确认没有错位、溢出、对比度不足或焦点环缺失 — 验证：在「验证 · 实际」中逐项记录看过的截图文件名和结论。
- [x] T5 重写 `docs/model-service-acceptance.md`。内容包括：
  - 首批 15 个协议的支持矩阵：类别、方式、地址规则、鉴权、交付方式、契约测试文件、文档来源与核对日期。
  - 本次门禁的实际结果。
  - 未验证项：真实服务、第二批协议、原生检查。

  同时删除 `docs/model-service-upgrade.md`；同步 `README.md`、`apps/engine/README.md`、`apps/desktop/README.md` 中与模型服务相关的描述；同步 `docs/ui-guidelines.md` 中画布输入框条目里的「档案」措辞，改为「能力卡与协议规则」。

  验证：`pnpm run verify`，并人工检查文档中的链接有效。
- [x] T6 笔记收尾，与代码在同一批提交中完成：
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
- [x] T7 计划收尾：各子计划勾选全部步骤，状态改为 `done`；父计划表同步状态，`Note:` 改为指向 implemented 路径，状态改为 `done`；「发现与偏差」汇总各子计划的偏差 — 验证：`pnpm run verify`、`git diff --check`

## 验收对照表

T6 之前逐条填写，每条写明证据所在的位置：测试文件、命令输出或截图。

| 笔记验收条目 | 证据 |
| --- | --- |
| 只需理解渠道与模型；未选协议不能启用；读取模型不按名称猜 | `apps/engine/src/modules/model-services/model-services.integration.test.ts`、`catalog.service.ts`；`apps/desktop/src/renderer/src/features/model-management.test.tsx` 与 `e2e/model-management.test.ts` |
| 地址预览与实际请求一致，跨主机需确认，下载不外发凭据 | `packages/contracts/src/endpoints.test.ts`、`capability-check.test.ts`；engine `protocols.integration.test.ts`、`protocols/http.test.ts`、`llm-protocols.test.ts` |
| 四类能力卡驱动表单；空值语义；上限外开关；协议单一写入口 | contracts `capability-check.test.ts`、`model-service.test.ts`；desktop `model-management.test.tsx`；`model-editor/use-model-draft.ts` 唯一协议变更入口 |
| 15 个协议契约测试；附加参数与保留字段 | contracts `protocols.test.ts`；engine `protocols/{descriptor,image,video,video-compatible,tts}.test.ts` 与 `llm/llm-protocols.test.ts` |
| 画布完全由能力卡与规则驱动，无写死键、白名单或型号判断 | canvas `nodes/params/params.test.tsx`、`generation-panel.test.tsx`、`views.test.tsx`、`media.test.ts`；协议判断扫描无命中；参数预览与画布共用控件 |
| 音频节点生成、播放、写回、连接视频；编辑与续写可提交 | `apps/desktop/e2e/canvas-audio.test.ts`、`video-edit.test.ts` 整组通过；音频播放 duration>0、素材上传一次、reference_audio 与 base_video 翻译、版本写回断言 |
| 快照冻结、凭据变化暂停、提交不确定不重投、重启只查询；清库迁移验证 | engine `generation/generation.integration.test.ts`、`core/database/database.service.test.ts`；canvas `generation-runtime.test.tsx`；`image-node-acceptance.test.ts` 旧文档重启与 404 清理 |
| 删除清单完成；门禁通过；无真实服务调用 | T1 扫描仅旧库及旧字段剥离测试；T2 全局守卫与本地 mock；T3 全门禁 859 项、限定 E2E 9 passed／1 skipped；完整日志 `.cache-08-*`（忽略） |

## 验证

- 预期：T1–T7 全部完成，对照表每行都有证据，`pnpm run verify` 通过。
- 实际（2026-10-29）：typecheck、lint、format:check、build、test 整套顺序执行通过；contracts 237、canvas 147、desktop 214、engine 261，共 859 用例（95 文件）。限定 E2E 整组 9 passed／1 skipped，耗时 1.7 分钟；跳过的是计划排除的加固目录包。日志为根目录 `.cache-08-full-*.log` 与 `.cache-08-e2e.log`，未调用真实服务。
- 收尾：`pnpm run verify` 通过（28 篇活跃笔记、1 篇归档及封印、84 份计划），`git diff --check` 无输出；最终文档更新后再次执行 `pnpm run format:check` 通过。README、engine／desktop README、UI 指南和验收文档的本地链接逐一确认存在。
- T1：按步骤所列三组 rg 执行；旧符号仅命中 `database.service.test.ts:44,45,85` 的旧库夹具与 `generation-job.test.ts:25,28,29` 的旧字段剥离断言，允许保留。站点名和参数整体展开两组扫描均无命中；过渡子路径已移除。协议 id 分支扫描在生产业务代码无命中。
- T2：按步骤所列外网字面量扫描；地址／配置解析、CORS／Host 拒绝、日志脱敏、迁移、签名、公网校验均是字符串断言，公网校验 DNS 使用 mock；对象存储示例由 mock fetch 截获，不连接远程。音频／视频编辑 E2E 的示例公网存储由测试启动器强制重写到本地，其他外部 fetch 被拒绝。全局网络守卫测试证明非回环及自动重定向失败，engine 全套测试在此守卫下通过；全部测试上游监听 127.0.0.1 随机端口。
- T4 人工查看：`apps/desktop/test-results/model-management-*/` 中 `channel-{light,dark}-{800,1280}.png`、`editor-{basic,capability,extras}-{light,dark}-{800,1280}.png` 共 16 张：无横向溢出，长能力表可滚动、底栏可见，明暗对比与弹窗焦点约束正常。
- T4 人工查看：`generation-image-*/image-params-{light,dark}[-800].png`、`video-params-{light,dark}[-800].png` 共 8 张：规则禁用与原因可读，图片输入框可见焦点环；800×800 参数弹层边界断言通过。视频内容可滚动，固定 620px 输入框按既定规范允许越出画布，未改成响应式布局。
- T4 人工查看：`canvas-audio-*/audio-{light,dark}.png`、`audio-params-{light,dark}.png`、`audio-params-{light,dark}-800.png` 共 6 张：播放控件、音色、指令与输出格式无错位，手填 ID 的键盘焦点环清晰；800×800 参数滚动与边界正常。

### 已查看截图逐项记录

以下文件均位于上文对应的 test-results 用例目录；文件名中的 800 表示 800×800。

| 来源 | 文件名 | 结论 |
| --- | --- | --- |
| 04 设置 | `channel-dark-1280.png` | 内容与底栏可见，滚动及明暗对比正常 |
| 04 设置 | `channel-dark-800.png` | 内容与底栏可见，滚动及明暗对比正常 |
| 04 设置 | `channel-light-1280.png` | 内容与底栏可见，滚动及明暗对比正常 |
| 04 设置 | `channel-light-800.png` | 内容与底栏可见，滚动及明暗对比正常 |
| 04 设置 | `editor-basic-dark-1280.png` | 内容与底栏可见，滚动及明暗对比正常 |
| 04 设置 | `editor-basic-dark-800.png` | 内容与底栏可见，滚动及明暗对比正常 |
| 04 设置 | `editor-basic-light-1280.png` | 内容与底栏可见，滚动及明暗对比正常 |
| 04 设置 | `editor-basic-light-800.png` | 内容与底栏可见，滚动及明暗对比正常 |
| 04 设置 | `editor-capability-dark-1280.png` | 内容与底栏可见，滚动及明暗对比正常 |
| 04 设置 | `editor-capability-dark-800.png` | 内容与底栏可见，滚动及明暗对比正常 |
| 04 设置 | `editor-capability-light-1280.png` | 内容与底栏可见，滚动及明暗对比正常 |
| 04 设置 | `editor-capability-light-800.png` | 内容与底栏可见，滚动及明暗对比正常 |
| 04 设置 | `editor-extras-dark-1280.png` | 内容与底栏可见，滚动及明暗对比正常 |
| 04 设置 | `editor-extras-dark-800.png` | 内容与底栏可见，滚动及明暗对比正常 |
| 04 设置 | `editor-extras-light-1280.png` | 内容与底栏可见，滚动及明暗对比正常 |
| 04 设置 | `editor-extras-light-800.png` | 内容与底栏可见，滚动及明暗对比正常 |
| 05 图像／视频 | `image-params-dark-800.png` | 参数弹层在窗口内，规则提示清楚，固定输入框按既定规范 |
| 05 图像／视频 | `image-params-dark.png` | 参数弹层在窗口内，规则提示清楚，固定输入框按既定规范 |
| 05 图像／视频 | `image-params-light-800.png` | 参数弹层在窗口内，规则提示清楚，固定输入框按既定规范 |
| 05 图像／视频 | `image-params-light.png` | 参数弹层在窗口内，规则提示清楚，固定输入框按既定规范 |
| 05 图像／视频 | `video-params-dark-800.png` | 参数弹层在窗口内，规则提示清楚，固定输入框按既定规范 |
| 05 图像／视频 | `video-params-dark.png` | 参数弹层在窗口内，规则提示清楚，固定输入框按既定规范 |
| 05 图像／视频 | `video-params-light-800.png` | 参数弹层在窗口内，规则提示清楚，固定输入框按既定规范 |
| 05 图像／视频 | `video-params-light.png` | 参数弹层在窗口内，规则提示清楚，固定输入框按既定规范 |
| 06 音频 | `audio-dark.png` | 播放／音色／参数布局正常，输入框焦点环清晰 |
| 06 音频 | `audio-light.png` | 播放／音色／参数布局正常，输入框焦点环清晰 |
| 06 音频 | `audio-params-dark-800.png` | 播放／音色／参数布局正常，输入框焦点环清晰 |
| 06 音频 | `audio-params-dark.png` | 播放／音色／参数布局正常，输入框焦点环清晰 |
| 06 音频 | `audio-params-light-800.png` | 播放／音色／参数布局正常，输入框焦点环清晰 |
| 06 音频 | `audio-params-light.png` | 播放／音色／参数布局正常，输入框焦点环清晰 |

## 进度

- 2026-10-28：创建子计划草稿。
- 2026-10-29：T1–T5 已执行，完整门禁及限定 E2E 通过，查看明暗／800 截图；完成笔记移入 implemented、旧设置笔记脚本归档与链接修复；全部计划收尾。

## 发现与偏差

- 遗留外网字面量是安全／地址断言及被重定向的示例存储地址，不能删除，否则会失去拒绝边界证据；没有真实外网模型调用。
- 补删 02 为阶段 typecheck 暂留的 contracts 子路径，并将全部消费者切换根入口；无运行时兼容层。
- 最终 E2E 9 通过、1 跳过；排除项保持计划范围，不用打包／原生检查替代本地验收。

## 交接

无。

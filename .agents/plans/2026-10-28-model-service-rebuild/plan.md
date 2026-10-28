# Plan: 模型服务配置层重构

Status: active
Note: ../../notes/proposed/architecture/2026-10-28-model-service-rebuild.md

## 目标

达成关联笔记 `## Acceptance criteria` 的全部条目：渠道与模型两层配置、代码协议适配器与首批 15 个协议、确定性地址解析、四类用户能力卡、语义请求与新任务快照、重写的设置页、能力卡驱动的画布与新增音频节点，并删除旧模型服务体系。决定与理由只以笔记为准，本计划不复述。

## 范围与非目标

- 范围：
  - `packages/contracts`：模型服务、能力卡、协议描述、地址解析、语义请求、校验与尺寸计算、画布数据契约。
  - `apps/engine`：数据库迁移与表结构、`modules/channels`（将重命名为 `modules/model-services`）、`modules/generation`、`modules/llm`、对象存储调用点、项目媒体引用。
  - `apps/desktop`：`features/model-services`、默认模型页、画布宿主 `features/projects/canvas/project-canvas.tsx`、相关 E2E。
  - `packages/canvas`：宿主接口、参数面板、视频节点、图片编辑能力推导、新增音频节点。
  - 文档：`docs/model-service-acceptance.md` 重写、`docs/model-service-upgrade.md` 删除、相关笔记事实同步。
- 非目标：
  - 不调用任何真实模型服务，不使用任何真实 API Key，不发起可能计费的请求。
  - 不运行与重构无关的测试：项目库、项目标签、画布整理、画布外壳、项目资产、启动冒烟 E2E；打包（`package:dir`／`package:win`）、安装包与原生窗口操作检查。
  - 不做本地模型、ComfyUI、用户自定义协议、远程模型目录、ASR、音乐音效、声音克隆、Agent 编排。
  - 不实现第二批协议（Gemini Interactions、xAI、Vidu、PixVerse、FLUX 3、可灵旧版 JWT、百炼 TTS、豆包 TTS）。
  - 不兼容旧模型配置、旧生成任务与旧快照（笔记 D1）。

## 子计划

| 编号 | 子计划 | 状态 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| 01 | [共享契约](01-contracts.md) | done | — | 渠道／模型 schema、协议描述、地址解析、四类能力卡、语义请求、共享校验与尺寸计算及单测 |
| 02 | [engine 基座](02-engine-foundation.md) | done | 01 | 清库迁移、新表与仓库、模型服务 HTTP 接口、协议注册表、执行链与快照、读取模型、旧 engine 代码删除 |
| 03 | [首批协议适配器](03-protocol-adapters.md) | done | 01、02 | 15 个协议描述＋适配器、文本经 pi-ai 接入统一地址、契约测试与集成测试 |
| 04 | [设置页重写](04-settings-ui.md) | draft | 01、02 | 渠道列表与表单、渠道详情、读取模型、模型编辑三个标签、测试、默认模型页、组件测试与 E2E |
| 05 | [画布图像与视频](05-canvas-media.md) | draft | 01、02、03 | 宿主接口、能力卡驱动参数面板、视频方式与端口、图片编辑能力推导、节点数据迁移、E2E |
| 06 | [画布音频节点](06-canvas-audio.md) | draft | 03、05 | TTS 音频节点、音色、写回、连接视频参考音频、E2E |
| 07 | [视频编辑与续写](07-video-edit-extend.md) | draft | 03、05 | `edit`／`extend` 方式、待编辑视频端口、Seedance 与可灵承接、测试 |
| 08 | [整体验收与收尾](08-acceptance.md) | draft | 01、02、03、04、05、06、07 | 残留扫描、全量门禁、限定范围 E2E、验收文档、笔记与计划生命周期收尾 |

## 依赖与顺序

- 关键路径：01 → 02 → 03 → 05 → 06／07 → 08。
- 可并行：04 只依赖 01、02，可与 03 并行；06 与 07 在 05 完成后可并行。并行时协调同一文件与迁移序号：迁移只在 02 新增一个，后续子计划不再新增迁移；如确需新增，必须在本表「发现与偏差」登记并按序编号。
- 分支：在独立分支施工，例如 `refactor/model-service-rebuild`，01～08 全部完成后再合并。子计划之间允许画布或设置页暂时不可用，但每个子计划结束时 must 满足 `pnpm run typecheck` 通过，且本子计划列出的测试通过。
- 提交：每个子计划对应一到数次逻辑提交，遵守 `docs/git-commit-convention.md`。实现、测试、笔记事实与计划进度同批提交；非平凡提交加尾注 `Note: .agents/notes/proposed/architecture/2026-10-28-model-service-rebuild.md` 与 `Plan: .agents/plans/2026-10-28-model-service-rebuild/<子计划>.md`。破坏性契约提交使用 `!` 与 `BREAKING CHANGE:`，迁移说明写「开发期清除旧模型配置与生成任务，项目与资产保留」。
- 环境：Node.js 24.22.x、`packageManager` 锁定的 pnpm 12.15.0；开始前运行 `corepack enable pnpm`、`pnpm install --frozen-lockfile`；E2E 前确认没有 `ELECTRON_RUN_AS_NODE=1`，并先执行 `pnpm --filter @frame-loom/engine... build` 与 `pnpm --filter @frame-loom/desktop build`。源码随施工变化，不依赖本计划中的行号。

## 共享约定（全部子计划必须遵守）

偏离以下约定须先在本文件「发现与偏差」登记，涉及决定变化时按笔记流程处理，不得在子计划内自行改变。

1. **名称与位置**
   - contracts 新文件：`model-service.ts`（渠道、模型、写入与读取 DTO）、`protocols.ts`（`ProtocolDescriptor` 类型与首批 15 个描述常量）、`endpoints.ts`（`resolveEndpoints`）、`capabilities.ts`（四类能力卡 schema 与字段元数据）、`semantic-request.ts`（`SemanticRequest`）、`capability-check.ts`（`checkRequest`、`checkMedia`、`effectiveVideoParams`、`effectiveCapability`）、`image-size.ts`（`resolveImageSize` 与各协议换算规则）、`prompt-references.ts`（引用解析与改写，取代 `image-references.ts`）。
   - engine：`modules/channels` 重命名为 `modules/model-services`；适配器位于 `modules/generation/protocols/<protocol-id>.ts`，统一导出于 `modules/generation/protocols/registry.ts`。
   - desktop：`features/model-services/` 下按 04 子计划的文件表拆分。
   - canvas：新增 `nodes/audio-*.tsx`，参数控件集中在 `nodes/params/`。
2. **协议 id 固定**：`openai-chat`、`openai-responses`、`anthropic-messages`、`gemini-generate`、`openai-images`、`ark-seedream`、`ark-seedance`、`dashscope-wan`、`minimax-video-v2`、`kling-omni`、`openai-videos`、`newapi-video`、`openai-speech`、`minimax-t2a`、`elevenlabs`。界面显示名见笔记首批协议表。
3. **类别值**：`chat`、`image`、`video`、`tts`。界面文案对应「文本」「图像」「视频」「TTS」。
4. **视频方式 id**：`t2v`、`first`、`last`、`first_last`、`keyframes`、`reference`、`edit`、`extend`。界面文案对应「文生视频」「首帧生视频」「仅尾帧」「首尾帧」「多关键帧」「全模态参考」「视频编辑」「视频续写」。
5. **素材角色**：`first_frame`、`last_frame`、`keyframe`、`reference`、`base_video`；素材类型 `image`、`video`、`audio`。
6. **语义参数键**（画布、请求、能力卡统一使用，适配器负责翻译成上游字段）：`aspectRatio`、`tier`、`width`、`height`、`quality`、`background`、`outputFormat`、`compression`、`count`、`seed`、`negativePrompt`、`duration`、`resolution`、`audio`、`watermark`、`voice`、`instructions`、`speed`、`pitch`、`volume`、`format`、`sampleRate`。
7. **空值语义**：能力卡数值字段缺省（`undefined`）表示不限，`0` 表示不支持；schema 中禁止用 `null` 表达「不限」。
8. **单一实现**：地址只能由 `resolveEndpoints` 计算，请求校验只能由 `checkRequest`／`checkMedia` 执行，图片像素只能由 `resolveImageSize` 计算，协议变更只能经 `changeProtocol`。renderer、engine、canvas 不得复制这些逻辑。
9. **禁止项**：
   - 按渠道域名或模型名写分支或推断能力。
   - 把参数对象整体展开发给上游。
   - 在协议适配器之外判断协议 id。
   - 向结果下载地址或重定向目标发送渠道凭据。
   - 在日志、诊断、快照、导出 JSON 中写入密钥或请求头值。
   - 测试中访问外网或使用真实凭据。
10. **模拟上游**：engine 集成测试与 E2E 的上游使用 `node:http` 严格模拟服务器，规则如下：
    - 只接受约定的方法、路径与鉴权头，其余返回 404 或 401。
    - 记录每次请求，测试断言请求体与请求次数。
    - 监听 `127.0.0.1` 随机端口。
    - 抽成 `apps/engine/src/testing/mock-upstream.ts` 供各测试复用；E2E 可复制最小实现，不跨包引用 engine 测试文件。
11. **UI**：遵守 `docs/ui-guidelines.md`。
    - 使用 `@frame-loom/ui` 组件、lucide 图标和主题语义 token。
    - 纯图标按钮提供中文可访问名称；复杂字段旁放问号提示。
    - 新界面检查明暗两种模式、最小窗口与键盘焦点。

## 验收

- [ ] 笔记 `## Acceptance criteria` 的每一条都有对应证据 — 证据：08 子计划的验收对照表。
- [ ] 共享契约与地址解析有完整单测，预览与实际请求一致 — 证据：01、02、03 的测试与 08 汇总。
- [ ] 首批 15 个协议契约测试与集成测试通过 — 证据：03。
- [ ] 设置页与画布按能力卡工作，限定范围 E2E 通过并查看明暗截图 — 证据：04、05、06、07。
- [ ] 删除清单完成，残留扫描为空 — 证据：08 的扫描命令输出。
- [ ] `pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check`、`pnpm run build`、`pnpm run test`、限定 E2E、`pnpm run verify`、`git diff --check` 通过 — 证据：08 记录的实际命令与结果。
- [ ] 全程无真实模型服务调用 — 证据：08 的网络断言与代码扫描。
- [ ] 笔记移入 `implemented/architecture/`，`channel-centric-model-settings` 归档，计划全部 `done` — 证据：08 收尾提交与 `pnpm run verify`。

## 发现与偏差

- 2026-10-28：用户授权执行，父计划与 01 转 active；使用 `codex/model-service-rebuild` 独立分支。
- 01 新旧导出同名：`ModelKind`、`Channel`、`ChannelWrite`、`ChannelPatch`、`ModelDefaults`、`ModelDefaultsPatch`、`IMAGE_QUALITY_LABELS`。按 T1 共存要求，新文件直接导出标准名称；包入口暂保留旧同名符号，仅显式导出无冲突的新符号，02／04 迁移消费者时切换入口，不增加前缀或兼容行为。
- 02 为满足每阶段全仓 typecheck，新契约暂由 `@frame-loom/contracts/model-service` 子路径供 engine 使用；旧 renderer 保留根入口到 04／05 完成迁移，08 删除过渡入口。此安排仅影响编译入口，不保留旧 HTTP 或数据兼容行为。
- 03 核对官方正文后使用 MiniMax content／ratio 与可灵 contents；可灵未开放本地音频，voice_id 不能由文件 URL 替代。协议扩展默认附加字段、视频尺寸映射与开放容器描述，详见 03 发现与偏差。
- 03 文本运行时信息存入描述；媒体以 buildSubmit、文本以 pi-ai 实际请求验证保留字段。ElevenLabs 的混合版本操作路径、Gemini PCM／WAV 与既有安全测试 URL 扫描例外见 03 记录；全部上游仍为本地 mock。

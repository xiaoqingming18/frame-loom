# Plan: 模型管理与调用

Status: active
Note: ../../notes/proposed/architecture/2026-10-24-model-management.md

## 目标

达成[模型管理提案](../../notes/proposed/architecture/2026-10-24-model-management.md)的验收标准：

- 用户能配置渠道与渠道模型，按模型选择文本协议，并通过连通测试；密钥加密存储，接口、日志和数据库中都没有明文。
- 图片、视频、TTS 调用统一经过生成任务。任务可以恢复，提交结果不明时不会自动重提，结果按 sha256 落盘到 `media/`。
- 参考图走内联；参考视频和参考音频必须配置对象存储，未配置时被拦截。
- 左栏临时页面"模型测试"能手动跑通四类模型，并实时显示任务状态和产物。
- 自动测试、真实接口冒烟和人工验收清单全部完成，笔记转入 `implemented/`。

## 范围与非目标

- 范围：
  - `packages/contracts`：渠道、模型、档案、生成任务、事件、对象存储的 schema 与 `checkGenerationRequest`。
  - `apps/engine`：
    - 新增模块：`core/crypto`、`core/events`、`modules/channels`、`modules/llm`、`modules/generation`（适配器、档案、任务调度、媒体落盘）、`modules/object-storage`。
    - 改动：CORS 放开、SSE 端点、日志屏蔽、`FRAME_LOOM_SECRET_KEY`。
  - `apps/desktop`：
    - 主进程：主密钥、`frame-media://` 协议、CSP。
    - renderer：engine client 的写请求与 `stream()`、设置中心的"模型服务"和"对象存储"页签、`/model-lab` 临时页面。
  - ffprobe 的引入与打包，`smoke:providers` 脚本，相关笔记的原地同步。
- 非目标：笔记"本期不做"一节列出的全部内容；画布、剧本等业务功能；pi-agent-core 与 `modules/agent`。

## 子计划

| 编号 | 子计划 | 状态 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| 01 | [基础设施：写接口、密钥与事件](01-foundation.md) | done | — | CORS 放开、主密钥与字段加密、日志屏蔽、SSE 事件端点、client 写请求与 `stream()` |
| 02 | [渠道与文本模型](02-channels-llm.md) | done | 01 | 渠道和模型的增删改查、拉取模型、pi-ai 连通测试、默认模型、"模型服务"设置页、模型测试页的文本页签 |
| 03 | [生成任务内核与图片](03-generation-image.md) | done | 02 | `generation_jobs`、调度与恢复、媒体落盘、`frame-media://`、三个图片适配器、模型测试页的图片页签 |
| 04 | [视频与参考素材](04-video-references.md) | draft | 03 | ffprobe、对象存储与预检、三个视频适配器、"对象存储"设置页、模型测试页的视频页签 |
| 05 | [TTS 与整体验收](05-tts-acceptance.md) | draft | 04 | 两个 TTS 适配器、配音页签、真实接口冒烟、人工验收、笔记转入 implemented |

## 依赖与顺序

- 关键路径：01 → 02 → 03 → 04 → 05。
- 可并行：
  - 03 的图片适配器及其录制样例测试只依赖 contracts 的档案 schema，可以在 02 的界面开发期间先写。
  - 05 的 TTS 适配器只依赖 03 的任务内核，可以和 04 并行。

## 验收

- [ ] contracts、适配器、engine 集成、密钥与签名测试全部通过，`pnpm test`、`pnpm typecheck`、`pnpm lint` 通过 — 证据：各子计划的验证
- [ ] 桌面 e2e 覆盖添加渠道、连通测试、生成图片并预览 — 证据：03 验证
- [ ] pi-ai 只在 `modules/llm` 中导入 — 证据：02 验证中的 grep
- [ ] 真实接口冒烟的结果已写回笔记和档案 — 证据：05 验证
- [ ] 人工验收 8 项在开发环境和 NSIS 安装包中通过，明暗模式都检查过 — 证据：05 验证
- [ ] 笔记转入 `implemented/`，相关笔记原地同步，计划转为 `done` — 证据：05 收尾步骤

## 发现与偏差

- 01、02、03 已完成并独立验收，证据见各自子计划；04、05 尚未开始。整体模型管理仍未交付，因此提案保持 proposed、父计划保持 active，父级整体验收项不提前勾选。

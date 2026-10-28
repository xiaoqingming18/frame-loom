# 模型服务配置层重构验收

验收日期：2026-10-29。环境：Windows x64、Node.js 24.22.0、pnpm 12.15.0、Electron 45。范围见[实施计划](../.agents/plans/2026-10-28-model-service-rebuild/plan.md)与[决策笔记](../.agents/notes/implemented/architecture/2026-10-28-model-service-rebuild.md)。以下是本地模拟验证的协议实现边界，不是供应商线上可用性承诺。

## 配置与执行边界

用户配置渠道和模型两层。渠道保存默认地址、凭据、列表格式与并发；模型显式选择协议，保存完整能力卡。读取模型仅生成待选草稿，不按模型名推测类别、协议或能力。四类能力卡与协议上限、规则取交集，设置页、画布与 engine 使用共享校验；协议变更仅经 `changeProtocol`。

`resolveEndpoints` 统一计算预览与实际操作地址，支持标准版本前缀、路径挂载、提交地址及各操作完整覆盖；跨主机覆盖必须明确确认。所有请求显式映射语义字段，附加参数只能写入声明路径，不能覆盖保留字段。结果链接下载不携带渠道凭据；OpenAI Videos 的鉴权内容接口作为独立操作解析，禁止自动重定向。

`0015_model_service_reset.sql` 在既有自动备份机制之后清除开发期旧模型配置和任务记录，保留项目、画布、媒体与对象存储。旧画布在加载／剪贴板入口迁移语义参数与连线；已删除任务的 pending 引用在查询 404 后清除。旧配置需要重新填写，不提供旧档案或旧任务执行兼容层。

## 首批 15 个协议

地址列为标准前缀与操作路径；`{model}`、`{id}`、`{voice_id}` 由共享地址函数编码填入。所有来源核对日期均为 **2026-10-29**；完整来源和模板限制保存在 `packages/contracts/src/protocols.ts` 及 `apps/engine/src/modules/generation/protocols/fixtures/README.md`。

| 协议 | 类别与方式 | 默认地址规则 | 鉴权 | 素材／结果交付 | 契约测试 | 官方来源 |
| --- | --- | --- | --- | --- | --- | --- |
| openai-chat | 文本流 | `/v1/chat/completions` | Bearer | SSE | llm-protocols.test.ts | [Chat](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) |
| openai-responses | 文本流 | `/v1/responses` | Bearer | SSE | llm-protocols.test.ts | [Responses](https://developers.openai.com/api/reference/resources/responses/methods/create) |
| anthropic-messages | 文本流 | `/v1/messages` | x-api-key | SSE | llm-protocols.test.ts | [Messages](https://platform.claude.com/docs/en/api/messages) |
| gemini-generate | 文本、图片、TTS | `/v1beta/models/{model}:generateContent` | x-goog-api-key | 图片内联；图片 base64、音频 WAV／PCM | llm-protocols.test.ts、protocols/image.test.ts、protocols/tts.test.ts | [图片](https://ai.google.dev/gemini-api/docs/image-generation)、[语音](https://ai.google.dev/gemini-api/docs/speech-generation)、[内容](https://ai.google.dev/api/generate-content) |
| openai-images | 生图、参考图编辑、蒙版 | `/v1/images/generations`、`/v1/images/edits` | Bearer | JSON／multipart；base64／URL | protocols/image.test.ts | [Image API](https://developers.openai.com/api/docs/guides/image-generation.md) |
| ark-seedream | 生图、参考图编辑 | `/api/v3/images/generations` | Bearer | 图片内联／URL；base64／URL | protocols/image.test.ts | [Seedream](https://ark.volcengine.com/region:cn-beijing/docs/image-generation-api) |
| ark-seedance | 文生、首帧、首尾帧、参考、编辑、续写 | `/api/v3/contents/generations/tasks[/{id}]` | Bearer | 图内联／URL，音视频 URL；异步结果 URL | protocols/video.test.ts | [Seedance](https://ark.volcengine.com/region:cn-beijing/docs/create-video-generation-task-api) |
| dashscope-wan | 文生、首帧、首尾帧、参考 | `/api/v1/services/aigc/video-generation/video-synthesis`；`/api/v1/tasks/{id}` | Bearer、异步头 | 图内联／URL，音视频 URL；异步结果 URL | protocols/video.test.ts | [Wan 3.0](https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-api-reference) |
| minimax-video-v2 | 文生、首／尾帧、首尾帧、参考 | `/v2/video_generation`；`/v2/query/video_generation/{id}` | Bearer | 图内联／URL，音视频 URL；异步结果 URL | protocols/video.test.ts | [MiniMax](https://platform.minimax.io/docs/api-reference/video-generation-v2-create) |
| kling-omni | 文生、首／尾帧、首尾帧、关键帧、参考、编辑 | `/omni-video/{model}`；`/tasks?task_ids={id}` | Bearer | 图内联／URL，视频 URL；异步结果 URL | protocols/video.test.ts | [Kling 4.0](https://kling.ai/document-api/api/video/4-0/video-omni.md) |
| openai-videos | 文生、首帧，历史兼容格式 | `/v1/videos[/{id}]`；`/v1/videos/{id}/content` | Bearer | multipart 图片；异步 URL／鉴权内容操作 | protocols/video-compatible.test.ts | [Videos](https://developers.openai.com/api/docs/guides/video-generation.md) |
| newapi-video | 文生、首帧、图片参考 | `/v1/video/generations[/{id}]` | Bearer | 图片内联／URL；异步 URL | protocols/video-compatible.test.ts | [new-api](https://doc.newapi.pro/api/generate-video/) |
| openai-speech | TTS | `/v1/audio/speech` | Bearer | 二进制音频，PCM 包装 WAV | protocols/tts.test.ts | [Speech](https://developers.openai.com/api/docs/guides/text-to-speech.md) |
| minimax-t2a | TTS、音色目录 | `/v1/t2a_v2`；`/v1/get_voice` | Bearer | hex／URL 音频 | protocols/tts.test.ts | [T2A](https://platform.minimax.io/docs/api-reference/speech-t2a-http.md) |
| elevenlabs | TTS、音色目录 | `/v1/text-to-speech/{voice_id}`；`/v2/voices` | xi-api-key | 二进制音频；分页目录 | protocols/tts.test.ts | [合成](https://elevenlabs.io/docs/api-reference/text-to-speech/convert.mdx)、[音色](https://elevenlabs.io/docs/api-reference/voices/search) |

测试路径以 `apps/engine/src/modules/` 为基准：`llm-protocols.test.ts` 位于 `llm/`，其余位于 `generation/`。方式仍受用户能力卡收窄。Kling 未声明续写，不能选择 extend，也不把 voice_id 当成本地音频 URL。Seedance 编辑与续写都要求 adaptive；只有编辑固定 duration=-1，待编辑视频下限 4 秒，普通参考下限 2 秒。未确认的 MiniMax 声音与 ElevenLabs 语速上下限不写成支持。

OpenAI Videos／Sora 已停服，适配器只覆盖兼容服务格式；OpenAI Speech 的官方停服日期为 2027-01-06。协议存在不代表对应官方型号可用。

## 自动验证与截图

最终门禁：typecheck、lint、format:check、build、test、verify 与 git diff --check 通过。全仓 95 文件、859 用例（contracts 237、canvas 147、desktop 214、engine 261）；限定 E2E **9 passed／1 skipped**，1.7 分钟。跳过加固目录包专项。完整命令、扫描输出与截图清单记录于[08 验收子计划](../.agents/plans/2026-10-28-model-service-rebuild/08-acceptance.md)。

任务回归覆盖快照冻结、凭据变化暂停、提交不明不重投、重启只查询、结果下载失效后的重新查询、取消与迟到回执、项目离线暂存和恢复。迁移测试在临时旧库上验证备份、清表与项目数据保留，不修改用户真实库。

限定 E2E：`model-management generation-image image-node-acceptance image-edit-runtime canvas-nodes canvas-audio video-edit`。覆盖设置请求预览与文本测试、TTS 播放、图像／视频生成、图片编辑 Worker、音频连接视频、编辑续写与重启保留。目录包专用用例按范围跳过。

设置、图像、视频和音频参数截图覆盖明暗主题、800×800 与键盘焦点。输入框仍按既定规范固定 620px，可以通过平移画布查看；独立参数弹层必须落在窗口内。截图保存于忽略目录 `apps/desktop/test-results/`。

## 网络隔离与残留扫描

engine Vitest 的 `src/testing/setup.ts` 包装 fetch，只允许 `127.0.0.1`，默认禁止自动重定向；`network-guard.test.ts` 证明外网、私网与重定向被拒绝。本地严格 mock 只接受约定方法、路径和鉴权，断言请求体与次数。

URL／安全测试中的外网字符串只参与解析、拒绝或签名断言。对象存储单测使用内存 mock fetch。音频及视频编辑 E2E 的 `8.8.8.8` 是签名示例：仅测试启动器将它重写到 `127.0.0.1`，并拒绝其他外部地址；不放宽生产公网素材限制。未调用真实模型服务或使用真实 Key。

旧符号扫描仅保留数据库迁移夹具的旧表名及 `generation-job.test.ts` 中验证旧字段被剥离的断言。业务无站点名、旧档案／目录／接入体系或整体参数展开。过渡子路径 `@frame-loom/contracts/model-service` 已删除。

## 未验证范围与代价

未验证真实供应商／中转站、账号权限、收费、生成质量与容量；未实现第二批协议、ASR、音乐、克隆、签名鉴权和供应商文件上传。本轮不执行无关 E2E、打包、NSIS 安装升级、原生窗口／输入法或加固版媒体验收。先前打包结果不能替代本轮重构的产品发布验收。

能力卡由用户填写，协议模板会随文档漂移；本地校验无法证明线上能力。开发期清库会删除旧配置和任务，升级前自动备份保留原副本；回退需要匹配旧数据库与旧应用版本。

# Agent Note: 模型管理与调用（渠道、能力档案、生成任务、参考素材）

Status: proposed

## Problem

剧本、分镜、画布、配音和后期的 Agent 编排，都要调用四类外部模型：

- **Agent 文本模型**：通用对话与工具调用，例如 gpt-6-astra、Claude、Gemini。
- **图片模型**：例如 gpt-image-2、nano-banana-pro、Seedream。
- **视频模型**：例如 seedance-2.0、MiniMax H3。
- **TTS 模型**：画布配音等场景使用。

现在 engine 只有健康检查，没有任何模型接入。第一个业务能力出现之前，必须先定下来：模型怎么配置，密钥放在哪里，各家接口差异怎么吸收，长时间的生成任务怎么保证不丢、不重复扣费，生成结果怎么落盘。如果先写业务再补，每个功能会各自接一遍厂商，Agent 工具也拿不到统一的服务。

约束：

- **用户自己决定用哪个平台。** 同一个模型可能来自官方，也可能来自 OpenRouter、new-api 一类中转站。应用不能假设平台，适配的先后只按协议能覆盖多少平台来排。
- **同一渠道内协议按模型区分。** 中转站上 GPT 系列通常走 OpenAI Responses，Claude 走 Anthropic Messages，Gemini 走 Gemini 原生协议。在不同协议间转换，最容易丢失推理内容、签名和工具调用。
- **图片多为同步接口，视频全部是异步任务。** 视频要先提交、再轮询，耗时 30 秒到数分钟；TTS 为同步或流式。
- **结果链接会过期**：方舟 24 小时，MiniMax 旧版 9 小时，万相 24 小时。
- **本机没有公网地址**，厂商回调用不上，只能轮询；参考视频和参考音频通常要求公网 URL。
- **厂商侧基本不做提交幂等**，提交超时后自动重试可能重复扣费。
- **模型参数差异大，而且存在组合约束**，例如 Veo 用 1080p 时只能生成 8 秒；Seedance 和 H3 的首尾帧模式与全模态参考模式互斥。
- 进程模型与鉴权边界见[应用骨架](../../implemented/architecture/2026-10-24-desktop-stack-and-process-model.md)和[engine 服务](../../implemented/architecture/2026-10-24-engine-service.md)，目录约定见[基础设施](../../implemented/architecture/2026-10-24-engine-and-renderer-foundation.md)。Agent 内核选定 pi，见[Agent 内核选型](2026-10-24-agent-runtime-pi.md)。

## Proposal

### 当前实现边界

01 的写请求 CORS、主密钥与字段加密、日志脱敏、事件契约、SSE 和 renderer client 已落地；当前实现事实由[engine 服务](../../implemented/architecture/2026-10-24-engine-service.md)、[基础设施](../../implemented/architecture/2026-10-24-engine-and-renderer-foundation.md)、[桌面壳](../../implemented/architecture/2026-10-24-desktop-shell.md)和[共享契约](../../implemented/architecture/2026-10-24-shared-contracts.md)持有。02 已实现渠道与模型管理、默认模型和四种文本协议的两步测试。03 已实现图片档案与三种图片协议、持久化任务调度与恢复、sha256 媒体落盘和 `frame-media://`。04 已实现 ffprobe 预检、S3 兼容对象存储、三种视频协议和对象存储设置；Windows x64 新版 NSIS 安装后 ffprobe 实测通过。05 已实现 OpenAI Speech 与 MiniMax T2A 适配器和音频落盘。临时模型测试页已删除，图片／视频入口由画布承接，文本与 TTS 暂无业务界面。真实供应商冒烟、时间戳能力核对及 NSIS 人工验收仍待具备外部账号的环境执行，本篇保持 proposed。

### 调研依据

2026-10-24 的调研结论，属于记录时的事实，上游可能变化：

- **[basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)**（读取 `web/src/stores/use-config-store.ts`、`web/src/services/api/video.ts`、`web/src/services/api/model-plugin.ts`）
  - 数据结构：`ModelChannel { baseUrl, apiKey, apiFormat: "openai" | "gemini", models: [{ name, capability, script? }] }`。模型用"渠道 ID::模型名"引用，能力分 image、video、text、audio，每种能力各有一个默认模型。
  - 视频兼容 OpenAI 的 `/v1/videos` 和 Gemini 长任务。
  - 不足：
    - Key 明文存在浏览器 localStorage。
    - 新拉取的模型按名称关键词猜能力（`guessCapability`）。
    - 轮询在页面内进行，5 分钟超时，重启后任务丢失。
    - 用户脚本用 `new Function` 执行，并能直接拿到 apiKey。
- **本机 MiniMax Design 3.0.14**（解包 `resources/` 的 gateway 模块与 `conf/external_api_conf.yaml`）
  - 所有媒体请求经它自家的云网关，配置注释写明"本地 Gateway 仅通过 cloud_gateway 调用云端服务，不直接持有第三方 API 密钥"，用户不能自配渠道。
  - 值得借鉴：
    - `packages/protocol` 的 `model-registry`：每个模型声明参数下拉选项与默认值、参考图／视频／音频上限、输入图尺寸限制，以及 `paramConstraints` 组合约束。
    - 后端接口拆成 `submitOnly` 与 `queryOnce`。失败按 `unknown_before_submit`、`unknown_after_submit`、`shutdown`、`cloud_transient` 分类后再决定是否恢复。
    - 下载结果后用 ffprobe 读元数据，按模型限制并发。
  - 进行中的任务存在 `active-generations.json` 文件里。
- **文本协议与 pi-ai**
  - [pi-ai](https://github.com/earendil-works/pi/tree/main/packages/ai) 的 `KnownApi` 包含 `openai-responses`、`openai-completions`、`anthropic-messages`、`google-generative-ai` 等。支持用 `createProvider` 自定义 baseUrl，并在一个 provider 里按 `model.api` 分派到不同协议。
  - pi-ai 还提供按协议的 compat 开关，以及由 models.dev 和 OpenRouter 生成的内置目录。
  - 生图只有 `openrouter-images`，没有视频和 TTS。
  - 中转站按模型选协议的做法见 [Cherry Studio 自定义服务商](https://docs.cherryai.com.cn/docs/en-us/pre-basic/providers/zi-ding-yi-fu-wu-shang.md)。协议转换丢失工具调用和推理内容的修复见 [new-api PR #2970](https://github.com/QuantumNous/new-api/pull/2970)。
- **媒体接口**
  - [方舟视频任务](https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh)
    - `content[]` 按 role 区分首帧、尾帧和参考素材。
    - 参考视频只接受公网 URL 或 `asset://`，不接受 Base64；请求体上限 64 MB。
    - 结果 URL 有效 24 小时，只有排队中的任务可以取消。
  - [方舟素材资产](https://docs.volcengine.com/docs/ark/create-asset-api?lang=zh)上传视频、音频时也只收 URL。
  - [MiniMax V2 视频](https://platform.minimax.io/docs/api-reference/video-generation-v2-create.md)结构与方舟相近。
  - 中转站的视频格式不统一：new-api 有自有的 `/v1/video/generations` 和兼容 Sora 的 `/v1/videos`；[OpenRouter 视频](https://openrouter.ai/docs/guides/overview/multimodal/video-generation)最规整。
  - 以下各项只看到了检索摘要，没有读到原文，必须用真实接口核对：Gemini 图像、Veo、OpenAI Images、Sora 和 OpenAI TTS 的字段细节。

### 概念与数据

| 概念 | 含义 |
| --- | --- |
| 渠道 `channel` | 一个平台账号：API 格式、Base URL、密钥、附加请求头 |
| 渠道模型 `channel_model` | 渠道下一个可调用的模型：上游模型 ID、类别、协议、能力档案、用户覆盖项 |
| 能力档案 `model_profile` | 随应用发布的模型说明：生成模式、参数取值与默认值、组合约束、输入限制、并发与轮询默认值 |
| 默认模型 | 每个类别一个默认渠道模型，业务功能未指定时使用 |

SQLite 表，由 Drizzle 生成迁移，各领域模块拥有自己的 `*.schema.ts`：

- `channels`：`id, name, api_format, base_url, api_key_cipher, key_hint, headers_cipher, header_names, enabled, last_check_json, created_at, updated_at`。密钥与请求头值加密保存，公开接口仅返回 `hasKey`、密钥尾号和请求头名称。
- `channel_models`：
  - 字段：`id, channel_id → channels(on delete cascade), upstream_model_id, display_name, kind(chat|image|video|tts), protocol, profile_id, overrides_json, enabled, last_check_json`。
  - 唯一约束：`(channel_id, upstream_model_id, protocol)`；未选协议在库内用空字符串表示、接口仍返回 null，避免 SQLite 的 NULL 绕过唯一约束。
- `model_defaults`：`kind 主键, channel_model_id → channel_models(on delete set null)`。
- `generation_jobs`、`media_files`、`object_uploads`、`object_storage_config`：见后文。

渠道最初设计了预设 `preset`；它实际还决定拉取模型列表的鉴权，已由渠道级 API 格式 `api_format` 取代，见[以渠道为中心的模型设置](../../implemented/feature/2026-10-25-channel-centric-model-settings.md)。API 格式只决定拉取方式和新文本模型的默认协议，调用仍按模型协议分派。

### 文本模型

02 的实现精确锁定 pi-ai 1.4.0，按渠道创建 provider、按模型协议分派。附加请求头与 API Key 一样加密，读接口只返回请求头名称；空密钥表示清除，未传表示保留。未知模型使用保守元数据并标记需确认；覆盖项经过运行时校验。拉取列表采用 API 格式对应的路径和鉴权，只返回候选 ID 不写库，由用户勾选后随渠道一并保存；不按名称猜类别。连通测试与文本流均限制时长，错误只返回本地分类，不透传上游正文或凭据。媒体档案及其协议在 03～05 接入；02 只保留档案 ID 和覆盖项的数据位置。

pi 的完整内置目录会加载供应商 SDK，因此运行时和目录在首次使用文本模型时动态导入并复用同一个 Promise，避免无模型配置的引擎启动与健康接口承担这部分开销；代价是首次配置或调用文本模型稍慢。

四种协议均关闭自动重试并禁止携带凭据跟随重定向。Gemini SDK 不接受自定义 fetch，因此 `modules/llm/google-transport.ts` 为每次调用临时监听 `127.0.0.1:0`，用随机路径仅接受该次 SDK 的 POST，将请求转发到固定 Base URL 并设置 `redirect: 'error'`；结束或取消时关闭连接与监听。这样保留 SDK 的原生流解码，代价是单次调用多一跳本地 HTTP 和临时端口。Gemini 的 Base URL 包含 `/v1beta`（地址示例已提示），其他协议沿用各自的路径约定。四协议模拟服务已覆盖文本、工具、用量、HTTP 错误分类和重定向拦截；真实供应商验证留到 05。

renderer 的文本对话只保存在当前页面；切换模型时清空并取消旧流，失败或取消的轮次不进入后续上下文。每次最多 25 轮、每条输入最多 32,000 字符，清空后可继续；这里只做文本和可展开的推理内容，用量展示 token 原始数量，不换算金额。

pi-ai 的 `@google/genai` 与 `protobufjs` 间接依赖包含安装脚本；沿用仓库显式 `allowBuilds` 策略禁用，运行时使用包内已发布的 JavaScript，并通过协议测试验证。接口依据为 [pi-ai 1.4.0 npm 包](https://www.npmjs.com/package/@earendil-works/pi-ai/v/1.4.0)内的 README 和类型声明；版本信息基于本次在线查询，后续可能变化。

- 协议枚举直接用 pi 的取值：`openai-responses | openai-completions | anthropic-messages | google-generative-ai`。不另做一层映射。
- 新建 `modules/llm`，它是唯一 import `@earendil-works/pi-ai` 的模块。`modules/agent` 是唯一 import `@earendil-works/pi-agent-core` 的模块。
- 每个渠道对应一个 pi provider，渠道模型转换成 pi 的 `Model`。pi 精确锁版本。
- 上下文长度、最大输出、是否支持推理、是否支持图片输入、compat 开关：
  - 默认值来自 pi 内置目录，按上游模型 ID 精确匹配；
  - 匹配不上时用保守默认值，并标为"需确认"；
  - 用户可以在渠道模型上覆盖。
- 连通测试分两步：
  1. 拉取模型列表，或发最小请求，校验地址和密钥。
  2. 按所选协议发一个带单个工具定义的最小流式请求，检查文本增量、工具调用、用量统计是否完整；标了推理能力的模型，再检查是否收到 thinking 事件。
  - 测试结果写入渠道或渠道模型的 `last_check_json`。

### 媒体模型：协议适配器加能力档案

适配器按线上协议写，不按模型写。适配器位于 `modules/generation/adapters/<protocol>.ts`，接口如下：

```ts
interface GenerationAdapter {
  protocol: MediaProtocol;
  // 把规范化请求翻译成厂商请求；同步模型直接返回产物，异步模型返回远端任务 ID
  submit(ctx: AdapterContext, request: NormalizedRequest): Promise<SubmitResult>;
  // 查询一次异步任务，不在内部循环等待
  query?(ctx: AdapterContext, remoteTaskId: string): Promise<QueryResult>;
  // 只有厂商支持取消时才实现
  cancel?(ctx: AdapterContext, remoteTaskId: string): Promise<void>;
}
```

- `SubmitResult` / `QueryResult` 统一为三种情况：运行中；成功，带产物列表（远程 URL 或字节、MIME、用量原文）；失败，带错误类别、厂商错误码和厂商消息。
- 首批协议按覆盖面排序：

  | 阶段 | 协议 |
  | --- | --- |
  | 图片 | `openai-images`（gpt-image 系列及兼容中转站）、`gemini-image`（nano-banana 系列）、`ark-images`（Seedream） |
  | 视频 | `ark-video-tasks`（Seedance）、`minimax-video-v2`（H3）、`openai-videos`（Sora 兼容格式，也覆盖 new-api、aihubmix 的同类接口） |
  | TTS | `openai-speech`、`minimax-t2a` |

- 能力档案的 zod schema 放在 `packages/contracts`，与之配套的纯函数 `checkGenerationRequest(profile, request)` 也放在 contracts。renderer 用它禁用不可选的项，engine 用同一个函数在提交前强制校验。
- 内置档案数据放在 `modules/generation/profiles/`，通过 `GET /model-profiles` 提供给 renderer，不在 renderer 里复制一份。档案字段：
  - `id`、`kind`、`protocol`；`matchIds` 为上游 ID、别名或前缀。图片按最长前缀匹配模型族，显式 `profileId` 优先；视频与 TTS 保持精确匹配。
  - `modes`：文生、首帧、首尾帧、仅尾帧、全模态参考。
  - `params`：每个参数的类型、可选值或取值范围、默认值，以及是否映射到厂商字段。
  - `constraints`：组合约束。规则形如"当参数或输入满足条件时，限制另一参数的可选值，或禁止某类输入"。
  - `inputs`：图片、视频、音频各自的数量上限、单个大小、尺寸、时长、格式，以及传输方式 `inline | url`。
  - `runtime`：默认并发数、轮询初始间隔、最大间隔、总等待上限、是否支持取消。
- 每个类别再提供一份通用档案，例如"通用 OpenAI 图片"，只开放最基础的参数。上游 ID 匹配不上内置档案的渠道模型使用通用档案，并提示用户确认。不按模型名称关键词猜类别，拉取到的未知模型由用户选择类别后才能启用。
- 厂商特有、档案未建模的参数，只能通过档案声明的透传白名单传入，不接受任意字段。不提供用户自定义调用脚本。

[画布图片节点改造](../feature/2026-10-26-canvas-image-node.md)已完成 contracts 与 engine 部分：图片有 GPT Image 1／2／2.5、Gemini 2.5 Flash／3 Pro／3.1 Flash、Seedream 4.0／4.5 共 8 个模型族及 3 个通用档案，档案声明比例、清晰度、画质、背景与可选取值标签 `notes`。旧 `*-default` ID 保留，分别对应 GPT Image 1、Gemini 2.5 Flash、Seedream 4.0；显式选择不随模型前缀改变。任务按创建时保存的档案快照执行，三个适配器显式翻译语义参数，不整体展开 `request.params`；Seedream 产物声明 JPEG，媒体入库按真实文件头识别。画布参数界面与多任务尚未完成，真实供应商冒烟仍待验收。

### 生成任务

03 实施采用现有 Nest 模块、Drizzle 迁移与 EventBus；调度状态和重试时刻以 SQLite 为准，进程内只保留正在执行的 AbortController。图片尺寸使用精确锁定的 `image-size`，避免为读取元数据引入原生图像运行时。三个同步图片协议复用统一提交、分类与下载流程；请求参考图先验证真实格式和尺寸并以 sha256 保存，数据库不写入 Base64。同步提交中断一律保守处理，只有明确未受理的连接错误和 429 自动退避。媒体协议自行处理单区间 Range，避免依赖 Electron 对 file URL 的隐含行为。档案和参数白名单由 engine 发布，renderer 复用 contracts 预检。

所有图片、视频、TTS 调用都写入 `generation_jobs`，包括同步模型。字段：

```text
id, kind, channel_model_id, profile_id, status, request_json, remote_task_id,
remote_status, attempts, next_poll_at, error_category, error_code, error_message,
usage_json, raw_response_json, outputs_json, source(manual|agent|canvas),
created_at, updated_at, finished_at
```

- **状态机**：

  ```text
  pending ─▶ submitting ─▶ running ─▶ downloading ─▶ succeeded
                │             │            │
                ▼             ▼            ▼
          submit_unknown    failed / cancelled
  ```

  - `pending`：本地已校验，等待并发名额。
  - `submitting`：请求已发出。同步模型的结果在此阶段返回后直接进入 `downloading`。
  - `running`：远端已受理，`remote_status` 保存厂商的 queued/running 等原值。
  - `submit_unknown`：无法判断远端是否已受理，也就无法判断是否已扣费。
- **防重复扣费**
  - 提交前先写入本地任务；拿到远端任务 ID 后，在同一事务中回填 ID 并更新状态。
  - 提交阶段出现以下情况，进入 `submit_unknown`：连接已建立后超时、连接被重置、5xx 且响应中没有任务 ID、engine 在 `submitting` 状态下退出。系统不自动重提，只能由用户在界面上选择"重新提交"或"放弃"。
  - 能确定请求未被受理的错误可以安全重试：DNS 失败、连接被拒、明确的 429、参数校验 400。
- **轮询**：由 engine 内的调度器按 `next_poll_at` 执行。间隔从档案的初始值逐步退避到最大值，例如 5 秒到 30 秒。查询时遇到网络错误、5xx 或 429 继续退避，不算失败。超过总等待上限记为 `failed/timeout`，保留远端任务 ID，用户可以手动"重新查询"。
- **启动恢复**：engine 监听前完成迁移，启动后按状态恢复任务：

  | 状态 | 恢复动作 |
  | --- | --- |
  | `pending` | 重新排队 |
  | `running` | 继续轮询 |
  | `downloading` | 重新下载；链接过期且协议支持重新查询时，先重新查询获取新链接 |
  | `submitting` | 改为 `submit_unknown` |

- **并发**：按渠道模型限制同时处于 submitting、running、downloading 状态的任务数。默认值来自档案，用户可以在渠道模型上覆盖。
- **取消**：适配器支持取消、且远端状态允许时，调用远端取消；否则只在本地标为 `cancelled` 并停止轮询，界面提示"远端可能仍在运行并计费"。
- **错误类别**：`auth | quota | rate_limit | moderation | invalid_params | input_unreachable | timeout | upstream | network | unknown`。界面按类别给出中文提示，原始错误码和消息保留在任务记录里。
- **结果落盘**：成功后立即下载远程结果，或直接写入返回的字节。文件存为 `<userData>/media/<sha256>.<ext>`，并写一行 `media_files`：`sha256 主键, mime, bytes, width, height, duration_ms, created_at`。图片读取尺寸，音视频用 ffprobe 读时长和尺寸。`outputs_json` 只引用 sha256；远程 URL 只作为临时字段，不能作为结果使用。
- **请求记录**：`request_json` 中内联的 base64 素材替换为 sha256 引用，避免数据库膨胀，也便于审计。
- 上述行为包装成 `GenerationService` 供手动界面、画布和 Agent 共用。Agent 工具提交后立即返回任务 ID，完成事件再通过 `followUp` 交回 Agent，与 pi 选型的耗时任务约定一致。

### 参考素材与对象存储

- **参考图**：
  - 档案允许内联、且未超过大小上限时，以 base64 data URL 或 multipart 文件随请求发送，不需要对象存储。
  - 档案要求 URL 时，按参考视频的方式处理。
  - 超过上限时，在提交前拦下并提示。
- **参考视频和参考音频**：这次定死一条路径，用户必须先配置第三方云对象存储，才能使用这两类参考。
  - 未配置时，renderer 禁用对应入口，并提示"请先在设置中配置对象存储"；engine 也拒绝这类请求，返回 `DomainError('OBJECT_STORAGE_REQUIRED')`。
  - 已配置时，engine 把素材上传到用户的存储桶，然后为每次提交生成预签名 GET 链接交给厂商，存储桶保持私有。
- **对象存储**
  - 只支持 S3 兼容协议，如 Cloudflare R2、阿里云 OSS、腾讯云 COS、火山引擎 TOS、AWS S3。全局只配置一个存储桶。
  - 配置项：`endpoint, region, bucket, access_key_id, secret_cipher, force_path_style, key_prefix, presign_ttl_seconds`。预签名有效期默认 24 小时，可设 1 小时到 7 天。默认值取得偏长，是因为厂商可能在任务排队结束后才下载素材。
  - 连接测试：上传一个小测试对象，生成预签名链接，用不带凭据的请求下载并比对内容，再删除测试对象。四步都成功才算通过。
  - 对象键：`<key_prefix>/<sha256>.<ext>`，保留扩展名，供按后缀识别格式的厂商使用。`object_uploads` 记录 `(sha256, storage_fingerprint)` 到对象键和上传时间，同一素材不重复上传；更换存储桶后指纹变化，素材会重新上传。预签名链接不缓存，每次提交时重新生成。
  - 应用不自动删除远端对象。设置页建议用户为存储桶配置生命周期规则，例如 7 天后过期，并说明一点：素材会上传到你的存储桶，再由所选厂商通过链接下载。
- **提交前预检**：用 ffprobe 检查时长、帧率、分辨率、编码、单个大小和总时长，按档案限制拦截。首期不做自动转码或压缩。
- **以后的优化，本期不做**：厂商上传接口（MiniMax `mm_file://`、Gemini Files API），复用厂商结果链接（如方舟信任本账号 30 天内生成的视频），方舟音频 Base64 内联。
- **签名实现**：04 选用精确锁定的 `aws4fetch@1.0.20`，仅使用签名能力，上传与下载的超时、重定向和重试由 engine 控制。npm 包解包 65,541 字节，无庞大服务 SDK；最后发布于 2024-08-28，维护频率低，需要 AWS 官方固定向量和模拟 S3 回归兜底。`@aws-sdk/client-s3@3.1156.0` 的最强理由是 AWS 官方维护、2026-10-22 仍有发布，服务与错误类型更完整；但仅本包即 3,312,166 字节，另有传递依赖，当前仅 PUT、DELETE 和 GET 预签名，不选完整 SDK。数据来自 2026-10-25 npm 查询，后续可能变化；来源：[aws4fetch](https://www.npmjs.com/package/aws4fetch)、[AWS SDK](https://www.npmjs.com/package/@aws-sdk/client-s3)。每次预签名加入参与签名的请求随机标识，避免同秒提交共用链接。
- **ffprobe 分发**：04 选 `@ffprobe-installer/ffprobe@2.1.2` 的平台预编译依赖，开发和生产均通过包的 `path` 定位；随现有 engine 的生产依赖部署，无额外复制脚本。Windows x64 二进制包版本 5.1.0，解包约 81 MB，增加安装体积；本期只探测，不引入 ffmpeg 或转码。来源：[安装包](https://www.npmjs.com/package/@ffprobe-installer/ffprobe)。
- **04 协议核对**：MiniMax 使用 `/v2/video_generation` 与 `/v2/query/video_generation/{id}`，H3、Highspeed、Lite、Max 各有独立限制，不能套用旧 Hailuo V1；来源：[创建](https://platform.minimax.io/docs/api-reference/video-generation-v2-create)、[查询](https://platform.minimax.io/docs/api-reference/video-generation-v2-query)。OpenAI 格式保留给兼容渠道；官方 SDK 已标注 Sora API 于 2026-09-24 停用，不把此适配器描述为官方服务可用；来源：[官方 SDK](https://github.com/openai/openai-node/blob/master/src/resources/videos.ts)。以上基于 2026-10-25 在线核对，真实厂商及中转差异留给 05 冒烟验证。

### 密钥与日志

- **主密钥**
  - 主进程首次启动时生成 32 字节主密钥，用 Electron `safeStorage`（Windows 底层为 DPAPI）加密后，原子写入 `<userData>/secret-key.bin`。
  - 每次启动时解密，通过新增的环境变量 `FRAME_LOOM_SECRET_KEY`（64 位十六进制）交给 engine，与现有 token 的传递方式相同。engine 配置用 zod 校验格式。
  - `safeStorage` 不可用时，拒绝保存任何密钥，并在界面提示。
  - 异步解密暂时不可用时保留主密钥文件，不当作损坏。Electron 45.0.0 仅通过错误消息 `temporarily unavailable` 区分该情况，依据为[该版本源码](https://github.com/electron/electron/blob/v45.0.0/shell/browser/api/electron_api_safe_storage.cc)；升级 Electron 时要复核。重新封装或文件读写失败也不轮换主密钥，应用以空主密钥启动并提示重试。
  - Electron 45 已提供 `isAsyncEncryptionAvailable()`、`encryptStringAsync()`、`decryptStringAsync()`，主进程使用异步 API；解密返回 `{ result, shouldReEncrypt }`，需要重新加密时原子替换文件。依据为已安装的 45.0.0 类型定义及 [safeStorage 官方文档](https://www.electronjs.org/docs/latest/api/safe-storage)（2026-10-24 在线核对，上游可能变化）。
- **字段加密**：engine 用 AES-256-GCM 加密每个 API Key 和对象存储 Secret。存储格式为 `iv | tag | ciphertext`，附加认证数据（AAD）为"表名 + 行 ID"，防止密文在行之间被调换。
- **主密钥无法解密时**（例如用户目录迁到了另一台机器）：
  - 把旧文件改名为 `secret-key.bin.broken`，生成新主密钥；
  - engine 把无法解密的密钥字段标为"需重新填写"；
  - 不阻止 engine 启动，也不删除渠道配置。
- **对 renderer 只写不读**：接口只返回 `hasKey` 和打码后的末四位，例如 `sk-…abcd`。所有厂商请求都由 engine 发出，renderer 不直连厂商。
- **日志屏蔽**：`EngineLogger` 增加以下屏蔽项：
  - 请求头：`authorization`、`x-api-key`、`api-key`、`x-goog-api-key`；
  - URL 查询参数：`key=`；
  - 预签名参数：`X-Amz-Signature`、`X-Amz-Credential`，以及 OSS、COS 的同类签名参数；
  - 已解密的密钥值本身。
- **安全边界**：DPAPI 与环境变量都防不住同一用户下能读取进程环境的恶意程序。这与现有 token 的安全边界一致。

### HTTP、推送与媒体访问

- **HTTP 方法**：第一批非 GET 接口上线时，同一提交内把 CORS 的 `methods` 放开到 `GET, POST, PATCH, PUT, DELETE`，`allowedHeaders` 加 `Content-Type`，并补预检测试，这是[基础设施笔记](../../implemented/architecture/2026-10-24-engine-and-renderer-foundation.md)的要求。
- **接口草案**，路径以实施为准：

  | 资源 | 接口 |
  | --- | --- |
  | 渠道 | `/channels`、`/channels/:id`、`/channels/:id/test`、`/channels/probe-models`（草稿拉取，不写库） |
  | 渠道模型 | `/channels/:id/models`、`/channel-models/:id`、`/channel-models/:id/test` |
  | 档案与默认模型 | `/model-profiles`、`/model-defaults` |
  | 对象存储 | `/object-storage`、`/object-storage/test` |
  | 生成任务 | `/generation-jobs`、`/generation-jobs/:id`、`/generation-jobs/:id/{cancel,resubmit,requery}` |
  | 文本测试 | `/llm/test-chat`（流式） |
  | 事件 | `/events` |

  `GET /object-storage` 在尚未配置时返回 JSON `null`，仍保持 `application/json`；renderer 按 JSON 响应解析，不把空响应体当作未配置状态。

- **推送**：`GET /events` 是 engine 的第一个 SSE 端点，推送 `generation.job.updated` 等类型化事件，事件结构由 contracts 定义。renderer 的 engine client 加入 `stream()`：用 fetch 读流，token 放在请求头里。收到事件后更新对应的 TanStack Query 缓存。文本测试的流式响应复用同一个 `stream()`。
  - 01 的基础事件为 `heartbeat { timestamp }` 与 `generation.job.updated { jobId }`，通过 `type` 区分；任务事件只通知重新查询，完整任务数据与状态由 03 定义。心跳在连接建立时立即发送，此后每 15 秒一次；服务关闭时结束流。客户端返回异步迭代器，支持 AbortSignal 与提前结束迭代，不做自动重连或重放；重连后调用方重新拉取任务。
- **生成结果的显示**：`<img>` 和 `<video>` 不能携带 Bearer 请求头，所以由主进程注册只读的 `frame-media://<sha256>` 协议：
  - 只接受 64 位十六进制 sha256，只从 `<userData>/media/` 读取；
  - 视频播放需要支持 Range 请求；
  - CSP 的 `img-src` / `media-src` 加入该协议。
  - 无限画布 03 已为视频抽帧启用协议 CORS，成功响应仅允许当前可信 renderer origin（生产为应用源，开发为实际服务器源），不反射外部 Origin；CSP 不变。
  - Electron 45 下 `protocol.handle` 加 `net.fetch(file://…)` 是否处理 Range 请求，实施时验证；不支持时改为自行实现 Range。

### 界面

- **设置中心新增两个页签**：
  - "模型服务"：列表只显示渠道；渠道编辑页包含密钥打码显示、测试、拉取后勾选模型，以及模型的类别、协议、档案、测试和覆盖项，渠道与模型一次保存。"默认模型"为独立页签。细节见[以渠道为中心的模型设置](../../implemented/feature/2026-10-25-channel-centric-model-settings.md)。
  - "对象存储"：配置表单、连接测试、生命周期规则建议和隐私说明。
  - 两个页签都扩展 `settings-search.ts` 的页签枚举。
- **生成入口迁移到画布**：
  - 临时 `/model-lab` 路由、`features/model-lab` 与侧栏入口已按[无限画布](../../implemented/feature/2026-10-25-infinite-canvas.md)约定删除。
  - 图片、视频在画布节点内选择模型、按档案填写参数、提交任务并预览版本；任务接口与媒体服务继续复用。
  - 文本与 TTS 的临时测试界面随页面删除，engine 接口、适配器和测试保留；文本连接测试仍在模型设置内，尚无新的文本／配音业务界面。
- 新增界面遵守[UI 规范](../../../../docs/ui-guidelines.md)，并检查明暗两种模式。

### 本期不做

- 厂商回调与 webhook。
- 声音复刻、音色设计与音色管理。
- 金额换算，只保存用量原文。
- Midjourney 代理、Gemini Interactions API、fal、Replicate、Veo、可灵。
- 批量多张或多条生成。
- 渠道负载均衡与故障转移。
- 自动转码、压缩，以及远端对象的自动清理。
- 用户自定义调用脚本。

### 相关笔记核对

- [Agent 内核选型](2026-10-24-agent-runtime-pi.md)：部分重叠。pi 的导入边界从"只有 agent 模块"细化为"pi-ai 只在 `modules/llm`，pi-agent-core 只在 `modules/agent`"，已在该篇原地同步并互链；选型理由不变。
- [应用骨架](../../implemented/architecture/2026-10-24-desktop-stack-and-process-model.md)：部分重叠。表中"AI 接入"一行的后续边界由本篇细化；媒体 SHA-256 存储、ffprobe 的引入时机由本篇确定。进程模型和鉴权边界不变，已互链。
- [基础设施](../../implemented/architecture/2026-10-24-engine-and-renderer-foundation.md)：部分重叠。延后的 `modules/jobs` 由本篇的 `modules/generation` 承接；01 已引入 `core/events`、SSE 与 client 写请求／事件流，按原约定放开 CORS 并补预检测试，已原地同步并互链。
- [engine 服务](../../implemented/architecture/2026-10-24-engine-service.md)：部分重叠。01 已新增 `FRAME_LOOM_SECRET_KEY`、AES-GCM 字段加密与日志屏蔽项，原地同步当前实现；鉴权与启动边界不变。
- [主题与外壳](../../implemented/feature/2026-10-24-theme-and-app-shell.md)：部分重叠。02 已原地同步侧栏模型测试入口与模型服务页签；`frame-media:` 仍由 03 落地后同步。
- 其他流程类笔记无关。

## Alternatives considered

- **按模型写后端服务**（MiniMax Design 的做法，`seedance.service.js`、`kling.service.js` 等每家一个服务）
  - 最强理由：每个模型的特殊行为都能写在一处，参数映射直观，它在自家云网关下已经过验证。
  - 不选的原因：帧织的渠道由用户配置，同一个 Seedance 可能经方舟、OpenRouter、new-api 三条协议接入，按模型写会让代码量成倍增长。按协议写适配器，再用档案描述模型差异，新增模型通常只需加一份档案。
- **每个渠道只设一个协议**（infinite-canvas 的 `apiFormat`）
  - 最强理由：表单最简单，用户只需选一次。
  - 不选的原因：同一个中转站上常常 GPT 走 Responses、Claude 走 Anthropic；渠道级协议要么迫使用户为同一中转站建多个渠道，要么让部分模型经过有损的协议转换。
- **按模型名称关键词自动判断类别**（infinite-canvas 的 `guessCapability`）
  - 最强理由：拉取模型后零操作，体验顺滑。
  - 不选的原因：中转站的模型命名没有规律，猜错后请求会走错协议，用户还会把报错误当成模型故障。类别与协议仍由用户选择；选定图片协议后才按已声明的模型族前缀匹配能力，视频与 TTS 保持精确匹配，未知 ID 使用对应协议的通用档案。
- **用户自定义调用脚本**（infinite-canvas 的 model-plugin）
  - 最强理由：不发版也能接入任意接口，覆盖面最广。
  - 不选的原因：脚本执行任意代码，并能直接拿到明文密钥；放在拥有本地文件和数据库权限的 engine 里执行风险更高。用户确认不提供。通用档案加透传白名单能覆盖大部分"兼容但有少量差异"的接口。
- **进行中的任务存 JSON 文件**（MiniMax Design 的 `active-generations.json`）
  - 最强理由：不依赖数据库，结构可以随意演进。
  - 不选的原因：engine 已有 WAL 模式的 SQLite。回填远端任务 ID 和状态需要与其他记录在同一事务中完成，用文件就得自己处理原子写和并发。
- **参考视频和参考音频按优先级混合传输**：依次尝试内联、厂商上传接口、复用未过期的结果链接、对象存储。
  - 最强理由：能用厂商上传接口的平台（MiniMax、Gemini）无需对象存储，门槛最低。
  - 不选的原因：每个协议的可用路径都不同，校验、错误提示和验收组合都会成倍增加。方舟的参考视频无论如何都需要公网 URL。用户决定本期统一要求对象存储，其他路径记为后续优化。
- **临时暴露本地 engine 给厂商下载**（cloudflared 或 ngrok 一类隧道）
  - 最强理由：零配置，不需要任何云账号。
  - 不选的原因：会把带鉴权的本地服务暴露到公网，并依赖第三方隧道的可用性。厂商下载失败时，用户也难以判断原因。
- **免费临时文件托管**
  - 最强理由：零配置，每个文件都有公网 URL。
  - 不选的原因：用户素材交给不受控的第三方，隐私和服务条款都有风险，链接寿命也不可控。
- **每个密钥直接用 safeStorage 加密，由主进程解密**
  - 最强理由：主密钥不出现在环境变量里，每个密钥都由操作系统保护。
  - 不选的原因：engine 每次调用厂商都需要密钥。主进程解密意味着每次调用都要绕一次 IPC，否则 engine 就得依赖 Electron，这违背了 engine 可独立运行的边界。主密钥经环境变量传递，与现有 token 的边界一致。
- **API Key 保存在 renderer**（infinite-canvas 的 localStorage）
  - 最强理由：实现最少，前端可以直接调用厂商接口。
  - 不选的原因：密钥会以明文形式出现在页面的存储和网络面板里，还要放宽 CSP 的 `connect-src`，与现有加固方向冲突。
- **把"模型测试"放进设置中心**
  - 最强理由：不增加导航入口，删除时也只改设置页。
  - 不选的原因：生成任务需要较大的预览区和任务列表，弹窗空间不够。用户选择左栏独立页面，并约定删除条件。

## Acceptance criteria

自动测试，进入 `pnpm test` 与 CI：

1. **contracts**：渠道、渠道模型、档案、生成请求、事件的 schema，覆盖合法输入、必填项、非法枚举。`checkGenerationRequest` 至少覆盖三条约束：首尾帧与全模态参考互斥、分辨率与时长联动、参考数量上限。
2. **适配器**：每个首批协议用录制的样例断言请求体与解析结果，覆盖成功、审核拒绝、429、鉴权失败、链接过期。异步协议覆盖排队、运行、成功、失败。
3. **engine 集成**：用临时目录中的真实 SQLite，加上监听 `127.0.0.1:0` 的模拟厂商服务，覆盖：
   - 视频任务从提交、轮询到下载，最后在 `media/` 中出现以 sha256 命名的文件；
   - 提交超时进入 `submit_unknown`，并断言模拟服务只收到一次提交；
   - engine 在 `running` 状态下退出，重启后继续轮询并完成；
   - 并发上限生效；
   - 查询时 429 退避而不失败；
   - 下载失败后重试；
   - 未配置对象存储时，参考视频请求返回 `OBJECT_STORAGE_REQUIRED`；
   - 配置了模拟 S3 服务时，同一素材只上传一次，每次提交的预签名链接不同。
4. **密钥**：数据库文件、接口响应、stderr 日志中都搜不到测试用的明文 Key；调换两行的密文后解密失败；主密钥损坏时 engine 照常启动，并把渠道标为"需重新填写"。
5. **SigV4 签名**：用 AWS 公布的测试向量验证签名实现。
6. **文本模型**：用模拟的 Responses、Chat Completions、Anthropic Messages 流式服务，测试 `modules/llm` 的连通测试，判断工具调用和用量是否完整。grep 检查 pi-ai 只在 `modules/llm` 中被导入。
7. **桌面 e2e**：在界面中添加指向模拟服务的渠道并测试；在画布节点生成图片，再以图片作首帧生成视频，预览及重启后版本保留。

真实接口冒烟，手动执行，不进 CI：

- engine 提供 `smoke:providers` 脚本。只有提供 `FRAME_LOOM_SMOKE_*` 环境变量时才运行，每个协议用最便宜的参数组合跑一次，并记录耗时、用量与响应字段。
- 结果用于核对调研中未验证的事实：gpt-image-2 的尺寸约束、Gemini 图像字段、Sora 兼容接口当前的可用性、厂商能否接受预签名链接，以及厂商下载参考素材的时机。核对结果原地写回本篇和对应的档案。

人工验收（开发环境与 NSIS 安装包各做一遍，明暗模式都检查）：

1. 添加一个中转站并拉取模型。一个 GPT 模型选 Responses、一个 Claude 模型选 Anthropic，两个都测试通过；填错 Key 时显示"鉴权失败"，填错地址时显示"无法连接"。
2. 重启后配置保留、Key 显示为打码值；用 SQLite 工具打开数据库，找不到明文 Key。
3. 用两个不同的图片协议各生成一张图片，并能在页面预览；文件位于 `media/`。
4. 用一个视频协议生成 5 秒视频；生成中关闭应用再打开，任务继续并完成，视频能拖动进度播放。
5. 生成中断网，任务退避重试；恢复网络后完成，到厂商后台核对只扣费一次。
6. 选择首尾帧模式时，参考素材入口被禁用并说明原因；未配置对象存储时，参考视频和参考音频入口被禁用并给出提示。
7. 配置 R2、OSS 等存储桶，连接测试通过；用参考视频生成成功；在存储桶中能看到以哈希命名的对象。
8. 用一个 TTS 协议生成配音并播放；支持时间戳的协议能显示时间戳。

## Risks

- **调研有缺口**：Gemini 图像、Veo、OpenAI Images、Sora 和 OpenAI TTS 的字段，以及各家限流数值，只读到了摘要。首批档案可能需要按冒烟结果修正，所以档案与适配器都要有录制样例测试兜底。
- **中转站差异大**：new-api 等中转站的视频字段因部署版本而异。`openai-videos` 适配器只承诺兼容 Sora 格式，不兼容的中转站需要新增协议，或通过透传白名单处理。
- **预签名链接可能失效或不可达**：
  - 厂商若拒绝带查询参数的链接，或在排队很久之后才下载素材，链接可能被拒或已过期，默认 24 小时有效期只能缓解。
  - 厂商访问海外存储桶可能慢或失败，表现为 `input_unreachable` 错误；只能提示用户选择离所用厂商近的地域。
- **ffprobe 打包**：已选 `@ffprobe-installer/ffprobe@2.1.2` 平台预编译包，作为 engine 生产依赖随部署树分发；开发环境、packaged layout 与 Windows x64 新版 NSIS 安装后均通过模拟视频验证，安装目录中的 `ffprobe.exe` 能读取 H.264、320x256、24 fps 与 2 秒时长。安装体积增加约 81 MB，详见本篇的分发决策。真实厂商冒烟与整体验收仍归 05。
- **pi API 变动快**：createProvider、compat 字段可能变化。缓解办法是精确锁版本、只在 `modules/llm` 中导入，升级单独提交并跑回归测试。
- **主密钥的可用性**：safeStorage 依赖操作系统用户凭据。用户迁移系统或重装后，所有密钥都需要重新填写；这是有意的取舍，界面必须给出明确提示。
- **SSE 推送丢事件**：连接断开期间会错过事件。renderer 重连后要重新拉取进行中的任务，不能只依赖事件。
- **临时页面迁移边界**：模型测试页已删除，图片／视频生成由画布承接；真实文本／TTS 冒烟通过 engine 脚本执行，后续业务界面另行设计。
- **回滚**：各阶段分开提交，可以单独 revert。迁移文件一旦分发，不重写；回退时新增反向迁移。

# Agent Note: 模型服务配置层重构（渠道＋模型、协议适配器、用户能力卡）

Status: implemented

## Problem

模型服务是画布生成、后续 Agent 与 TTS 的共同基建。现有实现经三轮演进（[模型管理](../../proposed/architecture/2026-10-24-model-management.md)、[接入路由](../../rejected/architecture/2026-10-27-model-service-protocol-routing.md)、[配置与模型演进](../../rejected/architecture/2026-10-27-model-service-experience-and-evolution.md)），留下以下结构性问题（2026-10-28 源码调查）：

1. **同一事实三处保存**：`channel_models` 冗余保存 `kind/protocol/profile_id/connection_json`，又引用 `definition_id/connection_id`，`model_catalog` 另存整份目录 JSON。每次读模型都要重新解析目录，任何定义异常都让读取抛错。
2. **新模型无法只靠数据接入**：导入定义必须是某个内置档案的子集（`model-catalog.service.ts` 的 `validateDefinition`），`MappingRule` 声明了却被服务端拒绝；内置档案按型号写死，`gpt-image-1`、Sora 已停服仍在默认档案中。
3. **参数直接透传**：多个视频适配器和 OpenAI 语音把 `...request.params` 整体展开发往上游，参数键就是供应商字段名；画布只能靠写死的键名单（`ratio/aspect_ratio/duration`）选控件。
4. **地址规则两套**：适配器内写死路径与 `service-routing.ts` 重复；MiniMax 去尾 `/v1` 的特例出现 5 处，MiniMax T2A 去 `/anthropic`。
5. **协议名分支散落**：尺寸换算 `imageRequestSize`、蒙版、音色字段、上传方式、幂等默认值都按协议名判断；可执行视频模式写死为 `text/frames/reference`；鉴权基本只有 Bearer。
6. **用户心智负担**：设置页要求理解渠道、目录协议、逻辑模型、接入四个概念，修改接入只能编辑整份目录 JSON；`model-services.tsx` 单文件 1372 行。

外部事实（2026-10-28 检索，来源见下文调研依据）：同一中转站内文本走 `/v1`、Gemini TTS 走 `/v1beta/models/{m}:generateContent`、MiniMax 视频走中转自定义的 `/minimax/v2/...`；new-api 与 Cherry Studio 都按模型标注协议。图像尺寸至少有四种互不兼容的表达，视频素材按用途区分且上限差异大，TTS 返回形态有二进制、base64、hex、URL 四种。模型更替以周计：OpenAI Videos/Sora 于 2026-09-24 下线，gpt-image-1 于 10-23 停服，Gemini API 的 Veo 3.1 Preview 于 10-22 下线，OpenAI TTS 将于 2027-01-06 停服，Anthropic 2026-10-21 API 版本移除 `temperature/top_p/top_k`。

约束：项目尚未发布首版，用户明确不需要兼容任何旧模型配置与生成任务；产品只接第三方 API，不做本地模型。

## Decision

### 已确认的决定

用户于 2026-10-28 逐项确认：

| 编号 | 决定 |
| --- | --- |
| D1 | 旧模型服务数据与生成任务记录直接清除，不写兼容层；项目文件、画布内容与已生成资产保留。 |
| D2 | 请求地址按协议推导并始终预览，允许粘贴完整地址覆盖。 |
| D3 | 不内置模型库；能力参数由用户填写，添加模型时用所选协议的默认模板预填。 |
| D4 | 协议用 TypeScript 代码适配器实现，本期不支持用户自定义协议；厂商私有字段用「附加参数」「固定请求字段」补齐。 |
| D5 | 首批 15 个协议见下文清单。 |
| D6 | 渠道不选协议，协议在模型上选择；渠道只保留「模型列表格式」高级项。 |
| D7 | 新增画布 TTS 音频节点，产物可连到视频节点作为参考音频；不导入本地音频素材。 |
| D8 | 视频能力按生成方式组织；协议固有限制（如「首尾帧时比例固定 adaptive」）写在协议规则中只读展示，不在每种方式里重复配置比例、时长等参数。 |
| D9 | 「生成数量」表示画布一次拆分的独立任务数上限，每个任务请求 1 张图，沿用[画布图片节点](../../implemented/feature/2026-10-26-canvas-image-node.md)「每张独立任务」的决定；本期不支持 Seedream 组图式「最多 N 张」。 |

### 概念与所有权

用户只面对「渠道」和「模型」：

| 对象 | 存放 | 职责 | 边界 |
| --- | --- | --- | --- |
| 渠道 Channel | SQLite | 服务地址、凭据、请求头、模型列表格式、渠道并发、启用 | never 持有协议或能力 |
| 模型 Model | SQLite | 类别、上游 ID、协议、地址覆盖、素材传输、能力卡、附加参数、固定字段、启用 | 能力卡归用户所有，完整保存 |
| 协议 Protocol | 代码，`packages/contracts` 描述 + `apps/engine` 执行 | 鉴权驱动、挂载前缀、操作路径、能力上限、协议规则、默认模板、请求翻译、响应解析、任务生命周期 | 用户只读；never 按渠道域名或模型名分支 |
| 任务 Job | SQLite | 冻结快照与执行状态 | 执行与恢复只读快照，never 读取当前配置 |

「接入」「逻辑模型」「档案」「绑定」「模型目录」「导入包」概念整体删除。

### 协议层

- **描述与执行分离**：`ProtocolDescriptor` 是放在 `packages/contracts` 的纯数据，renderer 与 engine 共用（模板、上限、规则、路径只有一份）；`ProtocolAdapter` 只在 engine 注册，负责构造请求、解析响应、查询、下载和音色列表。
- **一个协议可跨类别**：`gemini-generate` 同时服务文本、图像、TTS，各类别有独立的上限与模板。
- **鉴权驱动白名单**：`bearer`、`x-api-key`（附 `anthropic-version`）、`x-goog-api-key`、`xi-api-key`、`token`，预留 `jwt-aksk`。用户只填 API Key／Secret Key，never 描述签名算法。
- **协议规则只读**：规则以声明数据表达「在某方式／某参数取值下，另一参数被锁定或排除」，renderer 用来置灰并说明原因，engine 用来拒绝请求。用户不能编辑规则。
- **能力上限 ceiling**：声明协议能发送哪些功能（蒙版、透明背景、返回格式、编辑接口、尺寸发送方式、各类素材可选传输方式、支持的视频方式）。能力卡中上限之外的开关不显示，engine 也拒绝保存。
- **附加参数与固定字段**：按点号 JSON 路径写入请求体，不支持表达式；不得覆盖协议保留字段。multipart 协议只允许顶层字段。

首批协议（D5）：

| 类别 | 协议 id | 名称 | 标准前缀 | 关键操作 | 鉴权 |
| --- | --- | --- | --- | --- | --- |
| 文本 | `openai-chat` | OpenAI Chat Completions | `/v1` | `POST /chat/completions` | bearer |
| 文本 | `openai-responses` | OpenAI Responses | `/v1` | `POST /responses` | bearer |
| 文本 | `anthropic-messages` | Anthropic Messages | `/v1` | `POST /messages` | x-api-key |
| 文本、图像、TTS | `gemini-generate` | Gemini generateContent | `/v1beta` | `POST /models/{model}:generateContent` | x-goog-api-key |
| 图像 | `openai-images` | OpenAI Images | `/v1` | `POST /images/generations`、`POST /images/edits` | bearer |
| 图像 | `ark-seedream` | 方舟 Seedream | `/api/v3` | `POST /images/generations` | bearer |
| 视频 | `ark-seedance` | 方舟 Seedance | `/api/v3` | `POST /contents/generations/tasks`、`GET …/{id}` | bearer |
| 视频 | `dashscope-wan` | 百炼 Wan 视频 | `/api/v1` | `POST /services/aigc/video-generation/video-synthesis`、`GET /tasks/{id}` | bearer |
| 视频 | `minimax-video-v2` | MiniMax 视频 V2 | （空） | `POST /v2/video_generation`、`GET /v2/query/video_generation/{id}` | bearer |
| 视频 | `kling-omni` | 可灵 Omni（新版） | （空） | `POST /omni-video/{model}`、`GET /tasks?task_ids={id}` | bearer |
| 视频 | `openai-videos` | OpenAI Videos 兼容 | `/v1` | `POST /videos`、`GET /videos/{id}`、`GET /videos/{id}/content` | bearer |
| 视频 | `newapi-video` | new-api 统一视频 | `/v1` | `POST /video/generations`、`GET /video/generations/{id}` | bearer |
| TTS | `openai-speech` | OpenAI Speech | `/v1` | `POST /audio/speech` | bearer |
| TTS | `minimax-t2a` | MiniMax T2A v2 | `/v1` | `POST /t2a_v2`、`POST /get_voice` | bearer |
| TTS | `elevenlabs` | ElevenLabs | （空） | `POST /v1/text-to-speech/{voice_id}`、`GET /v2/voices` | xi-api-key |

文本协议的流式与工具调用继续由 pi-ai 执行（[Agent 内核选型](../../proposed/architecture/2026-10-24-agent-runtime-pi.md)的 import 边界不变），只把地址、凭据和采样参数白名单换成统一来源。

### 渠道与模型

- 渠道字段：名称、服务地址（原样保存用户粘贴的值，如 `https://liuguang.ai/v1`）、API Key；高级项为 Secret Key、自定义请求头（≤32 个，禁止覆盖鉴权与传输头）、模型列表格式（openai／anthropic／gemini，默认 openai）、渠道并发（默认 2）。服务地址只接受 http(s)，不得含凭据、查询或片段，不得以 `/chat/completions`、`/models` 等接口路径结尾。
- 模型字段：类别、上游 ID、显示名、协议（可为空，空时显示「待选协议」且不能启用）、地址覆盖、各类素材传输方式（auto／inline／url，可选值受协议上限约束）、能力卡、附加参数、固定字段、可选模型并发（只能收窄）、启用。
- **协议单一写入口**：`changeProtocol(model, nextId)` 返回新能力卡与不兼容字段清单，界面确认后写入。兼容值保留，不兼容值列出，never 静默清空用户改动。
- **能力卡完整保存**：协议模板只在添加或显式「恢复为协议默认」时使用；协议代码升级 never 改写已保存的能力卡。
- **空值语义统一**：数值留空（缺省）表示「不限，由服务商校验」，`0` 表示「不支持」。所有数值字段都遵守。
- **读取模型**：草稿请求不写库；候选的类别和协议只按接口返回的 `supported_endpoint_types`、模态字段推断，never 按模型名关键词猜。文本端点可推断协议；图像、视频、TTS 一律「待选协议」。批量添加在单个事务内完成，重复整体失败。
- 单个模型可导出为不含任何凭据的 JSON，并导入到任意渠道；导入只做本地校验与预览，不联网。

### 地址解析

`resolveEndpoints(channel, model, descriptor)` 是唯一实现，设置页预览、engine 执行、pi-ai 地址换算全部调用它；预览与实际请求 must 一致。

```text
origin        = baseUrl 的 协议 + 主机[:端口]
channelPrefix = baseUrl 路径末尾匹配的已知前缀（/api/v3、/api/v1、/v1beta、/v1），无则为空
deployPrefix  = baseUrl 路径去掉 channelPrefix 后的剩余部分（兼容 /gateway/v1）

1. operations 覆盖存在 → 直接使用
2. submitUrl 覆盖存在 → 若以提交操作路径结尾（占位段视为通配段）则挂载基址 = 去掉该后缀，其余操作 = 挂载基址 + 各自路径；否则其余操作必须逐项填写，缺失时不能启用
3. 协议 standardPrefix 等于 channelPrefix → baseUrl + 操作路径
4. 其余 → origin + deployPrefix + 协议 standardPrefix + 操作路径
```

- 最终地址的主机与渠道主机不同时，must 由用户确认并记录确认的主机；未确认不能启用。
- 结果下载地址 never 携带渠道凭据，只有协议声明为鉴权下载的操作（如 `openai-videos` 的 content）例外；重定向禁止携带凭据，路径参数逐段编码，拒绝 `..` 逃逸。
- 这推翻了[接入路由](../../rejected/architecture/2026-10-27-model-service-protocol-routing.md)「不补删 `/v1`」的决定：旧决定反对的是运行时暗中猜测，新规则是确定性推导且始终可见。

| 渠道 baseUrl | 协议 | 覆盖 | 结果 |
| --- | --- | --- | --- |
| `https://liuguang.ai/v1` | openai-responses | — | `https://liuguang.ai/v1/responses` |
| `https://liuguang.ai/v1` | gemini-generate | — | `https://liuguang.ai/v1beta/models/gemini-3.8-flash-tts:generateContent` |
| `https://liuguang.ai/v1` | minimax-video-v2 | `https://liuguang.ai/minimax/v2/video_generation` | 查询 `https://liuguang.ai/minimax/v2/query/video_generation/{id}` |
| `https://api.minimax.io` | minimax-video-v2 | — | `https://api.minimax.io/v2/video_generation` |
| `https://x.ai/gateway/v1` | gemini-generate | — | `https://x.ai/gateway/v1beta/models/…` |

### 能力卡

四类能力卡在 `packages/contracts` 用 zod 定义，前后端共用；字段元数据（标签、单位、空值说明）驱动设置页表单。

- **文本**：上下文长度、最大输出、输入模态（图片／PDF／音频）、工具调用、流式、推理档位、允许发送的采样参数。
- **图像**：参考图（数量、单张大小、格式）、蒙版语义（透明区域／黑色区域）、生成数量上限（D9）、尺寸（发送方式 `pixels/tier/ratio/none`；档位卡片含比例与像素，像素按协议换算规则自动计算并可手改；默认尺寸；自定义宽高约束；带参考图时的像素上限）、质量取值与默认、透明背景、返回格式、输出格式与压缩、seed、负向提示词、提示词字数。
- **视频**：生成方式（`t2v/first/last/first_last/keyframes/reference/edit/extend`；帧类、编辑、续写可勾选「可同时带参考素材」；关键帧数量；全模态参考接受的素材类型及「可同时带首尾帧」）、参考素材限制（图／视频／音频的数量、大小、单个时长、总时长，及所有素材合计上限）、时长（范围／固定值／交给模型）、比例、分辨率、声音（固定有声／固定无声／可开关／未确认）、水印、seed、提示词字数、提示词引用语法。首帧、尾帧固定各 1 张，大小沿用参考图限制。
- **TTS**：音色来源（预置／接口拉取／手填）与预置列表、指令文本、语速／音调／音量范围、输出格式与采样率、字数上限、多说话人上限。

有效能力 = 能力卡 ∩ 协议上限 ∩ 协议规则。`checkRequest` 与 `checkMedia` 是共享校验函数：renderer 用于预检和禁用原因，engine 用于强制拒绝，两侧 must 调用同一实现。

### 语义请求与执行

- 画布只提交语义请求：方式、提示词、带角色与顺序的素材（`first_frame/last_frame/keyframe/reference/base_video`）、语义参数、能力卡声明过的附加参数、图片编辑配方。适配器负责字段翻译、提示词引用改写、素材交付；never 整体展开参数对象。
- 素材交付只有内联（data URI／multipart 文件）与公网 URL 两类；URL 交付复用现有对象存储模块。本期首批协议没有供应商文件上传，`provider_uploads` 与相关上传复用代码删除。
- 任务提交前冻结快照：协议 id 与版本、上游模型 ID、各操作最终地址、能力卡、语义请求、实际请求体（素材以 sha256 表示）、渠道 id 与凭据指纹、素材 URL。凭据指纹变化时任务暂停，never 改用其他账号。有远端 ID 时只查询，提交结果不确定时进入 `submit_unknown`，never 自动重投；首批协议均不声明提交幂等。
- 渠道并发可配置，模型只能收窄；轮询节奏与超时由协议描述给出，不进入能力卡。同步提交的等待上限由适配器给出：OpenAI Images 的生成／编辑请求为 5 分钟，其他请求默认 60 秒；创建和恢复任务的截止时间采用同一上限。图片生成可能在返回 HTTP 200 响应头后继续传输，超时必须覆盖完整响应体。两次真实全景任务分别在 60.172／60.052 秒失败，因此不能将 200 当作已拿到图片。超时明确分类并显示中文原因，但已发出的提交仍保持 `submit_unknown`，禁止自动重发以避免重复计费。延长等待会更久占用并发槽，且不保证服务商一定在 5 分钟内返回；不提供无期限等待或能力卡超时配置。
- 持久任务内核、凭据加密（AES-256-GCM，主密钥经 safeStorage）、SSE 事件、ffprobe 探测、媒体落盘与项目写回保留。

### 设置页与画布

- 设置页：渠道列表 → 添加／编辑渠道（预设只预填服务地址与列表格式，不带模型）→ 渠道详情（类别筛选、搜索、读取模型、手动添加、模型行）→ 模型编辑弹窗（基本信息／能力与参数／附加参数三个标签；能力页右侧为画布参数预览）。媒体测试保留计费确认，测试结果绑定配置哈希，配置改动后失效。
- 请求体预览复用媒体适配器的 buildSubmit；文本复用 pi-ai 的 onPayload 并在请求发送前截断。预览不读取渠道凭据、不返回鉴权头、不建立上游连接；禁用模型也可以预览。首次选协议填完整模板，不把填充视为丢弃用户值；后续切换继续保留兼容值。文本测试的可选 steps 分别记录连接与回复结果，未执行的步骤不伪造成功。
- 画布：参数面板、视频方式标签、端口与素材限制全部由能力卡和协议规则驱动，删除所有写死的参数键与模式。被协议规则锁定的选项置灰并说明原因。切换模型保留提示词、素材和连线，不兼容参数进入 `pendingParams` 阻止提交。
- 画布宿主同时传递模型声明的 `extras`，用于渲染附加参数并执行同一份请求校验。`GenerationJob` 独立到 `generation-job.ts`；文本流事件、用量与文本测试 DTO 保留在 `llm.ts`，不依赖已删除的旧模型档案。文档在解析前根据尾帧连线迁移旧节点，再校验新语义数据，文件加载与剪贴板共用；待处理任务查询 404 时从当前文档及历史状态清除。
- 素材时长检查独立累计时长，即使能力卡只配置 `maxTotalSec` 而未配置单项上限，也必须拦截总时长超限。
- 项目任务在项目串行队列内预构造协议请求时，素材读取和对象存储上传复用已解析的项目根路径，不再次进入同一串行队列；队列外的执行与恢复仍使用带项目校验的读取入口，防止内联参考图和 URL 交付在创建任务阶段自锁。
- 新增音频节点：文本、音色、风格与输出参数按 TTS 能力卡渲染，产物写回版本历史并可连接到视频节点的参考音频端口。
- 音频节点复用媒体任务、版本和标签；音色目录由宿主提供，拉取失败不清除手填 ID。URL 素材的 E2E 启动器只在测试进程边界把示例公网存储请求转至本地严格 mock，同时拒绝其他外部连接；生产公网校验不放宽。
- 视频编辑、续写：能力卡、协议与画布「待编辑视频」端口在本需求内完成，首批由 `ark-seedance` 与 `kling-omni` 承接。
- 官方正文核对：Seedance 的 edit／extend 比例均 adaptive，只有 edit 固定 duration=-1，edit 输入至少 4 秒的限制以协议素材规则交给共享 checkMedia 执行；普通参考仍保留 2 秒下限。Kling 4.0 只确认 base_video 编辑，未声明续写，能力上限不开放 extend。

### 数据与删除范围

- 新增一个迁移，在既有 `VACUUM INTO` 自动备份之后删除并重建模型服务与生成任务相关表（`channels`、`channel_models`→`models`、`model_defaults`、`model_catalog`、`tts_voices`、`generation_jobs`、`provider_uploads`），清理相关 `app_meta` 键，不改写已发布迁移。`media_files`、对象存储、项目与画布表保留。
- 画布节点类型版本提升，迁移时丢弃无法识别的旧参数；节点中指向已删除任务的待处理任务 ID 在查询 404 时清除。
- 删除：`model-catalog.ts`、`service-routing.ts`、`generation-capabilities.ts` 与 `ModelProfile` 体系、`channels/model-catalog.service.ts`、`video-retirement.ts`、`generation/profiles/*`、`execution-contract.ts`、旧适配器与旧快照恢复分支、所有地址特例、设置页目录导入与升级报告、`docs/model-service-upgrade.md`、对应旧测试与 E2E。

### 测试与验收

同步图片超时修复的定向验证：HTTP 200 后延迟 65 秒的响应可读完，超过 5 分钟明确返回超时（虚拟时钟，不调用真实供应商）；本地集成测试验证任务截止时间、超时分类、禁止重提和重启不重发。HTTP、图片适配器和任务集成共 43 项通过；engine typecheck、lint、build 与笔记／计划校验通过。未重发历史全景任务，未验证真实中转站能否在新上限内返回。

共享契约覆盖 15 个唯一协议、模板、上限、空值语义、参数与素材规则、地址及尺寸解析。媒体适配器用 buildSubmit 精确断言请求，文本由 pi-ai 的实际本地模拟请求验证保留字段。官方来源与 2026-10-29 核对日期存入描述及 fixtures README。

全仓 typecheck、lint、format:check、build、test 通过：contracts 237、canvas 147、desktop 214、engine 261，共 859 用例。限定桌面 E2E 整组 9 passed／1 skipped，包含设置管理、图像与视频、音频生成播放及 reference_audio、视频编辑续写、图片编辑与真实 Vite Worker、旧文档迁移和重启写回；跳过的加固目录包属于明确排除范围。设置、图像、视频与音频明暗及 800×800 截图已查看，独立参数弹层位于窗口内，固定 620px 输入框沿用既定平移查看规则。

engine Vitest 全局 fetch 守卫只允许 127.0.0.1 并阻断自动重定向，守卫自身有拒绝外网／私网与本地 mock 的测试。严格模拟上游断言方法、路径、鉴权、请求体与次数，不调用真实模型或使用真实凭据；外网 URL 字面量仅用于解析／拒绝／签名断言，URL 素材 E2E 的示例公网存储在测试进程边界强制重写到本地。

验收范围不含真实服务、第二批协议、无关项目／外壳 E2E、打包、安装包、原生窗口和输入法。具体协议矩阵与本次证据见[验收记录](../../../../docs/model-service-acceptance.md)。

### 调研依据

以下为 2026-10-28 调研资料；协议实现于 2026-10-29 再核对，具体来源与日期保存在描述及验收记录：

| 主题 | 来源 | 结论 |
| --- | --- | --- |
| 中转站按模型标协议 | [new-api endpoint_type](https://github.com/QuantumNous/new-api/blob/b08febaa/constant/endpoint_type.go)、[Cherry Studio provider 解析](https://github.com/CherryHQ/cherry-studio/blob/main/docs/references/ai/provider-resolution.md) | 协议挂模型，渠道只给默认值；`/v1/models` 返回 `supported_endpoint_types` 可用于推断 |
| 中转站真实路径 | [new-api relay-router](https://raw.githubusercontent.com/QuantumNous/new-api/main/router/relay-router.go)、[video-router](https://raw.githubusercontent.com/QuantumNous/new-api/main/router/video-router.go)、[MiniMax V2 issue](https://github.com/QuantumNous/new-api/issues/6815) | Gemini 原生透传 `/v1beta`；视频有 `/v1/video/generations`、`/v1/videos` 与厂商前缀透传；`/minimax/v2/...` 是中转自定义 |
| 停服与协议变化 | [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations)、[Gemini Veo](https://ai.google.dev/gemini-api/docs/veo)、[Anthropic versioning](https://platform.claude.com/docs/en/api/versioning) | Sora/Videos API、gpt-image-1、Veo 3.1 Preview 已下线；OpenAI TTS 将停服；Anthropic 新版本禁采样参数 |
| 图像尺寸差异 | [OpenAI 图像](https://developers.openai.com/api/docs/guides/image-generation)、[Gemini 图像](https://ai.google.dev/gemini-api/docs/image-generation)、[方舟图像](https://ark.volcengine.com/region:cn-beijing/docs/image-generation-api)、[FLUX 3](https://docs.bfl.ml/api-reference/utility/generate-an-image-with-flux-3) | 像素约束、比例×档位、档位字符串、带参考图降上限并存；档位大小写不同 |
| 视频素材按用途区分 | [方舟视频任务](https://ark.volcengine.com/region:cn-beijing/docs/create-video-generation-task-api)、[Wan 3.0](https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-api-reference)、[MiniMax V2](https://platform.minimax.io/docs/api-reference/video-generation-v2-create)、[可灵 4.0 Omni](https://kling.ai/document-api/api/video/4-0/video-omni.md) | 单端点 + 带角色素材数组趋同；首尾帧与参考在多数模型互斥，可灵 4.0 允许混用 |
| TTS 形态 | [OpenAI TTS](https://platform.openai.com/docs/guides/text-to-speech)、[Gemini TTS](https://ai.google.dev/gemini-api/docs/speech-generation)、[MiniMax T2A](https://platform.minimax.io/docs/api-reference/speech-t2a-http)、[ElevenLabs](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) | 二进制、base64 PCM、hex、URL 并存；音色来源各异 |
| 同类产品 | BeefTV 本地源码（`D:/WorkSpace/project/personal/reference_projects/BeefTV`，`plugin-packages/*/manifest.json`、`web/src/lib/model-capabilities.ts`、`docs/architecture/protocol-decision-contract.md`） | 借鉴连接／模型／协议三层与开放能力参数；其默认能力前后端两份并按模型名正则匹配、协议写入点分散导致多轮缺陷、声明式迁移丢厂商参数，均不照搬 |

### 相关笔记当场审计

- [模型管理与调用](../../proposed/architecture/2026-10-24-model-management.md)：部分重叠。保留加密、pi-ai 边界、持久任务、媒体落盘与对象存储理由；渠道、档案、协议与地址的未来方向由本篇接管。互链，不拒绝。
- [接入路由](../../rejected/architecture/2026-10-27-model-service-protocol-routing.md)：方向被本篇推翻（地址规则、站点模板、旧快照），转 rejected；H3 路由故障与外层任务 ID 的教训保留在该篇供防坑。
- [配置与模型演进](../../rejected/architecture/2026-10-27-model-service-experience-and-evolution.md)：四层目录、七型号、有限映射、导入包与旧配置退出全部取消，转 rejected；平台中立（不内置站点模板、不按站名分派）由本篇继承。
- [以渠道为中心的模型设置](../../archived/feature/2026-10-25-channel-centric-model-settings.md)：已被本篇完全取代（渠道 API 格式、档案下拉、渠道与模型一次保存）；草稿拉取不写库、不按域名猜鉴权由本篇继承。通过归档脚本封印并保留互链。
- [画布图片节点](../../implemented/feature/2026-10-26-canvas-image-node.md)、[视频输入区](../../implemented/feature/2026-10-27-video-composer.md)、[图片编辑工具](../../implemented/feature/2026-10-28-canvas-image-edit-tools.md)、[图片编辑运行时修复](../../implemented/bug-fix/2026-10-28-canvas-image-edit-runtime.md)：部分重叠。保留语义参数、每张独立任务、@ 引用、素材槽位布局与编辑配方；能力来源改为能力卡与协议上限，已原地同步能力来源与历史边界。
- [主题与外壳](../../implemented/feature/2026-10-24-theme-and-app-shell.md)、[进程模型](../../implemented/architecture/2026-10-24-desktop-stack-and-process-model.md)：设置页与 AI 接入的描述已原地同步，不改决定。其余命中（engine 服务、基础设施、项目库、无限画布）为边界依赖，无冲突。

## Alternatives considered

- **内置模型库（含能力档案、别名与生命周期）** — 最强理由：用户添加常见模型零配置，能力准确。不选：型号以周为单位迭代，内置数据很快过期（现有默认图片档案仍是已停服的 gpt-image-1）；按型号匹配是隐式行为，中转站别名与官方能力也常不一致。改为协议模板预填 + 用户编辑。
- **声明式协议 JSON 与表达式引擎（BeefTV 模式）** — 最强理由：新增协议不改代码，社区可贡献。不选：BeefTV 的签名、上传、状态归一化与轮询仍写在宿主代码中，表达式嵌套很深要靠生成脚本维护，评审记录显示迁移时丢失过厂商参数；本项目的需求可由「代码协议 + 附加参数／固定字段」覆盖。
- **保留接入／定义／绑定四层结构** — 最强理由：已实现大半，可复用。不选：三份事实冗余导致读取脆弱，用户要理解四个概念，修改接入只能改 JSON。
- **渠道级协议** — 最强理由：表单最少。不选：同一中转站的文本、Gemini TTS、MiniMax 视频走三种协议与路径，渠道协议注定被模型覆盖。
- **只支持 OpenAI 兼容格式** — 最强理由：中转站覆盖面最广，代码最少。不选：视频参考音视频、编辑续写、Gemini 与 MiniMax 原生 TTS 全部无法表达。
- **能力卡只存相对模板的差异** — 最强理由：协议模板升级可自动传播。不选：没有模型库后「看到的就是生效的」更可预测；需要新模板时用「恢复为协议默认」显式更新。
- **每种视频方式单独配置比例、时长等参数** — 最强理由：可表达任意方式级约束。不选：与通用参数重复、难以理解；首批真实约束都来自协议，写成只读协议规则更准确。跨参数联动（如 Veo 1080p 只能 8 秒）出现真实需求时再扩展规则类型。
- **保留旧数据并迁移** — 最强理由：开发者已有配置不用重填。不选：项目未发布，用户明确不需要兼容；迁移旧档案、接入与快照会保留大量即将删除的代码。

## Consequences

- 用户只需理解渠道与模型；协议在模型上选择，图像／视频／TTS 未选协议时不能启用；读取模型不按名称猜测。
- 设置页预览的每个操作地址与 engine 实际请求一致，覆盖本篇地址示例表全部情形；跨主机地址未确认不能启用；下载不外发凭据。
- 四类能力卡由 zod 定义并驱动设置表单；留空与 0 的语义统一；协议上限外的开关不显示且 engine 拒绝保存；切换协议走单一写入口并列出不兼容字段。
- 15 个首批协议均有基于官方文档样例的请求体与响应解析契约测试；附加参数与固定字段写入正确路径，保留字段被拒绝。
- 画布参数面板、视频方式、端口与素材限制完全由能力卡和协议规则驱动，代码中不再出现写死的参数键名单、模式白名单或型号判断；规则锁定项置灰并说明原因。
- 音频节点可生成、播放、写回，并能连接到视频参考音频；视频编辑、续写可在承接协议上提交。
- 任务快照冻结完整调用事实；凭据变化暂停、提交不确定不重投、重启恢复只查询；旧数据清除迁移在临时旧库上验证备份、清表与项目数据保留。
- 本篇删除清单中的代码、测试与文档已移除；全仓 typecheck、lint、format:check、build、单元／集成测试与限定范围的 E2E 通过；未执行任何真实模型服务调用。

### 代价与边界

- **改动面大**：跨 contracts、engine、desktop、canvas 与迁移，设置页与画布已完成同批契约迁移，跨包全量回归通过；回退需要匹配旧应用和备份数据库，不能混用新契约与旧任务。
- **能力卡由用户填写**：填错会导致上游 400 或静默降级。由协议上限、协议规则、本地校验、上游错误回显和媒体测试兜底；协议模板附文档来源与核对日期。
- **协议规则写死在代码**：中转站行为与官方不同时只能改代码，这是 D4 的代价；附加参数与固定字段只能补字段，不能改流程。
- **文档会漂移**：首批协议的字段与模板在实施时按官方文档重新核对；未核实项（如 MiniMax H3 声音开关）在模板中标为「未确认」，不臆造支持。
- **清库不可逆**：开发者本机旧配置与任务记录会被删除，迁移前自动备份保留可读副本；项目文件与资产不受影响。

[历史快照：以渠道为中心的模型设置（API 格式取代渠道预设）](../../archived/feature/2026-10-25-channel-centric-model-settings.md)

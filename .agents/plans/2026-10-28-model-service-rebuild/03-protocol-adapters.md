# Plan: 首批协议适配器

Status: active
Parent: plan.md

## 目标

实现首批 15 个协议，每个协议都要补全 contracts 中的描述（ceiling、templates、rules、sources），并在 `apps/engine/src/modules/generation/protocols/` 下写 engine 适配器。每个协议都要有契约测试，测试依据是官方文档中的请求和响应样例。文本协议经 pi-ai 使用统一地址和凭据。完成后，任何模型只要选了这 15 个协议之一，就能走通提交、查询、下载和写回。

## 前置条件

- 01、02 已完成，注册表、`http.ts`、`mock-upstream.ts` 可以使用。
- 开始写每个协议前，先用网络搜索核对该协议的**官方文档**当前版本，把核对时用的 URL 和日期写进描述的 `sources`。下表的「起点文档」只是入口；如果官方文档和下表不一致，以官方文档为准，并把差异记入「发现与偏差」。
- 不访问真实服务，不使用真实 Key。契约测试的样例来自文档，放在 `protocols/fixtures/<protocol-id>/*.json`，并在 `protocols/fixtures/README.md` 里记录来源 URL 和核对日期。沿用现有 `adapters/fixtures/README.md` 的格式。

## 通用要求（每个协议都适用）

1. **请求翻译**：只把语义参数和带角色的素材翻译成上游字段，never 展开整个参数对象。上游对某个语义参数没有对应字段时，静默省略；但 ceiling 不得把这个参数声明为可用。
2. **附加参数与固定字段**：
   - 写入顺序：协议字段 → 附加参数（取请求 `extras` 的值，没有就用默认值）→ 固定字段。
   - 写入用 `writePath`。路径冲突在保存时已经拒绝，执行时不再检查。
   - multipart 协议只写顶层字段。JSON 值序列化成字符串。
3. **提示词引用**：用 `ctx.resolvePrompt`，按能力卡 `promptRef` 改写；图像和 TTS 固定用 `ordinal`，`base` 取 1。
4. **素材交付**：
   - `inline` 按协议要求的形式交付：data URI、纯 base64 或 multipart 文件。
   - `url` 用 `ctx.referenceUrl`。
   - 协议不支持的交付方式由 `transports.allowed` 排除。
5. **响应解析**：
   - 状态统一映射成 `running`、`succeeded`、`failed`。
   - 未知状态或缺少字段一律视为 `failed`，`category` 填 `upstream`，`code` 填 `INVALID_RESPONSE`；提交阶段则抛出「结果不确定」。never 当作成功。
   - 错误分类沿用 `classifyHttpError`，业务错误码映射到 `GenerationErrorCategory`。
   - 不把上游原文写进错误信息，只保留安全的错误码。
6. **产物**：`url` 产物下载时不带凭据；需要鉴权的下载声明为 `content` 操作。
7. **模板取值**：模板取官方文档中该协议现役主力模型的值，并在 `sources` 里注明是哪个模型。文档没写的能力，数值字段留空（不限），声音写 `unknown`，布尔开关写 `false`。不臆造能力。
8. **规则**：只登记文档明确写出的限制，`message` 用中文写明原因。

## 协议清单与要点

| 协议 id | 类别 | 起点文档 | 请求要点 | 响应要点 | 首批规则 |
| --- | --- | --- | --- | --- | --- |
| `openai-chat` | chat | https://platform.openai.com/docs/api-reference/chat | pi-ai `openai-completions` | 流式 | — |
| `openai-responses` | chat | https://platform.openai.com/docs/api-reference/responses | pi-ai `openai-responses` | 流式 | — |
| `anthropic-messages` | chat | https://platform.claude.com/docs/en/api/messages ，https://platform.claude.com/docs/en/api/versioning | pi-ai `anthropic-messages`；采样参数按能力卡白名单过滤，模板默认一个都不发送 | 流式 | — |
| `gemini-generate` | chat、image、tts | https://ai.google.dev/api/generate-content ，https://ai.google.dev/gemini-api/docs/image-generation ，https://ai.google.dev/gemini-api/docs/speech-generation | 文本走 pi-ai `google-generative-ai`（经 `google-transport.ts`）。图像：`contents.parts` 放文本和 `inlineData` 参考图，`generationConfig.responseModalities=['IMAGE']`，`imageConfig.aspectRatio` 和 `imageSize`（档位名原样）。TTS：`responseModalities=['AUDIO']`，`speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`；多说话人用 `multiSpeakerVoiceConfig` | 图像取 `candidates[].content.parts[].inlineData`；TTS 是 base64 PCM（L16 24kHz 单声道），engine 封装成 WAV 后再交给 ffprobe | 图像 `sizeRule: provider` |
| `openai-images` | image | https://developers.openai.com/api/docs/guides/image-generation ，https://developers.openai.com/api/reference/resources/images | 没有参考图时 JSON `POST /images/generations`；有参考图或蒙版时 multipart `POST /images/edits`（`image[]`、`mask`）。`size` 写成 `WxH`，或在 `auto` 时省略；`quality`、`background`、`output_format`、`output_compression`；`n` 固定为 1 | `data[].b64_json` 或 `data[].url` | `sizeRule: area`，取值和现有 `image-params.ts` 的 gpt-image-2 规则一致：1K=1024²，2K=2560×1440，4K=8,294,400，16 的倍数，单边 ≤3840，比例 ≤3:1 |
| `ark-seedream` | image | https://ark.volcengine.com/region:cn-beijing/docs/image-generation-api | JSON；`size` 按能力卡选择发档位名或 `WxH`；`image` 填 URL 或 dataURL 数组；`response_format`；`watermark` 用附加参数，模板默认关；`sequential_image_generation` 固定为 `disabled` | `data[].url` 或 `b64_json`；`error` 对象 | `sizeRule: area` 加查表，沿用现有 `SEEDREAM_IMAGE_SIZES`，并按 Seedream 5.0 文档更新 |
| `ark-seedance` | video | https://ark.volcengine.com/region:cn-beijing/docs/create-video-generation-task-api ，https://ark.volcengine.com/region:cn-beijing/docs/get-video-generation-task-api | JSON `content[]`：`{type:'text'}`；图片为 `{type:'image_url', role:'first_frame'|'last_frame'|'reference_image'}`；视频和音频为 `reference_video`、`reference_audio`。另有 `ratio`、`resolution`、`duration`（交给模型时为 -1）、`generate_audio`、`watermark`、`seed`。编辑和续写的字段由 07 实现 | 状态 queued/running/succeeded/failed/cancelled/expired；`content.video_url` | 方式为 `first` 或 `first_last` 时，aspectRatio only `adaptive` |
| `dashscope-wan` | video | https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-api-reference | `fixedHeaders: { 'X-DashScope-Async': 'enable' }`；`input.prompt`；`input.media[]` 带类型，包括 first_frame、last_frame、reference_image、reference_video、reference_audio，以文档为准；`parameters.resolution`、`duration`（-1 时交给模型）、`ratio`、`audio`、`seed`；`prompt_extend` 用附加参数 | `output.task_id`、`output.task_status`（PENDING/RUNNING/SUCCEEDED/FAILED/CANCELED/UNKNOWN）、`output.video_url` | 帧类素材与参考素材互斥 |
| `minimax-video-v2` | video | https://platform.minimax.io/docs/api-reference/video-generation-v2-create ，https://platform.minimax.io/docs/api-reference/video-generation-v2-query | JSON：`model`、`prompt`、`content[]` 带角色、`duration`、`resolution`、`aspect_ratio`。字段名以文档为准 | 外层 `task_id`、`base_resp.status_code` 非 0 时失败；查询结果为 `task.status` 和 `task.content.url`。吸取旧路由笔记中 H3 故障的教训 | 方式为 `t2v` 时 aspectRatio exclude `adaptive`；帧类素材与参考互斥 |
| `kling-omni` | video | https://kling.ai/document-api/api/video/4-0/video-omni.md ，https://kling.ai/document-api/api/get-started/authentication.md | Bearer API Key；`POST /omni-video/{model}`；素材按 first/middle/last frame、`refer_image`、`feature_video`、`voice` 分组；`duration`、`resolution`、`aspect_ratio`、`settings` 的嵌套以文档为准 | `GET /tasks?task_ids={id}` 返回 `outputs[]`；状态 submitted/processing/succeeded/failed | 有参考视频时，`audio` 字段 only `false`（若文档确认）；所有素材合计 ≤15 写进模板的 `totalCount` |
| `openai-videos` | video | https://developers.openai.com/api/docs/guides/video-generation 已下线，作为历史格式参考；同时核对 https://openrouter.ai/docs/guides/overview/multimodal/video-generation | multipart：`model`、`prompt`、`seconds`（字符串）、`size`（`WxH`，由分辨率和比例换算，换算表写进描述）、`input_reference` 文件 | `id`、`status`（queued/in_progress/completed/failed）；产物为 content 操作，需要鉴权下载 | 只支持 `t2v`、`first`；`notes` 写「官方已于 2026-09-24 下线，仅用于中转兼容格式」 |
| `newapi-video` | video | https://doc.newapi.pro/api/generate-video/ ，https://docs.newapi.ai/zh/docs/api/ai-model/videos/getvideogeneration | JSON：`model`、`prompt`、`duration`、`width`/`height` 或 `size`、`image`（首帧）、`seed`；厂商参数放 `metadata`，附加参数的路径前缀为 `metadata.` | `task_id`；状态有两套写法，queued/in_progress/completed/failed 和 processing/succeeded 都要映射；产物 URL | 只支持 `t2v`、`first`、`reference`（图） |
| `openai-speech` | tts | https://platform.openai.com/docs/api-reference/audio/createSpeech | JSON：`model`、`input`、`voice`、`instructions`、`response_format`、`speed` | 二进制音频；JSON 错误体 | `notes` 写「OpenAI 官方 TTS 将于 2027-01-06 停服，主要用于中转站」 |
| `minimax-t2a` | tts | https://platform.minimax.io/docs/api-reference/speech-t2a-http | JSON：`model`、`text`、`stream:false`、`voice_setting{voice_id,speed,vol,pitch}`、`audio_setting{sample_rate,format,channel}`、`output_format:'hex'`；音色列表用 `POST /get_voice`，请求体按文档 | `data.audio` 为 hex，拒绝奇数长度；`base_resp.status_code` | — |
| `elevenlabs` | tts | https://elevenlabs.io/docs/api-reference/text-to-speech/convert ，https://elevenlabs.io/docs/api-reference/voices/search | `POST /text-to-speech/{voice_id}?output_format=mp3_44100_128`；JSON：`text`、`model_id`、`voice_settings{speed,...}`；音色用 `GET /voices`（v2 路径以文档为准） | 二进制音频 | — |

## 步骤

- [x] T1 搭建 `protocols/` 目录结构、fixtures 目录，以及契约测试辅助函数：给定语义请求、能力卡、渠道和模型，断言最终 URL、方法、头部和请求体；给定上游样例响应，断言解析结果。删除旧的 `adapters/` 目录 — 验证：`pnpm --filter @frame-loom/engine typecheck`
- [x] T2 实现 `openai-images`、`ark-seedream` 和 `gemini-generate` 的图像部分，补全对应描述 — 验证：契约测试至少覆盖以下内容。
  - 文生图和参考图两条路径。
  - 蒙版走 multipart。
  - 尺寸三种发送方式。
  - 附加参数和固定字段写入。
  - b64 与 url 两种产物。
  - 错误体分类。
  - 提示词引用改写。
  - 带参考图时的像素上限由 `checkRequest` 拒绝。
  - 测试命令：`pnpm --filter @frame-loom/engine test -- protocols/image`
- [x] T3 实现 `ark-seedance`、`dashscope-wan`、`minimax-video-v2`、`kling-omni`，补全描述 — 验证：每个协议的契约测试覆盖以下内容。
  - 各方式的素材角色映射：文生、首帧、首尾帧、仅尾帧（若支持）、参考图/视频/音频。
  - 时长交给模型时的写法。
  - 声音开关。
  - 状态全集的映射。
  - 外层与内层任务 ID。
  - 业务错误码。
  - 协议规则：比如 Seedance 首尾帧选 16:9 时 `checkRequest` 报错，原因文案来自规则。
  - Wan 固定头部。
  - 可灵查询串地址。
  - 测试命令：`pnpm --filter @frame-loom/engine test -- protocols/video`
- [x] T4 实现 `openai-videos`、`newapi-video`，补全描述 — 验证：
  - multipart 字段与分辨率×比例换算出的 size。
  - content 鉴权下载。
  - new-api 两套状态和 metadata 透传。
  - 附加参数只写顶层字段的限制（multipart）。
  - 测试命令同 T3。
- [ ] T5 实现 `openai-speech`、`minimax-t2a`、`elevenlabs`、`gemini-generate` 的 TTS 部分，以及 `listVoices`（MiniMax、ElevenLabs）；音色服务按凭据指纹、协议和上游 ID 隔离 — 验证：
  - 二进制、hex、base64 PCM 三种返回都能解析。
  - 奇数长度的 hex 和截断的音频被拒绝。
  - Gemini PCM 封装成 WAV 后，ffprobe 探测出 24kHz 单声道。
  - 音色在不同账号之间不串用。
  - 远端音色列表失败时，手填仍然可用。
  - 测试命令：`pnpm --filter @frame-loom/engine test -- protocols/tts voices`
- [ ] T6 补全四个文本协议的描述（ceiling、templates），`llm.service.ts` 改为从描述取 pi-ai api 名和 compat 默认值；四个协议都用模拟上游跑通两步检查、文本流和用量解析，`redirect` 拒绝时不带凭据，401/429/500 的分类；同时测试 Anthropic 不发送未勾选的采样参数 — 验证：`pnpm --filter @frame-loom/engine test -- llm`
- [ ] T7 端到端集成：每个类别至少挑一个协议，从 `POST /channels`、批量添加模型、`POST /generation-jobs` 一直走到产物写回项目。流光三模型的地址示例（Responses、Gemini TTS、MiniMax 覆盖地址）要求模拟上游只接受示例中的路径 — 验证：新增 `protocols.integration.test.ts`，断言每个请求的路径和设置页 `Model.endpoints` 预览完全一致；命令 `pnpm --filter @frame-loom/engine test`
- [ ] T8 描述自检：所有 15 个描述的 `sources` 非空且带核对日期；模板都能通过 schema；`effectiveCapability(template)` 等于模板本身；`reservedFields` 覆盖协议自己写入的所有顶层字段（用测试遍历每个协议 `buildSubmit` 生成的请求体，断言其顶层键都在 `reservedFields` 里）— 验证：`pnpm --filter @frame-loom/contracts test -- protocols` 与 `pnpm --filter @frame-loom/engine test`

## 验证

- 预期：15 个协议的契约测试和集成测试全部通过；不存在访问外网的测试，用 `rg -n "https?://(?!127\.0\.0\.1)" apps/engine/src --pcre2 -g "*.test.ts"` 扫描，只允许出现在 fixtures 的 README 和文档注释里；`pnpm --filter @frame-loom/engine test`、`pnpm run typecheck` 通过。
- 实际（2026-10-29，阶段进度）：T1–T4 完成。图像契约 21 用例，视频契约 34 用例；engine 全量 24 文件、214 用例通过，contracts 19 文件、279 用例通过。全仓 typecheck／lint／format:check 通过。T5–T8 尚未完成，03 不视为已验收。

## 进度

- 2026-10-28：创建子计划草稿。

## 发现与偏差

- 2026-10-29：未提供网络搜索工具，直接读取官方文档。Node fetch 部分站点 403／连接失败；改用 PowerShell `Invoke-WebRequest` 后取得 OpenAI Markdown、Gemini 和 Anthropic 官方正文，无模型 API 调用。
- MiniMax 官方字段为 content 内文本和 ratio；可灵为 contents 数组、settings、options。可灵 voice 需要音色 ID，首批不把本地 audio URL 当 voice_id，不声明音频输入；官方未确认 audio 布尔开关，不加入参考视频静音规则。
- 协议描述增加 defaultExtras（Seedream 水印默认关闭、Wan 智能提示词改写）、videoSizes／customVideoSize、extraPathPrefix 与 extensibleContainers。最后一项让 parameters／options／metadata 顶层受保护，同时允许已声明的非保留子路径，避免保留字段测试与附加参数功能冲突。
- 当前 OpenAI 图像文档主力为 GPT Image 2.5 Sunburst／Flare，新增 xhigh／max 质量，像素边界与计划一致。模板按现役模型补齐，能力仍由用户显式配置，运行时不按型号分支。

## 交接

T1–T4 已完成，下一步 T5 TTS 与音色目录，再执行 T6 四文本协议、T7 严格模拟集成、T8 描述自检。04–08 尚未开始。

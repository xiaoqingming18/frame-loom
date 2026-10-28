# Plan: 共享契约

Status: draft
Parent: plan.md

## 目标

在 `packages/contracts` 落地新模型服务的全部共享契约与纯函数，供 engine、desktop、canvas 共用。交付后其余子计划只消费这里的类型与函数，不再自行定义同类逻辑。旧契约在本子计划中保留，直到 02、04、05 迁移完调用方后再删除；本子计划只新增，不改旧文件的行为。

## 前置条件

- 阅读关联笔记 `.agents/notes/proposed/architecture/2026-10-28-model-service-rebuild.md` 的「已确认的决定」「协议层」「地址解析」「能力卡」「语义请求与执行」，以及父计划的「共享约定」。
- 阅读现有实现作为参考：`packages/contracts/src/models.ts`（`BaseUrl`、`HeaderName`、`resolveServiceUrl` 的校验写法）、`image-params.ts`（`alignedSize`、`SEEDREAM_IMAGE_SIZES`）、`image-references.ts`、`image-edit.ts`、`generation.ts`（`GenerationStatus`、`GenerationErrorCategory`、`MediaFile`）。
- 依赖只有 `zod@4.6.7`，不新增依赖。

## 契约规格

以下是必须实现的形状。字段名、枚举值与语义不得改变；实现细节（内部 helper、文件内组织）可自由安排。

### `model-service.ts`

- `ModelKind = z.enum(['chat','image','video','tts'])`。
- `CatalogFormat = z.enum(['openai','anthropic','gemini'])`。
- `Operation = z.enum(['submit','edit','query','content','voices'])`。
- `MediaTransport = z.enum(['auto','inline','url'])`。
- `ServiceUrl`：沿用 `BaseUrl` 规则（http(s)、无凭据、无查询、无片段、≤2048），另外拒绝路径以 `/chat/completions`、`/responses`、`/messages`、`/models`、`/images/generations`、`/audio/speech` 结尾，提示「请填写服务根地址」。
- `OverrideUrl`：http(s)、无凭据、无片段、≤2048，**允许**查询串，允许 `{id}`、`{model}`、`{voice_id}` 占位符。
- `ChannelWrite`（strict）：
  - `name`：trim，1–100。
  - `baseUrl: ServiceUrl`。
  - `apiKey?`：string ≤8192。缺省表示保留，`''` 表示清除。
  - `secretKey?`：同上。
  - `headers?`：沿用现有 `Headers` 规则，≤32 个；缺省表示保留，`{}` 表示清除。
  - `catalogFormat`：默认 `openai`。
  - `concurrency`：int 1–16，默认 2。
  - `enabled: boolean`。
- `ChannelPatch = ChannelWrite.partial()`。
- `Channel`（读）：`id, name, baseUrl, catalogFormat, concurrency, enabled, hasKey, keyHint: string|null, hasSecretKey, headerNames: string[], createdAt, updatedAt`。never 包含密钥或请求头值。
- `EndpointOverride`（strict）：
  - `submitUrl?: OverrideUrl`。
  - `operations?: partialRecord(Operation, OverrideUrl)`。
  - `confirmedHosts: string[]`，默认 `[]`，最多 8 个，元素为小写主机名，可带端口。
- `ExtraParam`（strict）：
  - `key`：`/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/`。
  - `label`：1–40。
  - `type`：`string|number|boolean|enum`。
  - `values?`：用于 enum，≤50。
  - `default?: Value`。
  - `path`：`/^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*){0,7}$/`。
- `FixedField`（strict）：`path`（同上规则）、`value: z.json()`（序列化 ≤4096 字节）。
- `ModelWrite`（strict）：
  - `kind`。
  - `upstreamModelId`：trim，1–300。
  - `displayName`：trim，1–300。
  - `protocolId: string|null`。
  - `endpointOverride: EndpointOverride`，默认 `{confirmedHosts:[]}`。
  - `transport`：`{image?, video?, audio?: MediaTransport}`，默认 `{}`。
  - `capability: Capability`。
  - `extras: ExtraParam[]`：≤30，默认 `[]`。
  - `fixedFields: FixedField[]`：≤30，默认 `[]`。
  - `concurrency?`：int 1–16。
  - `enabled: boolean`。
  - `superRefine` 校验：`capability.kind === kind`，extras 的 `key` 唯一，extras 与 fixedFields 的 `path` 唯一。
- `Model`（读）：在 `ModelWrite` 的字段之外增加：
  - `id, channelId, configHash, createdAt, updatedAt`。
  - `endpoints: ResolvedEndpoints`，见 `endpoints.ts`。
  - `blockedReason: string|null`：不能启用的原因。
  - `lastCheck: ModelCheck|null`。
- `ModelCheck`：
  - `type`：`chat|media`。
  - `ok, checkedAt, configHash`。
  - `mode?`、`jobId?`。
  - `code: string|null`、`message`。
  - 读取时若 `configHash` 与模型当前值不同，视为过期，由 engine 返回 `null`。
- `CatalogRequest`（strict）：`baseUrl, catalogFormat, apiKey?, headers?, channelId?`。带 `channelId` 时，缺省的密钥和请求头沿用该渠道已保存的值。
- `CatalogCandidate`：
  - `id`。
  - `endpointTypes: string[]`。
  - `outputModalities: string[]`。
  - `kind: ModelKind|null`。
  - `protocolId: string|null`。
- `ModelDefaults`：`{chat, image, video, tts}`，值为 `uuid|null`。`ModelDefaultsPatch` 为它的 partial strict。
- `ModelExport`（strict）：
  - `schema: literal('frame-loom.model')`。
  - `schemaVersion: literal(1)`。
  - `model`：`ModelWrite` 去掉 `enabled` 和 `endpointOverride.confirmedHosts`。
  - never 包含渠道信息或凭据。

### `protocols.ts`

```ts
type AuthDriver = 'bearer' | 'x-api-key' | 'x-goog-api-key' | 'xi-api-key' | 'token';
type OperationSpec = {
  method: 'GET' | 'POST';
  path: string;                  // 以 / 开头，可含 {model} {id} {voice_id} 与查询串
  encoding?: 'json' | 'multipart' | 'none';
  auth?: boolean;                // 默认 true；content 下载按协议声明
};
type ProtocolRule = {
  when: { modes?: VideoModeId[]; param?: { key: SemanticParamKey; equals: Value }; media?: { role: InputRole; kind: MediaKind } };
  then:
    | { param: SemanticParamKey; only: Value[] }
    | { param: SemanticParamKey; exclude: Value[] }
    | { forbidRole: InputRole };
  message: string;               // 中文，用于置灰提示与错误
};
type ProtocolDescriptor = {
  id: string; version: 'v1'; label: string; vendor: string;
  kinds: ModelKind[];
  auth: AuthDriver;
  fixedHeaders?: Record<string, string>;   // 例如 X-DashScope-Async、anthropic-version
  standardPrefix: '' | '/v1' | '/v1beta' | '/api/v1' | '/api/v3';
  operations: Partial<Record<Operation, OperationSpec>>;
  lifecycle: Partial<Record<ModelKind, 'stream' | 'sync' | 'async'>>;
  poll?: { initialMs: number; maxMs: number; timeoutMs: number };
  transports: Partial<Record<MediaKind, { allowed: ('inline' | 'url')[]; auto: 'inline' | 'url' }>>;
  ceiling: { chat?: ChatCeiling; image?: ImageCeiling; video?: VideoCeiling; tts?: TtsCeiling };
  sizeRule?: ImageSizeRule;               // 仅 image
  rules: ProtocolRule[];
  reservedFields: string[];               // 附加参数与固定字段不可写入的顶层或点号路径前缀
  templates: { chat?: ChatCap; image?: ImageCap; video?: VideoCap; tts?: TtsCap };
  sources: { url: string; checkedAt: string }[];
  notes?: string[];
};
```

各类别的能力上限：

- `ChatCeiling`：
  - `inputModalities: ('image'|'pdf'|'audio')[]`。
  - `samplingParams: SamplingParam[]`。
  - `tools: boolean`、`reasoning: boolean`。
- `ImageCeiling`：
  - `edit: boolean`：协议有独立编辑操作。
  - `mask: ('alpha'|'black')[]`。
  - `transparentBackground: boolean`。
  - `responseFormats: ('b64_json'|'url')[]`。
  - `outputFormats: string[]`。
  - `compression: boolean`。
  - `sizeWire: ('pixels'|'tier'|'ratio'|'none')[]`。
  - `quality: boolean`、`seed: boolean`、`negativePrompt: boolean`。
- `VideoCeiling`：
  - `modes: VideoModeId[]`。
  - `referenceKinds: MediaKind[]`。
  - `mixFramesWithReference: boolean`。
  - `audioControl: boolean`、`watermark: boolean`、`seed: boolean`。
  - `durationAuto: boolean`。
  - `promptRefs: PromptRefSyntax[]`。
- `TtsCeiling`：
  - `voiceSources: ('preset'|'remote'|'manual')[]`。
  - `instructions: boolean`。
  - `speed: boolean`、`pitch: boolean`、`volume: boolean`。
  - `formats: string[]`、`sampleRates: number[]`。
  - `multiSpeaker: boolean`。

尺寸换算规则：

```ts
type ImageSizeRule =
  | { kind: 'provider' }                  // 像素由服务商决定，界面显示「由服务商决定」
  | { kind: 'area'; tiers: Record<string, number>; multipleOf: number; minPixels: number; maxPixels: number; maxEdge?: number; maxAspect?: number; table?: Record<string, Record<string, string>> };
```

本文件导出：

- 15 个描述常量与 `PROTOCOLS: readonly ProtocolDescriptor[]`。
- `getProtocol(id)`：未知 id 返回 `undefined`。
- `protocolsForKind(kind)`。

本子计划只写描述结构和**占位内容**：id、label、vendor、kinds、auth、standardPrefix、operations 按笔记首批协议表填写。ceiling、templates、rules、sources 先给最小合法值并标注 `// 03 核对官方文档后补全`；03 负责补全并逐个核对。

### `capabilities.ts`

数值字段一律可选：缺省表示不限，`0` 表示不支持。

```ts
ChatCap  = { kind:'chat'; contextWindow?; maxOutput?; inputModalities; tools; streaming; reasoningLevels: string[]; samplingParams: SamplingParam[] }
ImageCap = {
  kind:'image';
  references: { max?; maxBytes?; formats: string[] };
  mask?: { semantics: 'alpha'|'black' };
  count: { max? };                                  // 画布拆分的独立任务数上限（笔记 D9）
  size: {
    wire: 'pixels'|'tier'|'ratio'|'none';
    tiers: { name: string; enabled: boolean; ratios: { ratio: string; pixels?: string; manual?: boolean }[] }[];
    default: { tier?: string; ratio?: string; auto?: boolean };
    custom?: { minEdge?; maxEdge?; multipleOf?; minPixels?; maxPixels?; maxAspect? };
    withReference?: { maxPixels? };
  };
  quality?: { values: string[]; default: string };
  background?: { transparent: boolean; default: 'auto'|'transparent'|'opaque' };
  responseFormat?: 'b64_json'|'url';
  outputFormats: string[]; compression?: { min; max };
  seed: boolean; negativePrompt: boolean; promptMaxChars?;
}
VideoCap = {
  kind:'video';
  modes: { id: VideoModeId; withReference?: boolean; keyframes?: { min?; max? }; reference?: { accept: MediaKind[]; withFrames: boolean } }[];
  defaultMode: VideoModeId;
  references: { image?: MediaLimit; video?: MediaLimit; audio?: MediaLimit; totalCount? };
  duration: { kind:'range'; min; max; step; default; allowAuto?: boolean } | { kind:'values'; values: number[]; default; allowAuto?: boolean } | { kind:'auto' };
  aspectRatios: string[]; defaultAspectRatio?;
  resolutions: string[]; defaultResolution?;
  audio: { mode: 'on'|'off'|'optional'|'unknown'; default?: boolean };
  watermark?: { default: boolean };
  seed: boolean; promptMaxChars?;
  promptRef: { syntax: PromptRefSyntax; base: 0|1 };
}
MediaLimit = { max?; maxBytes?; minDurationSec?; maxDurationSec?; maxTotalSec?; formats?: string[] }
TtsCap = {
  kind:'tts';
  voices: { sources: ('preset'|'remote'|'manual')[]; presets: { id; name }[]; default?: string };
  instructions: boolean;
  speed?: Range; pitch?: Range; volume?: Range;           // Range = { min; max; default }
  formats: string[]; defaultFormat?; sampleRates: number[]; defaultSampleRate?;
  maxChars?; multiSpeaker?: { max };
}
Capability = z.discriminatedUnion('kind', [ChatCap, ImageCap, VideoCap, TtsCap])
```

- 档位名 `name` 原样保存，`1K` 与 `1k` 不同；`ratio` 为 `/^\d+:\d+$/` 或 `adaptive`；`pixels` 为 `/^\d+x\d+$/`。
- 每个字段导出界面元数据 `CAPABILITY_FIELDS`：`{ path, label, unit?, help }`。help 中写明空值语义，例如「留空表示不限，由服务商校验；0 表示不支持」。04 用它渲染表单与问号提示。
- 枚举与界面文案：`VIDEO_MODE_LABELS`、`MEDIA_ROLE_LABELS`、`SAMPLING_PARAM_LABELS`、`IMAGE_QUALITY_LABELS`（沿用现有中文）。

### `endpoints.ts`

- `resolveEndpoints(channel: {baseUrl}, model: {upstreamModelId, endpointOverride}, descriptor)` 返回 `ResolvedEndpoints`：
  - `operations`：`Partial<Record<Operation, { method; url; template: boolean }>>`。`url` 中 `{model}` 已逐段编码替换，`{id}`、`{voice_id}` 保留原样；`template` 表示 url 中仍含占位符。
  - `foreignHosts`：最终地址中与渠道主机不同的主机，已去重并转为小写。
  - `issues`：中文问题列表，例如「无法从覆盖地址推导查询地址，请逐项填写」。
- 算法按笔记「地址解析」四步实现。补充两点：
  - 后缀匹配时，`{model}` 段可匹配任意单个路径段；查询串单独比较。
  - `submitUrl` 与 `operations.submit` 同时存在时，以 `operations.submit` 为准。
- `fillEndpoint(url, params: Record<string,string>)`：替换剩余占位符并按段编码；参数为 `.` 或 `..`、或含 `/` 时抛错。
- `resolveCatalogUrl(baseUrl, format)`：
  - 渠道前缀与列表格式前缀（openai、anthropic 为 `/v1`，gemini 为 `/v1beta`）一致时，返回 `baseUrl + '/models'`。
  - 否则返回 `origin + deployPrefix + 格式前缀 + '/models'`。

### `semantic-request.ts`

- `VideoModeId = z.enum(['t2v','first','last','first_last','keyframes','reference','edit','extend'])`。
- `InputRole = z.enum(['first_frame','last_frame','keyframe','reference','base_video'])`。
- `MediaKind = z.enum(['image','video','audio'])`。
- `SemanticParams`：strict object，键为父计划约定 6 的全部语义参数键，均可选，值类型分别为 string、number、boolean。
- `SemanticRequest`（strict）：
  - `modelId: uuid`。
  - `projectId?`、`pageId?`：uuid。
  - `mode?: VideoModeId`：仅视频必填。
  - `prompt`：trim，1–32000。TTS 时为待合成文本。
  - `inputs`：`{ role, kind, order: int ≥0, sha256 }[]`，≤50。
  - `params: SemanticParams`，默认 `{}`。
  - `extras: record(string, Value)`，默认 `{}`。
  - `imageEdit?: ImageEditRecipe`。
  - `source`：`canvas|test|agent|manual`，默认 `manual`。

### `capability-check.ts`

- `effectiveCapability(cap, descriptor)`：把能力卡裁剪到协议上限并返回新对象。上限外的功能移除；视频 modes 只保留 `ceiling.modes` 中的方式。
- `validateModel(write: ModelWrite, descriptor|undefined, channel: {baseUrl, hasSecretKey})` 返回 `{ field, message }[]`。规则：
  - 协议为空时 `enabled` 必须为 false。
  - 协议的 kinds 必须包含 `kind`。
  - 能力卡不得含上限外的开关或取值。
  - transport 取值必须在协议允许范围内。
  - extras 与 fixedFields 的 path 不得等于或以 `reservedFields` 中任一项为前缀；multipart 编码的操作只允许单段 path。
  - `enabled` 时 `foreignHosts` 必须全部在 `confirmedHosts` 中。
  - `enabled` 时 `issues` 必须为空。
- `checkRequest(request, model: {kind, capability, extras}, descriptor)` 返回 `{ field, message }[]`：
  - 提示词字数。
  - 视频方式必须在有效能力中；每种方式的必需角色与数量：`first` 需要 1 个首帧，`last` 需要 1 个尾帧，`first_last` 需要各 1 个，`keyframes` 按 min/max，`reference` 至少 1 个参考，`edit`/`extend` 需要 1 个 `base_video`。
  - `withReference` 或 `withFrames` 为 false 时禁止混用。
  - 参考素材类型必须在 `reference.accept` 中。
  - 各类数量上限与 `totalCount`。
  - 参数取值必须在能力卡范围内，`duration` 校验范围或固定值。
  - 协议规则：`only`、`exclude` 和 `forbidRole`。
  - extras 键必须已声明，类型匹配。
  - 图像参考数量；TTS 字数与语速等范围。
- `checkMedia(inputs: { input, media: Partial<MediaFile> }[], cap)`：按 `MediaLimit` 检查 mime、大小、单个时长和同类总时长。缺少元数据时跳过该项，由 engine 用真实文件再查一次。
- `effectiveVideoParams(cap, descriptor, mode, inputs)` 返回 `{ aspectRatios, resolutions, durations, audio }`。每个可选值为 `{ value, disabled, reason? }`，reason 取自协议规则的 message。
- `changeProtocol(write: ModelWrite, nextId)` 返回 `{ model: ModelWrite, incompatible: { field, from, message }[] }`：
  - 以新协议模板为基础，逐字段保留与新上限兼容的旧值；不兼容的旧值不写入，并列在 `incompatible` 中。
  - extras 与 fixedFields 保留，但与新协议保留字段冲突的条目列为不兼容。
  - transport 中不兼容的值重置为 `auto` 并列出。
  - `endpointOverride` 清空并列出。
- `restoreCapabilityGroup(cap, descriptor, group)`：按分组恢复为协议模板。分组为 `references|size|quality|output|modes|duration|frame|audio|voices|style|limits`。

### `image-size.ts`

- `defaultTierPixels(rule, tier, ratio)`：
  - `area` 规则：先查 `table`，没有再按面积求像素，宽高对齐到 `multipleOf`，满足单边上限、宽高比上限和总像素范围。沿用现有 `alignedSize` 的就近修正逻辑，比例误差 <1%。
  - `provider` 规则返回 `undefined`。
  - 档位名不在规则中时返回 `undefined`，界面要求用户手填。
- `resolveImageSize(cap, params, hasReference)` 返回 `{ wire, width?, height?, tier?, ratio?, issue? }`：
  - `pixels`：使用档位·比例格中的 pixels，或经 `custom` 约束校验的自定义宽高。
  - `tier`：返回档位名与比例。
  - `ratio`：只返回比例。
  - `none`：返回空。
  - 带参考图时额外检查 `withReference.maxPixels`。

### `prompt-references.ts`

- `parsePromptReferences(prompt)`：语法沿用 `@{nodeId}`。
- `resolvePromptReferences(prompt, inputs: {id, kind}[], syntax, base)`：按素材类型分别计数。
  - `ordinal`：中文提示词输出 `图1`、`视频1`、`音频1`；非中文输出 `Image 1`、`Video 1`、`Audio 1`。沿用现有中文判断。
  - `@image_n`：输出 `@image_1`、`@video_1`、`@audio_1`。
  - `<IMAGE_n>`：输出 `<IMAGE_0>`、`<VIDEO_0>`、`<AUDIO_0>`。
  - 编号起点由 `base` 决定。缺失引用原样保留并返回 `missingNodeIds`。

### `image-edit.ts`（修改）

- 保留 `ImageEditRecipe`。
- 新增 `imageEditSupport(cap: ImageCap, descriptor)`，返回各操作的可用性：`{ angle, lighting, emotion: { available, mask, reason? } }`。规则沿用现有 `imageEditCapabilityIssue` 的数量要求：
  - 角度、打光：参考图上限 ≥1，或不限。
  - 表情：要求 `ceiling.edit`；使用本地蒙版时参考图 ≥2，使用服务商蒙版时 ≥3 且需要 `cap.mask`。
- 旧的 `ImageEditCapabilities` 与 `imageEditCapabilityIssue` 在 05 迁移完调用方后删除。

## 步骤

- [ ] T1 新建 `semantic-request.ts`、`model-service.ts`、`capabilities.ts`，从 `index.ts` 导出；旧导出暂时保留，名称冲突的旧符号不导出新同名符号（新名称前不加前缀，如有冲突先停下并在父计划登记） — 验证：`pnpm --filter @frame-loom/contracts typecheck`
- [ ] T2 实现 `protocols.ts` 的类型与 15 个占位描述常量，并新增单测：id 唯一、`kinds` 与 `templates`、`ceiling` 的键一致、每个模板通过对应能力卡 schema、`effectiveCapability(template)` 等于模板本身 — 验证：`pnpm --filter @frame-loom/contracts test -- protocols`
- [ ] T3 实现 `endpoints.ts`，单测覆盖笔记地址示例表全部 5 行、`deployPrefix`、`operations` 覆盖优先、后缀推导失败、`{model}` 段通配、查询串模板（可灵 `/tasks?task_ids={id}`）、跨主机列入 `foreignHosts`、`fillEndpoint` 拒绝点段与斜杠、`resolveCatalogUrl` 三种格式 — 验证：`pnpm --filter @frame-loom/contracts test -- endpoints`
- [ ] T4 实现 `image-size.ts`，单测覆盖 openai 面积规则（对比现有 `image-params.test.ts` 的期望像素，保持一致）、Seedream 查表、`provider` 规则返回空、自定义宽高越界、带参考图时的像素上限、未知档位要求手填 — 验证：`pnpm --filter @frame-loom/contracts test -- image-size`
- [ ] T5 实现 `capability-check.ts`，单测覆盖：留空不限与 0 不支持；每种视频方式的必需角色；混用禁止与允许（构造一个 `withReference: true` 的方式）；参考素材类型；总数上限；协议规则的 only、exclude、forbidRole 及 reason 透出；extras 未声明与类型错误；`validateModel` 的协议为空不能启用、上限外开关、保留字段冲突、multipart 多段 path、未确认外部主机；`changeProtocol` 的兼容值保留与不兼容清单；`restoreCapabilityGroup` 只改目标分组 — 验证：`pnpm --filter @frame-loom/contracts test -- capability-check`
- [ ] T6 实现 `prompt-references.ts` 与 `imageEditSupport`，单测覆盖三种语法、按素材类型分别计数、编号起点、缺失引用、中英文前缀；`imageEditSupport` 的三种操作边界 — 验证：`pnpm --filter @frame-loom/contracts test -- prompt-references image-edit`
- [ ] T7 schema 往返测试：每个协议模板构造的 `ModelWrite` 经 `parse` 后再序列化，结果不变；`ModelExport` 不含 `confirmedHosts` 和凭据字段；`Channel` 读模型的 schema 拒绝出现 `apiKey` 字段 — 验证：`pnpm --filter @frame-loom/contracts test`
- [ ] T8 全仓类型与构建检查，确认新增导出没有破坏现有调用方 — 验证：`pnpm --filter @frame-loom/contracts build`、`pnpm run typecheck`、`pnpm run lint`

## 验证

- 预期：`pnpm --filter @frame-loom/contracts test` 全部通过，新增测试覆盖本文件列出的全部边界；`pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check` 通过；旧调用方行为不变。
- 实际：未执行。

## 进度

- 2026-10-28：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始。完成后，02、04、05 从 `@frame-loom/contracts` 导入本文件定义的符号；旧符号由 02、05、08 删除。

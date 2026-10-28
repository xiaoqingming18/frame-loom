# Plan: engine 基座

Status: done
Parent: plan.md

## 目标

在 `apps/engine` 中完成以下工作：清库迁移、新的渠道与模型存储、模型服务 HTTP 接口、协议注册表与执行链、新的任务快照，以及读取模型。同时删除 engine 内全部旧模型服务代码。本阶段不实现具体协议，执行链用测试专用的假协议跑通；15 个正式协议由 03 实现。

## 前置条件

- 01 已完成，contracts 已导出新符号。
- 阅读关联笔记的「渠道与模型」「地址解析」「语义请求与执行」「数据与删除范围」两节，以及父计划的「共享约定」。
- 读懂现有实现：
  - `apps/engine/src/core/database/database.service.ts`：迁移前的 `VACUUM INTO` 备份。
  - `core/crypto/secret-cipher.ts`：AES-256-GCM 加密，AAD 为 `[表, 行 id]`。
  - `modules/channels/*`：仓库、凭据指纹、keyHint。
  - `modules/generation/generation.service.ts`：调度、tick、恢复、取消、下载、写回。
  - `modules/generation/media.service.ts`、`media-probe.ts`、`public-reference.ts`、`image-emotion.ts`。
  - `modules/object-storage/*`、`modules/projects/project-media.service.ts`：`documentReferences`、`jobHashes`。
  - `modules/llm/llm.service.ts`、`google-transport.ts`。
- drizzle 迁移目录为 `apps/engine/drizzle/`，现有最新为 `0014_medical_prism.sql`，`schema_version` 为 7。已发布的迁移不得修改。

## 数据设计

迁移 `0015_model_service_reset.sql` 用 `pnpm --filter @frame-loom/engine db:generate` 生成。生成后手工核对，必要时补充语句。迁移内容依次为：

1. `DROP TABLE` 以下表：`model_defaults`、`tts_voices`、`model_catalog`、`channel_models`、`channels`、`provider_uploads`、`generation_jobs`。删除顺序必须满足外键依赖。
2. `DELETE FROM app_meta WHERE key IN ('model_bindings_v1','model_upgrade_report','image_edit_capabilities_v1')`。
3. `CREATE TABLE channels`，列如下：
   - `id` text pk、`name` text、`base_url` text
   - `catalog_format` text、`concurrency` int
   - `api_key_cipher` blob、`key_hint` text、`secret_key_cipher` blob
   - `headers_cipher` blob、`header_names` json
   - `enabled` int bool、`created_at`、`updated_at`
4. `CREATE TABLE models`，列如下：
   - `id` text pk
   - `channel_id`：外键指向 `channels`，`ON DELETE CASCADE`
   - `kind`、`upstream_model_id`、`display_name`
   - `protocol_id`：not null，空串表示未选；沿用现有用空串避开 NULL 绕过唯一约束的做法
   - `endpoint_override_json`、`transport_json`、`capability_json`、`extras_json`、`fixed_fields_json`
   - `concurrency` int null、`enabled`、`last_check_json`、`created_at`、`updated_at`
   - 唯一索引 `(channel_id, upstream_model_id, protocol_id)`
5. `CREATE TABLE model_defaults`：`kind` 为主键，`model_id` 外键指向 `models`，`ON DELETE SET NULL`。
6. `CREATE TABLE tts_voices`：
   - 列：`id` pk、`owner`（凭据指纹）、`protocol_id`、`upstream_model_id`、`voice_id`、`name`、`created_at`。
   - 唯一索引 `(owner, protocol_id, upstream_model_id, voice_id)`。
7. `CREATE TABLE generation_jobs`：
   - 保留现有列：`id`、`project_id`、`page_id`、`kind`、`status`、`remote_task_id`、`remote_status`、`attempts`、`next_poll_at`、`deadline_at`、`error_*`、`diagnostic_json`、`usage_json`、`raw_response_json`、`outputs_json`、`staged_outputs_json`、`source`、时间列。
   - 以 `model_id` 替换 `channel_model_id`，不设外键。
   - 删除 `profile_id`、`profile_json`。
   - `request_json` 改存 `SemanticRequest`，`snapshot_json` 改存新快照，两者均为 not null。
   - 保留两个索引。
8. `UPDATE app_meta SET value = '8' WHERE key = 'schema_version'`。

`media_files`、`object_storage_config`、`object_uploads`、`projects`、`page_views` 及其他表不得触碰。

新快照 `JobSnapshot`（engine 内部类型，同时写入 `snapshot_json`）：

```ts
{
  version: 1;
  protocolId; protocolVersion: 'v1';
  modelId; channelId; upstreamModelId; kind;
  endpoints: Partial<Record<Operation, { method; url }>>;   // 已填入 {model}，保留 {id}
  capability: Capability;                                     // 有效能力
  extras: ExtraParam[]; fixedFields: FixedField[];
  transport: Record<MediaKind, 'inline' | 'url'>;             // 已把 auto 解析为具体值
  concurrencyKey: string;                                     // 渠道 id
  credentialFingerprint: string;
  preparedBody?: unknown;                                     // 适配器构造的请求体，素材以 sha256 占位
  referenceUrls: Record<string, string>;                      // sha256 → 公网 URL
  completedDownloads?: number[];
  imageEditPostProcess?: { intermediateSha256?; finalSha256? };
  cancellation?: 'requested' | 'confirmed' | 'unknown';
}
```

## 模块与接口

- 将 `modules/channels` 重命名为 `modules/model-services`，包含 `model-services.module.ts`、`.controller.ts`、`.repository.ts`、`.schema.ts`、`.service.ts`、`catalog.service.ts`、`voices.service.ts`。`provider-request.ts` 的错误分类移入 `modules/generation/protocols/http.ts`。
- 仓库职责：
  - **加密**：apiKey、secretKey、headers 分别加密，AAD 依次为 `['channels', id]`、`['channels_secret', id]`、`['channel_headers', id]`。
  - **keyHint**：沿用 `••••` 加末四位。
  - **凭据指纹**：`sha256(id + apiKey + secretKey + headers)`。
  - **configHash**：对 `channel.baseUrl + model 全部写入字段` 做稳定 JSON 序列化后取 sha256 前 16 位。
  - **lastCheck**：读取时 `configHash` 不一致则返回 null。
  - **endpoints 与 blockedReason**：读模型时计算 `endpoints = resolveEndpoints(...)`。`blockedReason` 按以下优先级取值：协议为空 → 协议不支持该类别 → 地址问题 → 外部主机未确认 → 渠道缺少 API Key（`gemini-generate` 等全部首批协议都需要 Key）。
- HTTP 接口（全部经 `ZodValidationPipe`，错误统一 `DomainError`）：

| 方法与路径 | 说明 |
| --- | --- |
| `GET /channels` | `Channel[]` |
| `POST /channels` | `ChannelWrite` → `Channel` |
| `GET /channels/:id` | `Channel` |
| `PATCH /channels/:id` | `ChannelPatch` → `Channel`；修改 `baseUrl` 后，下属模型的 `confirmedHosts` 中不再属于外部主机的项保留，新增的外部主机需要重新确认 |
| `DELETE /channels/:id` | 级联删除模型；返回 `{ deleted: true, models: n }` |
| `POST /channels/catalog` | `CatalogRequest` → `CatalogCandidate[]`；草稿请求，不写库 |
| `GET /models`、`GET /channels/:id/models` | `Model[]` |
| `POST /channels/:id/models` | `ModelWrite[]`（1–200 个）→ `Model[]`；单事务，重复则整体 409 |
| `GET /models/:id` | `Model` |
| `PUT /models/:id` | `ModelWrite` → `Model`；整份替换 |
| `DELETE /models/:id` | `{ deleted: true }` |
| `POST /models/:id/check` | 文本：两步检查（连接、文本回复）；媒体：返回 400，提示改用生成任务 `source: 'test'` |
| `GET /models/:id/export` | `ModelExport` |
| `POST /channels/:id/models/import` | `ModelExport` → 预览 `{ model: ModelWrite, issues }`，不写库；确认后由 renderer 调 `POST /channels/:id/models` |
| `GET /model-defaults`、`PUT /model-defaults` | 默认模型；只能指向已启用且类别匹配的模型，否则返回 422 |
| `GET /models/:id/voices` | 已保存音色与协议预置音色 |
| `POST /models/:id/voices`、`DELETE /models/:id/voices/:voiceId` | 手填音色的增删 |
| `POST /models/:id/voices/remote` | 显式联网拉取音色，只在协议声明 `voices` 操作时可用 |
| `GET /protocols` | `PROTOCOLS` 摘要，供调试；renderer 直接使用 contracts 常量 |
| 生成任务接口 | 保留 `POST /generation-jobs`（body 改为 `SemanticRequest`）、`GET /generation-jobs/:id`、`GET /generation-jobs`、`POST …/cancel`、`POST …/cancel-remote`、`POST …/resubmit`、`POST …/requery`、`DELETE …`、`POST /media`；删除 `GET /model-profiles` |

- 保存校验：先调用 contracts 的 `validateModel`，再用 `ModelWrite` 解析；任何问题返回 422，响应携带字段路径。
- 读取模型 `catalog.service.ts`：
  - **请求**：用 `resolveCatalogUrl` 得到地址。鉴权按格式区分：openai 用 Bearer；anthropic 用 `x-api-key` 加 `anthropic-version: 2023-06-01`；gemini 用 `x-goog-api-key`。超时 15s，`redirect: 'error'`。
  - **解析**：openai 格式读 `data[].id`，可选读 `supported_endpoint_types[]` 与 `architecture.output_modalities[]`；gemini 格式读 `models[].name`，去掉 `models/` 前缀，并读 `supportedGenerationMethods`。
  - **类别推断**，只根据返回字段，never 根据 id 关键词：
    - `openai`、`openai-response`、`anthropic`、`gemini` 端点推断为 chat。
    - `image-generation` 推断为 image。
    - `openai-video` 推断为 video。
    - 输出模态含 `image`、`video`、`audio` 分别推断为 image、video、tts。
    - 推断不出时为 null。
  - **协议推断只给文本**：`openai-response` 映射为 `openai-responses`；`openai` 映射为 `openai-chat`；`anthropic` 映射为 `anthropic-messages`；`gemini` 映射为 `gemini-generate`。同时存在多个端点时，按 responses > chat > anthropic > gemini 取第一个；其他类别为 null。
  - 结果最多 10000 条，去重。
- 协议注册表 `modules/generation/protocols/registry.ts`：

```ts
interface ProtocolAdapter {
  descriptor: ProtocolDescriptor;
  buildSubmit(ctx: AdapterContext, req: SemanticRequest, cap: Capability): Promise<HttpCall>;
  parseSubmit(ctx: AdapterContext, res: HttpResult): Promise<AdapterResult>;
  buildQuery?(ctx, remoteTaskId): HttpCall;
  parseQuery?(ctx, res): Promise<AdapterResult>;
  buildCancel?(ctx, remoteTaskId): HttpCall;
  buildContent?(ctx, ref: string): HttpCall;      // 需要鉴权的下载
  listVoices?(ctx): Promise<{ id: string; name: string }[]>;
}
type HttpCall = { operation: Operation; url: string; method; headers: Record<string,string>; body?: string | FormData | Uint8Array };
type AdapterResult =
  | { status: 'running'; remoteTaskId: string; remoteStatus: string }
  | { status: 'succeeded'; outputs: OutputRef[]; usage?: unknown }
  | { status: 'failed'; category: GenerationErrorCategory; code: string; message: string };
type OutputRef = { kind: 'url'; url: string; mime?: string } | { kind: 'data'; base64: string; mime: string } | { kind: 'content'; ref: string; mime?: string };
```

- `AdapterContext` 包含：`snapshot`、凭据（apiKey、secretKey、headers）、`signal`、`fetchMedia(sha256) → {bytes, mime}`、`referenceUrl(sha256) → string`、`resolvePrompt(prompt, inputs) → string`、`applyExtras(body, extras, fixedFields, values)`、`diagnose`。
- `http.ts` 提供共用工具：
  - `authHeaders(driver, credentials, fixedHeaders)`。
  - `send(call)`：统一 `redirect: 'error'`、诊断、请求 ID 提取与脱敏、超时。
  - `classifyHttpError(status, body)`：沿用现有分类规则。
  - `writePath(body, path, value)`：按点号路径写入。
  - 请求体大小上限 64MB。
- 执行链（改造 `generation.service.ts`，保留其状态机、调度和恢复语义）：
  1. `create`：加载模型与渠道，要求两者都已启用且 `blockedReason` 为空。用 `effectiveCapability` 计算有效能力，调用 `checkRequest`；落盘内联素材，并用 ffprobe 元数据调用 `checkMedia`。
  2. 按 transport 准备素材，`auto` 取协议的 `transports[kind].auto`，解析结果写入快照：
     - `inline`：执行时从本机读取文件，由适配器按协议放入请求体（data URI、纯 base64 或 multipart 文件）。请求体超过 64MB 或协议声明的上限时，提交前返回 422。
     - `url`：调用现有对象存储上传素材，得到预签名 URL，有效期取对象存储设置的 `presignTtlSeconds`，并经 `public-reference.ts` 校验为公网地址。同一 sha256 在有效期内复用已上传的结果；未配置对象存储时返回 422「需要对象存储」，不发请求。
     - 不存在「上传到服务商换文件 ID」的方式。
  3. 冻结快照，写入任务。图片的「生成数量」由画布拆成多个请求，engine 不再拆分。
  4. 调度：并发键为渠道 id，上限取渠道 `concurrency` 与模型 `concurrency` 中较小者，取代现在写死的 2。
  5. 执行时只读取快照与凭据。重新计算凭据指纹，与快照不一致时暂停，提示「渠道凭据已变化」。有 `remoteTaskId` 时只查询。提交阶段网络中断或响应无法解析时进入 `submit_unknown`，never 自动重投。
  6. 下载：`url` 产物不带凭据；`content` 产物用适配器的 `buildContent`，此时带凭据。下载后用 ffprobe 探测，按 sha256 去重写入，并按现有逻辑写回项目。
  7. 轮询节奏取自 `descriptor.poll`。
- 删除旧的供应商上传：`provider_uploads` 表、`providerReference`、`uploadReference` 和 `execution-contract.ts`。`AdapterResult` 不再有 `providerContent` 字段。
- 文本：`llm.service.ts` 改为从新仓库读取模型。pi-ai 的 `Model.baseUrl` 由 `resolveEndpoints` 推出，规则是提交地址去掉协议操作路径后缀；`google-transport.ts` 的转发地址同样来自这里。采样参数按能力卡 `samplingParams` 白名单过滤，最大输出取能力卡的 `maxOutput`。删除 `metadata()` 中基于 pi-ai 内置目录推断能力的逻辑：能力完全来自能力卡，pi-ai 的 compat 按协议给默认值。具体文本协议的契约测试由 03 补齐。
- 项目媒体：`project-media.service.ts` 的 `documentReferences` 增加对 `audio` 节点的处理（节点数据 schema 由 06 定义；本阶段先按 `type in ['image','video','audio']` 解析通用媒体数据）。`jobHashes` 改为读取 `SemanticRequest.inputs`。
- 删除以下文件及对应测试：
  - `modules/channels/model-catalog.service.ts`、`video-retirement.ts`、`image-edit-upgrade.integration.test.ts`、`model-catalog.integration.test.ts`、`model-upgrade.integration.test.ts`。
  - `modules/generation/profiles/*`、`execution-contract.ts`、`model-evolution.integration.test.ts`。
  - 旧适配器 `adapters/*`：可以参考后删除，03 会重写。
  - `apps/engine/scripts/smoke-providers.mjs` 与 `smoke:providers` 脚本，它们会发起真实请求，属于禁止项。

## 步骤

- [x] T1 修改 drizzle schema 并生成 `0015_model_service_reset.sql`，手工核对删除顺序、`app_meta` 清理和 `schema_version = 8`；更新 `core/database/database.service.test.ts` — 验证：测试在临时目录用 0000～0014 建库，写入旧渠道、模型、任务、`app_meta` 键，以及项目与 `media_files` 数据，再完整迁移。断言旧表数据清空、新表结构正确、项目与 `media_files` 保留、生成了 `frame-loom.before-*.sqlite` 备份且可读、`schema_version` 为 8；再构造一个故意失败的迁移副本，断言事务回滚。命令：`pnpm --filter @frame-loom/engine test -- database`
- [x] T2 实现 `model-services` 模块的仓库、服务和控制器，覆盖上表全部接口（生成任务接口除外）；删除 `modules/channels` 目录并更新 `app.module.ts` — 验证：新增 `model-services.integration.test.ts`，覆盖以下各项：
  - 渠道 CRUD 不泄露凭据。
  - 留空保留或清除 apiKey、secretKey、headers。
  - 真实数据库文件和 WAL 中不含明文；沿用现有 `llm.integration.test.ts` 的做法。
  - 批量添加模型时，事务内重复整体 409。
  - 校验失败返回 422 并带字段路径。
  - 协议为空不能启用；外部主机未确认不能启用。
  - `lastCheck` 在配置变化后失效。
  - 默认模型的类别校验。
  - 导出不含凭据和 `confirmedHosts`。
  - 删除渠道级联删除模型。
  命令：`pnpm --filter @frame-loom/engine test -- model-services`
- [x] T3 实现 `catalog.service.ts` — 验证：模拟上游返回 openai（带 `supported_endpoint_types`）、anthropic、gemini 三种格式，断言请求的地址和鉴权头、类别与协议推断结果、候选不写库、`channelId` 复用已保存的密钥、遇到重定向报错且不携带凭据、超时报错。命令同 T2
- [x] T4 新建 `testing/mock-upstream.ts`，以及测试专用的假协议 `testing/fake-protocol.ts`（描述与适配器只在测试里注册，不进入 `PROTOCOLS`）；实现注册表、`http.ts` 和新执行链，删除供应商上传 — 验证：新的 `generation.integration.test.ts` 用假协议覆盖以下各项：
  - 同步成功与写回。
  - 异步提交、查询、下载。
  - `url` 产物下载不带凭据；`content` 产物下载带凭据。
  - 重定向拒绝。
  - 并发键与上限取两者较小值。
  - 凭据变化后暂停。
  - 提交结果不确定时进入 `submit_unknown`，且提交次数为 1。
  - 有远端 ID 时重启后只查询。
  - 下载失败只重试下载。
  - 本地放弃与远端取消。
  - `checkRequest` 失败返回 422。
  - 需要 URL 交付但未配置对象存储时返回 422。
  - 快照包含有效能力与最终地址，且不含密钥。
  - 诊断信息脱敏。
  命令：`pnpm --filter @frame-loom/engine test -- generation`
- [x] T5 改造 `recovery.integration.test.ts` 与 `public-reference.test.ts` 以适配新快照；删除旧测试文件 — 验证：`pnpm --filter @frame-loom/engine test`
- [x] T6 改造 `llm.service.ts` 的模型来源与地址，删除基于内置目录的能力推断；暂用 `openai-chat` 的占位描述跑通现有文本测试，测试代码迁移到新接口 — 验证：`pnpm --filter @frame-loom/engine test -- llm`
- [x] T7 改造 `project-media.service.ts` 的引用计算，并更新 `project-content.integration.test.ts`；需要渠道和模型的测试改用新接口与假协议 — 验证：`pnpm --filter @frame-loom/engine test -- project`
- [x] T8 删除 `smoke-providers.mjs` 及脚本项，扫描 engine 中的旧符号 — 验证：在 `apps/engine/src` 下执行 `rg -n "ModelProfile|profileId|channelModelId|model_catalog|ModelConnection|serviceRoutes|resolveModelOperation|executionContract|retiredVideoIds|provider_uploads|providerContent|apiFormat" apps/engine/src`，结果为空；`pnpm --filter @frame-loom/engine typecheck`、`pnpm --filter @frame-loom/engine build`

## 验证

- 预期：
  - engine 全部测试通过；临时旧库迁移有备份、清表、项目保留与回滚证据。
  - 新执行链的每条状态路径都有测试，提交次数、凭据外发与重定向有断言。
  - 全仓 `pnpm run typecheck` 通过；desktop 与 canvas 允许因调用旧接口而有待 04、05 修复的运行时失败，但类型检查必须通过。若做不到，就在 desktop 中保留类型兼容的临时适配，并在「发现与偏差」登记，由 04、05 删除。
- 实际（2026-10-28）：`pnpm --filter @frame-loom/engine test`（含依赖及 engine 构建）21 个文件、159 个用例通过；覆盖旧库备份、项目保留与回滚，严格本地 mock 的目录鉴权、任务状态机、两种并发收窄、远端取消三种回执、凭据加密、诊断脱敏和 multipart 大小限制。全仓 `pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check` 通过。未调用真实模型服务，未运行 E2E 或打包。

## 进度

- 2026-10-28：创建子计划草稿。
- 2026-10-28：完成 T1–T8；请求创建前校验大小，快照在入库前冻结，内联素材使用哈希占位。

## 发现与偏差

- 临时 contracts 子路径已登记父计划，04／05 迁移消费者，08 删除。
- 旧恢复用例合入 `generation.integration.test.ts`，旧文件删除。
- T8 扫描仅命中 `database.service.test.ts` 中断言旧表已删除的三个表名；生产代码无旧符号。该断言是清库验收证据，保留。
- 旧 `adapters/` 仅余素材 fixtures，03 T1 迁移所需素材后删除。

## 交接

02 已完成。03 在 `modules/generation/protocols/` 下实现 15 个协议并替换占位描述；04 使用本文件的 HTTP 接口。

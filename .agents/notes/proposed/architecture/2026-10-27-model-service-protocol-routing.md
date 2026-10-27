# Agent Note: 模型服务接入契约、操作路由与任务恢复

Status: proposed

## Problem

2026-10-27 调研发现，模型虽已独立选择调用协议，但渠道的单一 Base URL 同时承担部署地址和协议版本前缀；视频适配器直接拼接路径，结果下载另有硬编码。一个渠道包含多个协议或多个服务域名时，保存成功不能保证生成请求正确。仅改地址不能修复请求体、响应结构、素材传输和任务恢复的差异。

01、02 已落地；2026-10-27 用户授权实施 03、04。任务快照绑定渠道凭据指纹，凭据改变时暂停而不切换账号；上传复用绑定内容、目标及相同指纹，未知上传结果暂停人工确认，不自动重复上传。实现和模拟验证不代表供应商线上接入已验证；不修改用户配置，不发真实收费请求。

### H3 故障与证据边界

此前只读调查定位到「测试」项目「1」创作页任务 `7152244c-5406-4573-adb9-befc06fa724f`：渠道地址 `https://liuguang.ai/v1`、协议 `minimax-video-v2`、上游型号 `MiniMax-H3`，提交一次后返回 `endpoint_not_found`，没有远端任务 ID。

- `apps/engine/src/modules/generation/adapters/video-tasks.ts` 的 `call()` 将地址与 `/v2/video_generation` 拼成 `https://liuguang.ai/v1/v2/video_generation`；流光公开入口是 `https://liuguang.ai/minimax/v2/video_generation`。无密钥 GET 错误地址返回 404 仅为辅助路由证据，不证明 POST 的鉴权或生成能力。
- 流光查询示例把 `task_id` 放在外层，内层 `task` 只有状态、内容和用量。当前 `minimaxVideoV2.query()` 将内层交给强制要求 `id` 的 `parseTask()`，按文档响应会失败。必须归一化外层或已知查询 ID，并处理 `base_resp`，不能只修路径。
- `apps/engine/src/modules/generation/generation.service.ts` 的 `context()` 每次重新读取渠道地址、上游型号，任务未冻结完整调用配置；内容下载又硬编码 `/videos/{id}/content`。
- `packages/contracts/src/models.ts` 中渠道 `apiFormat` 实际决定列表获取和新文本模型默认协议，不代表所有媒体调用格式。现有文本测试不能作为图片或视频可用性的证明。

## Proposal

2026-10-27 用户进一步确认[多模态服务配置与模型演进重构](2026-10-27-model-service-experience-and-evolution.md)，接管配置分层、七型号、平台中立协议、画布动态能力与后续验收。下述站点模板、普通档案选择和站点命名执行特例保留为旧方案及源码基线，不再作为后续实施目标；已完成路由、快照、上传和本地验证证据保留。新方案尚未实现，本篇不提前转 implemented，也不将部分落地工作整篇标为 rejected。

05 已按用户授权执行本地验收，补强严格 HTTP 路由与旧库升级／失败事务回滚证据，复用既有生命周期和 Electron 测试。线上生成仍须明确账号、型号、模式和费用授权；本地验收不替代该授权或供应商成功记录。

保留渠道、渠道模型、能力档案和现有 engine 调度器，增加完整的模型接入契约与有限的内置模板。模板填充配置，协议适配器执行网络契约；不引入任意用户脚本或按供应商名称散落的条件分支。

### 调研依据与接入范围

以下为 2026-10-27 公开文档和本地源码调查，文档声明与实际联调分别记录。

| 来源 | 已确认的契约特征 | 本次方案的处理 |
| --- | --- | --- |
| [流光文档](https://liuguang.ai/docs)（用户入口为 [API 页面](https://liuguang.ai/account/api?tab=docs)） | Images 生成是 JSON，编辑是 multipart；Gemini 图片同时列出 Images、Chat 和 Gemini 原生入口 | 优先复用已有完整适配器；不能从型号推导协议、鉴权或全部能力 |
| 同上：视频 | OpenAI 格式 `/v1/videos` 为 multipart，查询返回 `id/status`，提供内容下载；H3 原生挂载在 `/minimax/v2` | 核对后复用 OpenAI 视频；H3 修正路由和响应归一化 |
| 同上：其他原生入口 | Seedance 有 `/api/v3/contents/generations/tasks` 或 `/volc/v1/contents/generations/tasks`；Wan/HappyHorse 为百炼路径；Kling、Vidu、PixVerse、Grok、Veo 各有独立操作 | 目录中出现不等于已支持；先利用已匹配的兼容入口，原生适配按明确需求扩展 |
| 同上：图片任务 | Midjourney 原生包含提交、查询及后续动作；Wan 图片有百炼原生入口 | 通用调度允许异步图片，但本期不承诺新增全部原生适配器或 MJ 动作 |
| [FastAIToken 视频总流程](https://docs.fastaitoken.com/docs/产品基础/视频生成%20API/00-网关直连调用总流程) | 视频服务为 `https://video.fastaitoken.com/v1`；JSON POST `/v1/videos/generations`，`/v1/videos` 是该 JSON 协议的别名；GET `/v1/videos/{id}` 和内容端点 | 增加独立 JSON 视频任务适配器，不套用现有 multipart OpenAI 视频 |
| 同上：素材与目录 | 同源根路径 `/api/v1/uploads` 上传 multipart 文件；`/api/v1/models` 为完整能力目录；素材只接受公网 HTTP(S) URL，不接受 data URI、localhost 或私网地址 | 操作路由明确包含前缀；本地素材先上传，目录仅作为待校验的能力候选 |
| [FastAIToken API 手册](https://docs.fastaitoken.com/docs/api-manual) | 文本地址为 `https://www.fastaitoken.com/v1`，部分媒体摘要仍标开发中 | 按模型覆盖地址；详细新文档优先，摘要不覆盖具体契约 |
| [FastAIToken 图片生成](https://docs.fastaitoken.com/docs/image-generate)与[图片 Codex 调用](https://docs.fastaitoken.com/docs/fastai_图片codex调用) | 分别出现 `https://fast.ns.tisoz.com`、`https://img-task.ns.tisoz.com`，描述同步结果与异步插件，但不足以确定完整 HTTP 提交、编辑、轮询契约 | 标为待核实，不猜 `/v1/images/generations`，不启用可执行模板 |

流光目录还按密钥分组声明支持端点，不能把公开目录当作当前账号的权限证明。其统一任务接口的 `result.files` 与 OpenAI 视频对象属于不同契约，不因同站就混用解析器。

FastAIToken 具体型号依据其[视频文档目录](https://docs.fastaitoken.com/docs/)中 01～10 型号页：

| 型号 | 时长（秒） | 分辨率 | 图片／视频／音频数量上限 |
| --- | --- | --- | --- |
| `seedance-2.5-token` | 4–30 | 480p、720p、1080p | 30／10／10 |
| `seedance-2.5-pro-token` | 4–30 | 720p、1080p | 30／10／10 |
| `seedance-2.0-token`、`seedance-2.0-pro-token` | 4–15 | 480p、720p、1080p、4k | 9／3／3 |
| `seedance-2.0-mini-token`、`seedance-2.0-fast-token`、`seedance-2.0-time` | 4–15 | 480p、720p、1080p | 9／3／3 |
| `seedance-2.0-fast-time` | 1–15 | 480p、720p | 9／3／3 |
| `minimax-h3-time` | 4–15 | 768p | 9／3／3 |
| `wan-3.0-time` | 4–30 | 480p、720p、1080p | 9／3／3 |

上表是文档能力上限，不表示任意素材组合均合法；模式、比例和文件限制仍须按具体型号页校验。`n` 只允许 1，H3/Wan 不发送 `face_check`；Fast 系列的 `face_check` 在总流程与型号页有不一致，确认前不开放有歧义的配置。不得发送供应商内部结算字段 `billing_hold_id/callback_url/callback_secret_id`。

本地参考目录为 `D:/WorkSpace/project/personal/reference_projects`，调研结果如下，不作为项目运行时依赖：

| 项目与代码入口 | 借鉴 | 不采用 |
| --- | --- | --- |
| infinite-canvas：`web/src/stores/use-config-store.ts`、`web/src/services/api/video.ts`、`web/src/services/api/model-plugin.ts` | 模型级配置入口 | 自动补 `/v1`、用户脚本持有密钥、以内存保存恢复信息 |
| OpenTV：`lib/ai/providers/registry.ts`、`lib/ai/evolink.ts` | 媒体与文本地址分离、明确网关适配 | 将 EvoLink 的 JSON 提交和 `/v1/tasks/{id}` 查询推广为通用 OpenAI 视频 |
| huobao-canvas：`apps/web/src/config/providers/index.js`、`minimax.js` 与 `useRequestPipeline.js` | 声明式端点与转换、按协议查询恢复 | 未知协议静默退回 OpenAI |

### 配置分层与模板

1. 渠道持有加密凭据、默认地址、自定义请求头、模型目录获取方式。保留草稿拉取不写库、渠道与模型事务保存；渠道 API 格式在界面明确为目录获取及文本默认协议。
2. 模型接入持有上游 ID、调用协议、继承或覆盖的服务地址、操作路径、适配器支持的鉴权策略。地址覆盖不意味着向任意结果 URL 转发渠道密钥。
3. 能力档案持有模式、参数范围与组合、素材限制、轮询与并发建议；协议规定程序可表达的硬边界。用户覆盖与目录更新不能突破适配器能力。
4. 内置模板填入协议、操作路由、鉴权与推荐档案；保存为明确配置并记录模板版本，不随模板更新静默改变既有模型。型号只推荐档案，不能静默决定协议或提高能力；既有显式选择与任务档案快照保留。

首批模板为流光 H3 原生、流光 OpenAI 视频兼容、FastAIToken 视频任务及现有 OpenAI Images、Gemini 原生图片、Ark 图片／视频接入。没有完整协议实现的入口不出现在可执行选项中。FastAIToken 图片与 MJ 扩展动作不属于首批承诺。

普通配置显示模板、服务地址、上游型号和能力档案；操作路径等放高级设置。能力更新先校验并展示差异，确认后生成新快照，不远程静默覆盖。

### 唯一地址语义

有效服务地址是部署前缀，操作路径是不带开头 `/` 的相对路径，由统一解析器追加。地址可含 `/gateway` 等部署前缀；只处理边界斜杠，不自动补版本、不删版本、不猜 origin，不允许 `../` 逃逸或操作路径自带域名。占位 ID 按路径段编码。非法地址、查询串／片段及逃逸形式在保存前按统一校验拒绝，避免预览与请求有不同解释。

| 操作 | 流光 H3 原生模板 | FastAIToken 视频模板 |
| --- | --- | --- |
| 服务地址 | `https://liuguang.ai` | `https://video.fastaitoken.com` |
| 提交 | `minimax/v2/video_generation` | `v1/videos/generations` |
| 查询 | `minimax/v2/query/video_generation/{id}` | `v1/videos/{id}` |
| 下载 | 成功响应的视频 URL | 响应 URL 或 `v1/videos/{id}/content` |
| 上传 | 需要时使用 `minimax/v1/files`，按原生素材契约 | `api/v1/uploads` |
| 能力目录 | 按已核对的目录接口与分组权限处理 | `api/v1/models` |

提交、查询、内容下载、上传和目录的配置预览、校验、实际执行使用同一解析器。下载鉴权属于操作定义，不由通用调度器硬编码。渠道目录与文本 SDK 现有约定在兼容边界内保留，不能为统一媒体地址破坏现有文本、TTS 接入。

### 完整协议与能力边界

适配器明确请求体、Content-Type、鉴权、素材交付、提交／查询响应、状态映射、下载、错误分类和幂等策略。路径覆盖只改变路由，不能把不兼容的 JSON 协议伪装成 multipart。

- MiniMax H3 使用外层 `task_id` 或已知查询 ID 归一化响应，检查业务状态码；普通生成、参考生成与再生成分别校验，未完整支持的操作不开放。
- FastAIToken 使用独立 JSON 任务协议；处理 `id/task_id`、`processing/completed/failed`、`video_url/download_url/result_url` 和 `error_code/error_message`。`submission_pending/upstream_retry` 若伴随处理中状态，不应直接判失败。模式为 `text_to_video/image_to_video/first_last_frame/omni`，首尾帧数组顺序必须保留。
- 流光 OpenAI 视频样例的 `id/status` 与内容端点可复用现有协议，但参数与参考素材完整性仍要契约测试；图片编辑字段 `image` 与现有 `image[]` 的差异须核对，不凭样例就断定线上行为。
- 同步图片直接返回产物，异步图片返回任务 ID，均进入同一结果抽象；未实现的原生图片动作不能回退为同步 Images。
- 能力按接入方式及精确型号收敛；相同模型族、不同计费 ID 不能自动共用档案。保留已有图片语义参数、尺寸计算和每张独立任务规则。

### 素材交付与恢复

适配器声明二进制、data URI、公网 URL 或供应商文件 ID；素材层执行预检、必要转换、上传和复用。FastAIToken 本地素材走其上传接口，不要求额外建设公网存储；现有 S3 能力保留供其他接入使用，不强制所有协议走同一路径。

上传状态和引用持久化，复用按内容、接入目标和凭据归属隔离，并处理 URL／文件 ID 失效，不能跨账号误用。供应商上传并非天然幂等，未知结果不能宣称未上传；对远端上传清理的承诺以供应商实际 API 为限。

任务在提交前保存版本化调用快照：协议与实现契约版本、上游型号、有效地址和操作路由、能力档案、最终参数、素材引用、凭据来源引用以及幂等键。凭据值不落明文快照；敏感请求头仍走加密引用。配置修改只影响新任务；凭据禁用、删除或不可用时暂停旧任务并说明恢复条件，不能悄悄改用另一账号。

- 有远端任务 ID 时只查询，不重新提交。
- 提交响应丢失或格式无效且无法确认受理结果时，记录提交结果待确认；禁止自动换协议或非幂等重复 POST。
- FastAIToken 文档支持不超过 128 字符的 `Idempotency-Key`，同任务稳定复用，并冻结同一请求；其他协议仅在有明确支持证据时开启提交重试。
- FastAIToken 建议轮询间隔 3–5 秒、等待至少 5 分钟；本地等待截止只表示暂停等待，不等于远端失败，允许恢复查询。
- 下载失败只重试下载；本地取消等待与远端取消分别记录，远端接口确认后才显示远端已取消。

### 诊断与验证入口

诊断记录阶段（校验／上传／提交／查询／下载）、方法、脱敏域名与路径、HTTP 状态、上游安全错误码、请求 ID、远端 ID 是否存在和安全重试建议。不得记录密钥、完整提示词、素材内容或签名 URL 查询参数，不将原始上游正文塞入产物元数据字段。

设置页分开显示本地配置校验、目录／权限检查与真实生成验证结果。目录成功、GET 成功和文本测试成功均不代表媒体 POST 可用；真实生成测试明确提示可能计费。404 按发生阶段区分路由不存在、模型不可用和任务不存在，无法确定时保留不确定性。

### 兼容、迁移与收尾边界

新增配置与任务快照采用版本化契约和可重复验证的数据库迁移；不全局删 `/v1`。旧模型保持原有效 URL 与路径组合，用户选择新模板才改变接入。旧失败任务不重写、不自动重跑；H3 配置修正单独展示变更后的地址。

旧在途任务没有历史完整快照，无法追溯的部分不得伪造：只按可确定的旧协议、现有任务 ID 和兼容配置恢复查询；发现配置漂移或不能确认账号／地址时暂停并要求显式恢复绑定，绝不重新生成。新配置回滚与数据库迁移回滚分开处理，已分发迁移不改写；实现时提供备份、失败事务回滚与版本兼容测试。

03、04 已按用户授权实现，迁移新增为 `0010_generation_recovery.sql`，仅在临时数据库验证。快照版本 1 冻结默认与自定义路由、型号、参数、档案、素材引用和凭据指纹；旧任务缺快照统一暂停，不能凭当前配置重建历史事实。上传接口返回未承诺期限或清理能力；未知上传暂停确认，不能承诺远端删除。FastAIToken 精确档案与 `images/videos/audio`、模式映射及 16 KiB 提示词边界已补齐；现有界面开放 text／frames／reference 三类模式，不额外承诺独立 image_to_video 入口。05 整体验收尚未完成，因此整篇保留 proposed；真实供应商联调仍需明确范围与费用授权。

### 05 本地验收事实与剩余边界

严格 HTTP 服务器只接受约定的方法与路径，错误路径返回 404、错误 Bearer 返回 401；四种视频协议覆盖部署前缀、JSON／multipart、提交、查询和内容路径。OpenAI 与 FastAIToken 内容端点实际经过调度、鉴权下载、媒体探测和临时落盘，CDN 分支继续验证不转发渠道凭据。Images 与 TTS 模拟服务器也收紧方法与路径，避免任意 POST 误报成功。

验收发现 H3 原先只接受成功 `base_resp` 样例，未实现非零业务码检查。共享 submit／query 响应检查现拒绝非零整数码，保留安全错误码，不透传供应商原文或自动重试；畸形响应保留结果不确定语义。临时旧库升级测试验证 `/v1` 和 H3 失败历史不变，故意失败的迁移副本验证整批事务回滚，备份副本可读；不改发行迁移，不触碰用户真实数据库。

恢复回归补齐删除凭据暂停且不新增提交；图片节点 E2E 夹具补上本地假密钥以满足现有安全规则，不降低生产凭据检查。完整 Electron E2E 16 项通过，并实际查看模型接入设置及画布明暗截图。支持矩阵明确 FastAIToken 图片、MJ 动作、`face_check` 和独立 `image_to_video` 入口未启用。账号权限、精确型号、参考素材线上效果与费用仍未验证，05 因真实联调授权缺失保持 blocked，整篇不提前移入 implemented。

本轮全仓 660 项测试通过（contracts 186、canvas 100、desktop 177、engine 197）；类型检查、lint、格式检查、engine／desktop 构建、笔记与计划 verify 及差异空白检查均通过。以上是本地模拟与回归证据，不替代真实供应商联调。

### 相关笔记当场审计

- [模型管理与调用](2026-10-24-model-management.md)：部分重叠。本篇细化并拟调整地址、完整协议、幂等例外与任务快照，保留其加密、调度、存储和未完成的整体供应商验收；不归档、不宣称旧计划完成。
- [渠道中心设置](../../implemented/feature/2026-10-25-channel-centric-model-settings.md)：部分重叠。保留目录拉取语义和事务保存，新增模型接入模板与覆盖；模板不恢复旧渠道 preset 的隐式分派。
- [画布图片能力](../../implemented/feature/2026-10-26-canvas-image-node.md)：部分重叠。保留语义参数和多任务行为，拟收紧前缀推断在中转站能力上的使用；旧实现事实不重写。
- [无限画布](../../implemented/feature/2026-10-25-infinite-canvas.md)、[项目库](../../implemented/feature/2026-10-26-project-library.md)、[输入框修复](../../implemented/bug-fix/2026-10-26-canvas-composer-input.md)：相邻业务，不持有本次接入决定；不改其交互或已验收结论。
- [Agent 选型](2026-10-24-agent-runtime-pi.md)、[共享契约](../../implemented/architecture/2026-10-24-shared-contracts.md)、[engine 服务](../../implemented/architecture/2026-10-24-engine-service.md)、[基础设施](../../implemented/architecture/2026-10-24-engine-and-renderer-foundation.md)、[桌面壳](../../implemented/architecture/2026-10-24-desktop-shell.md)、[进程模型](../../implemented/architecture/2026-10-24-desktop-stack-and-process-model.md)、[主题与外壳](../../implemented/feature/2026-10-24-theme-and-app-shell.md)：检索命中基础边界，未被替代，继续遵守。提交规范与笔记流程的关键词命中属于流程说明，无接入决定冲突。

本篇没有完全吸收或需要拒绝的旧提案，不移动归档文件。上述三篇部分重叠笔记添加反向链接，表明未来变化而非伪造落地状态。

## Alternatives considered

- **只修改 H3 渠道地址为 `/minimax` 前缀**：改动最小，能修复当前提交路由；但会影响同渠道其他协议，且外层任务 ID、FastAIToken JSON、上传路径及配置漂移仍未解决。可用于诊断，不能作为根治方案。
- **自动补删 `/v1` 或从域名猜路由**：常见服务少填字段；中转挂载和部署前缀没有统一规律，FastAIToken 的 `/v1` 与 `/api/v1` 同时存在，会把不确定性隐藏到运行期。选择明确相对操作路径。
- **只提供自定义 Endpoint，复用一个视频适配器**：配置简单且可快速换网关；multipart 与 JSON、任务结构和下载鉴权不能靠路径解决。只允许在完整协议内覆盖路由。
- **用户脚本插件**：覆盖未知供应商最灵活；脚本持有密钥、迁移与任务恢复难以验证，维护负担转给用户。保留有限适配器，只有出现足够多无法声明的真实需求才重访隔离插件机制。
- **一次实现所有原生协议**：能最大限度暴露供应商能力；文档质量、鉴权和素材差异导致维护面迅速扩大，本次故障不需要全部原生操作。优先已实现标准协议与 FastAIToken、H3，其他按明确需求增加。

## Acceptance criteria

- 配置预览与实际请求的最终 URL 一致；版本前缀、部署前缀、上传不同前缀和模型跨域覆盖有精确契约测试。
- H3 正确提交／查询路径、外层任务 ID 与 `base_resp` 均被验证；FastAIToken JSON、素材上传、状态、错误、下载和幂等行为有独立测试。
- 流光标准图片／视频复用经过请求体与响应测试；未支持协议不能选择执行，FastAIToken 图片明确为待核实。
- 能力检查同时约束前端与 engine；精确型号、模式和素材组合不被前缀或用户覆盖绕过。
- 修改模型配置、重启、提交结果不确定、下载失败、凭据不可用均不造成重复生成；旧任务兼容边界有测试和可见提示。
- 错误可定位到阶段与脱敏路由；密钥不进入日志或外部产物下载；媒体验证结果不被文本测试代替。
- 设置页与画布状态在明暗主题可用；旧渠道、文本、图片、视频、TTS 和项目资产回归通过。
- 最终分别记录模拟测试、真实供应商联调与尚未验证项；未经真实请求验证，不宣称两家线上全部可用。

## Risks

- 收益是接入配置可解释、路由和解析一致、任务可恢复；代价是配置版本、路由定义、素材记录与生命周期需要跨 contracts、engine、desktop 同步维护。
- 文档会变化，FastAIToken 图片契约和部分 `face_check` 行为仍不明确；实施时再次核对，缺口不阻塞已明确协议，但相应能力保持禁用。
- 支持上传不等于供应商长期保存素材。引用失效、账号切换与数据清理需要独立处理，不能对远端文件生命周期作无依据承诺。
- 旧任务缺失完整历史快照无法无损推断；宁可暂停恢复绑定，也不能向错误目标重投。诊断应说明此限制。
- 内置模板能降低配置错误，不能证明账号权限、余额和供应商在线状态；测试报告必须标明验证层级。

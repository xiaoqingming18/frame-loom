# Agent Note: 以渠道为中心的模型设置（API 格式取代渠道预设）

Status: implemented
Archived: 2026-10-29

## Problem

模型服务页把渠道选择、渠道详情、全部模型和默认模型堆在同一页，"拉取模型"会把上游返回的全部模型直接写库为未分类、禁用状态，中转站一次能写入上百条无用记录。模型表单的调用协议下拉列出全部十二种协议，与所选类别无关；覆盖项和附加请求头要求手写 JSON。用户参考 MiniMax Design 的模型接入页，要求列表只列渠道、在渠道编辑页内配置模型、拉取结果由用户挑选、协议随类别过滤、默认模型独立成页，并评估渠道预设能否去掉。

渠道预设 `preset` 原先只被认为决定表单默认值，实际还决定 engine 拉取模型列表的路径和鉴权头（Gemini 用 `x-goog-api-key`，Anthropic／MiniMax 用 `x-api-key` 与 `/v1/models`，其余用 Bearer 与 `/models`）。直接删除会让拉取和模型测试第一步失去依据。

## Decision

- **API 格式取代预设**：`channels.preset` 由 `api_format` 取代，取值即四种文本协议 `LlmProtocol`。它决定拉取模型列表的鉴权与路径，并作为新建文本模型的默认协议；每个模型仍可独立选择协议，不改变"同一渠道内协议按模型区分"的决定。迁移 `0004_channel-api-format.sql` 按旧值回填：`openai` → `openai-responses`，`anthropic`／`minimax` → `anthropic-messages`，`gemini` → `google-generative-ai`，其余 → `openai-completions`，拉取行为与迁移前一致；随后删除 `preset` 列。Base URL 快速填充随预设一并移除，地址输入框按 API 格式显示示例。
- **草稿拉取不写库**：`POST /channels/probe-models` 接收表单草稿 `{ apiFormat, baseUrl, apiKey?, headers?, channelId? }`，只返回去重后的上游模型 ID。带 `channelId` 时未填写的密钥与请求头沿用该渠道已保存的值，因此新建渠道无需先保存、编辑渠道无需重填密钥。超时、`redirect: 'error'` 与错误分类沿用原拉取逻辑；旧的 `/channels/:id/fetch-models` 已删除。renderer 在编辑页展示可搜索的多选清单，已添加的 ID 禁用并标注。
- **渠道与模型一次保存**：`ChannelWrite` 新增可选 `models`（`ChannelModelSave[]`，最多 500 项）。engine 先逐项执行 `validateModel` 与元数据校验，再在一个 SQLite 事务中写入渠道并同步模型：带 `id` 的更新，不带的新增，缺席的删除；先删后写，避免改名或换协议时撞上唯一约束。任何一项失败整体回滚。`id` 不属于该渠道时返回 404。不传 `models` 时保持原有只改渠道的语义，`/channels/:id/models` 与 `/channel-models/:id` 接口保留。
- **协议按类别过滤**：contracts 导出 `protocolsByKind`，renderer 用它过滤下拉，`ChannelsService.validateModel` 用同一张表拒绝类别与协议不匹配的写入（`INVALID_PROTOCOL`）。切换类别时不在新列表中的协议被清空；chat 默认取渠道 API 格式，只有一个协议的类别自动选中。
- **结构化字段**：文本模型显示上下文窗口、最大输出、推理和图片输入；`compat` 留在"高级"折叠区以 JSON 编辑。媒体模型以 `/model-profiles` 过滤出的档案下拉取代手填档案 ID。附加请求头改为逐行键值；已保存的请求头值不可读取，编辑时默认不提交 `headers`（保留），点击"重新设置请求头"后整体替换。
- **页面结构**：`features/model-services/model-services.tsx` 的列表只显示渠道卡片（名称、地址、模型数、密钥尾号、最近检测），编辑页包含渠道字段、测试与删除渠道、模型卡片和保存。模型列表加载完成前禁用"编辑"，因为保存以编辑页内的模型列表为准，空列表会删除已有模型。默认模型移至 `model-defaults.tsx`，设置页签新增 `defaults`（"默认模型"）。

## Alternatives considered

- **保留预设下拉，只改界面**：最强理由是零迁移，常见供应商一键填好地址。但预设与真正影响行为的鉴权方式是多对一关系（`ark`、`openrouter`、`openai-compatible` 都等同 OpenAI 兼容），用户无法从名称看出它决定拉取方式；中转站用户总是选"通用中转站"再手填地址，预设的地址填充价值有限。改为直接选 API 格式，所见即行为。
- **按 Base URL 域名推断鉴权**：最强理由是表单少一个字段。中转站域名没有规律，猜错后拉取失败且原因难以解释，与笔记中拒绝按名称猜类别的理由相同。
- **依次尝试三种鉴权头**：最强理由是用户无需了解协议。同一密钥会以不同头部发往同一地址多次，失败分类也无法对应到一次确定的请求。
- **先保存渠道再拉取**：最强理由是复用原 `/channels/:id/fetch-models`，不新增接口。新建渠道时用户必须先保存一个空渠道才能看到模型，与"在添加渠道时拉取"的需求不符；拉取接口还会写库，正是本次要去掉的行为。
- **renderer 依次调用渠道与模型接口保存**：最强理由是 engine 不改接口。中途失败会留下只保存了一半的渠道与模型，用户无从判断哪些已生效；事务保存在 engine 内只需一次同步函数。

## Consequences

- **后续提案**：[模型服务接入契约与路由](../../rejected/architecture/2026-10-27-model-service-protocol-routing.md)已部分落地模型级地址、模板及任务恢复，整体真实验收未闭合。2026-10-27 用户确认[多模态服务配置与模型演进重构](../../rejected/architecture/2026-10-27-model-service-experience-and-evolution.md)，拟由高级服务接入管理协议与地址，普通表单不再选择 API 格式或能力档案，并移除特定中转站内置模板；保留本篇草稿拉取与事务保存。新方案尚未实现，本篇已落地行为不改写。2026-10-28 两篇后续提案均转 rejected，[模型服务配置层重构](../../proposed/architecture/2026-10-28-model-service-rebuild.md)落地后将完全取代本篇（渠道 API 格式改为仅决定模型列表格式、档案下拉删除）；草稿拉取不写库与不按域名猜鉴权由新篇继承，届时本篇归档。

- **收益**：设置列表只呈现渠道；拉取不再产生未分类垃圾记录；类别与协议不匹配在 renderer 和 engine 两侧被拦截；一次保存要么全部生效要么全部回滚；去掉了覆盖项与请求头的手写 JSON。
- **代价**：`ChannelWrite`／`Channel` 的 `preset` 字段改名为 `apiFormat`，属于内部契约破坏性变更，renderer、engine 与测试在同一提交内迁移；常见供应商不再自动填写地址。删除模型现在通过"保存时缺席"发生，误操作的防线是编辑页内的移除按钮和取消按钮，保存前不会生效。
- **已知上限**：保存时提交的模型列表上限 500 项；拉取结果在 renderer 内一次性渲染，若上游返回上万条需要虚拟列表。生成任务表对 `channel_model_id` 不设外键，删除模型后历史任务保留原 ID。

## Verification

- `apps/engine/src/core/database/database.service.test.ts` 用 0000～0003 建库并写入六种旧预设，再执行完整迁移，断言回填结果。
- `apps/engine/src/modules/llm/llm.integration.test.ts` 覆盖草稿拉取不写库、`channelId` 复用已存密钥与请求头、Gemini 鉴权头、事务内增改删、协议不匹配 422 与重复 409 时整体回滚。
- `apps/desktop/src/renderer/src/features/model-management.test.tsx` 覆盖草稿拉取请求体、搜索与勾选、协议随类别过滤、一次保存的请求体、密钥与请求头留空保留、移除模型与删除渠道确认、默认模型独立页面。
- 桌面 e2e `model-management.test.ts` 与 `generation-image.test.ts` 在 Electron 中走完新建渠道、拉取勾选、保存、测试和默认模型设置，并截取明暗模式的列表页与编辑页。

相关笔记：[模型管理与调用](../../proposed/architecture/2026-10-24-model-management.md) 中"渠道预设只决定表单默认值"的事实由本篇取代；该篇其余决定（按模型选协议、不猜类别、加密与日志边界）不变。[主题与外壳](2026-10-24-theme-and-app-shell.md) 的设置页签已同步。

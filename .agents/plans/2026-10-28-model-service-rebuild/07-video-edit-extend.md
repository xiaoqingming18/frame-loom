# Plan: 视频编辑与续写

Status: draft
Parent: plan.md

## 目标

视频节点支持 `edit`（视频编辑）和 `extend`（视频续写）两种方式。具体包括：

- 能力卡可以勾选这两种方式。
- 画布出现「待编辑视频」端口，接收 1 个视频输入。
- `ark-seedance` 和 `kling-omni` 两个协议能把请求翻译出来并提交。

协议的能力上限中没有这两种方式时，界面不显示对应的方式，engine 也拒绝请求。

## 前置条件

- 03 与 05 已完成。
- 实施前先核对两份官方文档的当前版本，把 URL 和核对日期补进协议描述的 `sources` 字段：
  - 方舟视频任务（https://ark.volcengine.com/region:cn-beijing/docs/create-video-generation-task-api）：重点核对 `omni_reference_task_type` 的取值（`edit`、`extend`）；编辑场景对 `ratio`、`duration` 的要求（调研时记录为 ratio 需 `adaptive`、duration 需 `-1`）；参考视频的时长范围。
  - 可灵 4.0 Omni（https://kling.ai/document-api/api/video/4-0/video-omni.md）：重点核对 `base_video` 的字段与限制，以及是否支持续写。
- 文档未确认支持的方式，不写入能力上限，并在「发现与偏差」中记录。

## 规格

- **contracts**
  - 01 已定义方式 id 和 `base_video` 角色，这里不再新增。
  - 在 `checkRequest` 中确认 `edit`、`extend` 必须且只能有 1 个 `base_video`，否则报错。
  - `withReference` 决定这两种方式能否同时带参考素材。
- **协议**：在 `ark-seedance` 和 `kling-omni` 的能力上限与模板中加入文档确认支持的方式，并补齐以下内容：
  - 规则：例如 Seedance 编辑时比例只能取 `adaptive`，时长只能交给模型决定。
  - 请求翻译：`base_video` 放在协议要求的字段，素材以链接或内联方式交付，按 transport 设置。
- **画布**
  - 视频节点在 `edit`、`extend` 方式下显示「待编辑视频」槽位，接受 1 个 `video` 输入，可以连线，也可以从当前画布的视频产物中选取。
  - 槽位显示缩略图和时长。时长超出模板中参考视频的单个时长限制时，阻止提交。
  - 勾选了 `withReference` 时，另外显示参考素材行。
- **设置页**：04 已支持勾选这两种方式并显示所用素材「待编辑视频 1 个」，这里只做核对。

## 步骤

- [ ] T1 核对两份官方文档，更新协议描述的能力上限、模板、规则与 `sources` — 验证：`pnpm --filter @frame-loom/contracts test -- protocols`
- [ ] T2 实现适配器的编辑与续写请求翻译 — 验证：契约测试覆盖以下内容，命令为 `pnpm --filter @frame-loom/engine test -- protocols/video`：
  - Seedance 的编辑、续写请求体，含 `omni_reference_task_type`、`reference_video` 和规则锁定值。
  - Kling 的 `base_video` 请求体。
  - 缺少 `base_video`、有多个 `base_video`、混用参考素材但能力不允许时，`checkRequest` 报错。
- [ ] T3 实现画布的「待编辑视频」槽位与选取 — 验证：组件测试覆盖以下内容：
  - 方式只在能力卡中勾选后才出现。
  - 槽位只接受视频，数量上限为 1。
  - 时长超限时阻止提交。
  - 切换方式后连线保留，不兼容的端口被禁用。
- [ ] T4 E2E：在 `generation-image.test.ts` 的视频场景中，或新建 `video-edit.test.ts`，覆盖「先生成视频 → 新视频节点选择编辑方式 → 连接待编辑视频 → 提交 → 模拟上游断言请求体 → 写回」— 验证：`pnpm --filter @frame-loom/desktop test:e2e -- video-edit`（或所在文件名）

## 验证

- 预期：contracts、engine、canvas 受影响的测试和对应的 E2E 通过；文档未确认的方式没有写入能力上限，并有记录。
- 实际：未执行。

## 进度

- 2026-10-28：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始。

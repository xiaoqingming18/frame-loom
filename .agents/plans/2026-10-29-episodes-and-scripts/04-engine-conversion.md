# Plan: 后台转换与文本模型

Status: draft
Parent: plan.md

## 目标

engine 实现导入、取消和丢弃三个接口，以及四阶段的后台转换。转换在内存中保存状态并发布事件，模型只输出标签，写入前检查原文完整性。规格以功能笔记的「转换」一节为准：模型调用入口、批次大小、输出校验、应用决定的方式、状态与恢复，每一条都必须照做。本子计划不改界面。

## 前置条件

- 03 已完成。
- 已阅读 `apps/engine/src/modules/llm/llm.service.ts`（`prepare`、`run`、`chat`）、`llm.integration.test.ts` 的 `mockUpstream` 写法、`core/events/event-bus.ts`、`packages/contracts/src/events.ts`，以及 `model-services.repository.ts` 中的 `defaults()`。

## 步骤

- [ ] T1 `LlmService.complete(modelId, { system, user }, signal)`：
  - 复用 `prepare` 和 `run`，`Context` 设为 `{ systemPrompt: system, messages: [user] }`；
  - 拼接所有 `text_delta`，没有收到 `done` 时抛出 `INCOMPLETE_STREAM`；
  - `ModelServicesModule` 导出 `LlmService` 和 `ModelServicesRepository`，后者已经在导出列表中。

  — 验证：在 `llm.integration.test.ts` 中新增一个用例。`mockUpstream` 断言请求体中的 system 消息和 user 消息，返回两个分块，`complete` 的结果等于两块文本拼接；上游返回 401 时，抛出 `AUTH_FAILED`。
- [ ] T2 `events.ts` 新增 `{ type: 'script.conversion.updated', projectId, episodeId }`。

  — 验证：`events.test.ts` 已有的解析测试中，加入这个事件的正例和反例（缺少 `episodeId`）。
- [ ] T3 新建 `scripts/conversion.service.ts`：
  - 全局 FIFO 队列，同一时刻只运行一个转换；
  - 状态表的键为 `projectId:episodeId`，值为 `ConversionState`，最近一次状态一直保留；
  - 每个任务带一个 AbortController；
  - 每次状态变化时，通过 `EventBus` 发布事件；
  - 四个阶段：`split` 用 `parseScriptText`；`classify` 和 `extract` 在同一批调用中完成；`match` 在 `serial` 中执行，依次为：用 `checkSourceIntegrity` 检查、写入剧本（把 `pendingImport` 移到 `source`、替换段落、写入 `convertedAt`、revision 加 1）、写入剧集摘要、执行同步、写入模型提取的元素、计算 `result`。

  — 验证：`scripts/conversion.integration.test.ts` 中，没有默认文本模型时，导入样例剧本得到：状态从 queued 到 running 再到 succeeded；共 60 个段落，其中 3 个存疑；`addedElements` 为 10；`warnings` 中包含「未设置默认文本模型」；事件至少发布了 3 次。
- [ ] T4 实现分批、提示词和输出校验：
  - 按行累计不超过 6000 个字符为一批；每批的存疑行数不超过 `max(10, floor((maxOutput − 400) / 20))`；没有存疑行的批次不调用模型；
  - 提示词放在 `scripts/conversion-prompt.ts`，内容是 system 文本加上输入 JSON，格式见笔记；
  - 用 zod 校验输出，并按笔记逐条丢弃不合规的内容：非存疑行的 id、角色不合法的 dialogue 决定、名称不在原文中的元素，每批最多接受 30 个元素；
  - 解析失败时重试一次，再失败就按规则结果处理并记录警告；遇到 provider 错误后，剩余批次都不再调用模型。

  — 验证：使用 `mockUpstream` 模拟的 OpenAI Chat 模型，覆盖以下场景：
  1. 正常决定被应用：「周屿 你这几年还好吗」拆成角色段落加对白段落，原 id 保留在对白段落上；
  2. 模型夹带的 `text` 字段，以及名称不在原文中的元素，都被丢弃；
  3. 第一次返回非法 JSON、第二次返回合法 JSON 时，结果被采用，上游正好收到 2 个请求；
  4. 返回 500 时，后续批次不再调用模型，上游请求数等于 1，状态为 succeeded 并带警告；
  5. `sameAs` 指向已有人物时，新元素带有 `suggestedMergeInto`。

  每个场景都要断言上游请求次数。
- [ ] T5 接口：
  - `import`：比较 revision；设定不完整且请求未带 `profile` 时返回 422 `PROJECT_PROFILE_REQUIRED`；带了 `profile` 时先写回清单；写入 `pendingImport`（revision 加 1）；入队后返回 202；没有 `text` 也没有 `pendingImport` 时返回 422 `SCRIPT_IMPORT_EMPTY`；
  - `cancel`：中止转换，状态改为 cancelled；
  - `DELETE import`：转换运行中时返回 409，否则清空 `pendingImport`；
  - 转换期间，`PUT script` 和 `DELETE episode` 都返回 409 `SCRIPT_CONVERTING`；
  - `GET script` 和剧集列表都带上 `conversion`。

  — 验证：集成测试覆盖以下几点：每个错误码；取消后剧本段落不变、`pendingImport` 仍在；`restart()` 后 `conversion` 为 null，`pendingImport` 仍在，不带 `text` 再次导入可以成功；用 deferred 让模拟上游挂起，确认转换期间保存返回 409。

## 验证

- 预期：先运行 `pnpm --filter @frame-loom/engine... build`，然后运行 `pnpm --filter @frame-loom/engine exec vitest run src/modules/scripts src/modules/llm src/core/events`，以及 `pnpm --filter @frame-loom/engine typecheck`，都应通过。所有模型调用都使用 `mockUpstream`，不访问网络。
- 实际：未执行。

## 进度

- 2026-10-29：创建子计划草稿。

## 发现与偏差

无。

## 交接

依赖 03，尚未开始。

# Plan: 设定库、同步与出现位置

Status: draft
Parent: plan.md

## 目标

engine 提供设定库的全部命令，包括新建、修改、合并、忽略或删除、恢复和批量操作，规格见功能笔记「接口」表中 `/story` 开头的几行。每次保存剧本后，engine 自动同步待确认元素，并通过缓存提供出现位置和每集的待确认数。这个子计划同时补上 02 中暂时固定的 `addedElements` 和剧集列表的 `pending`。

## 前置条件

- 02 已完成。
- 已阅读功能笔记的「设定库」和「元素匹配与同步」两节，以及 01 实现的 `findMentions`、`syncCandidates`、`deriveScenes`。

## 步骤

- [ ] T1 新建 `scripts/story.service.ts`。所有修改都按「在 `serial(projectId)` 中读取、修改、写回」的方式执行，每次写入时 `revision` 加 1。

  需要实现的命令：
  - 新建元素：状态为 confirmed，名称冲突时返回 409 `ELEMENT_NAME_CONFLICT`；
  - 修改元素：别名冲突同样返回 409；
  - 合并元素：两个元素必须同类，否则返回 422 `ELEMENT_KIND_MISMATCH`。源元素的名称和别名并入目标元素的别名，然后删除源元素。其他元素的 `suggestedMergeInto` 如果指向源元素，改为指向目标元素；改完后如果指向自己，就清除；
  - 忽略或删除元素：删除元素，并把它的名称和全部别名写入 `ignored`；
  - 恢复已忽略的名称：从 `ignored` 中移除，然后对所有剧本执行一次同步；
  - 批量操作：一次请求最多 500 个 id，不存在的 id 直接跳过。

  — 验证：`scripts/story.integration.test.ts` 覆盖以下用例：各命令的成功路径和每个错误码；合并后其他元素的 `suggestedMergeInto` 被重新指向；忽略后，再次保存剧本时不会重新创建该元素；恢复后会重新创建为待确认元素。
- [ ] T2 实现 `sync(projectId, blocks)`：
  - 用 `syncCandidates` 取出候选名称；
  - 如果某个名称与同类元素的名称或别名都不匹配，也不在 `ignored` 中，就新建为待确认元素；
  - 返回新增的数量。

  在 `PUT script` 中，剧本写完之后调用 `sync`，并在响应中返回 `addedElements`。

  — 验证：保存样例剧本的规则解析结果后，`addedElements` 为 10，其中 4 个人物、6 个场景；内容不变时再保存一次，结果为 0；角色段落「店主（OS）」只生成「店主」这一个元素。
- [ ] T3 实现出现位置的缓存。缓存键包括：剧本的 revision、mtimeNs、size，以及设定库的 revision。每次读取前先 stat 剧本文件，只有键不一致时才重新读取和匹配。匹配时跳过 note 段落。

  需要提供：
  - `GET /story`：每个元素带 `mentions`（总出现次数）和 `episodes: [{ episodeId, scenes }]`（每集中出现的不同场数）；
  - `GET /story/elements/:id/occurrences`：最多返回 200 条，摘录不超过 80 个字符；
  - 剧集列表中的 `pending`。

  — 验证：两集剧本都提到「林夏」时，`episodes` 中两集都出现；外部修改剧本文件后，出现位置随之更新；合并元素后，源元素的名称计入目标元素的出现次数；note 段落中的名称不计入。
- [ ] T4 把 `StoryService` 注入 `EpisodesService`：剧集列表返回真实的 `pending`。

  — 验证：剧集列表的集成测试断言 `pending` 等于该集中出现过的待确认元素数，确认一个元素后，这个数字减 1。

## 验证

- 预期：先运行 `pnpm --filter @frame-loom/engine... build`，然后运行 `pnpm --filter @frame-loom/engine exec vitest run src/modules/scripts` 和 `pnpm --filter @frame-loom/engine typecheck`，都应通过。不运行其他目录的测试。
- 实际：未执行。

## 进度

- 2026-10-29：创建子计划草稿。

## 发现与偏差

无。

## 交接

依赖 02，尚未开始。

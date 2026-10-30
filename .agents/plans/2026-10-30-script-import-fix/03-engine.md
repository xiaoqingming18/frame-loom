# Plan: engine 转换、角色表与清理

Status: done
Parent: plan.md

## 目标

`apps/engine/src/modules/scripts/` 按笔记的「转换」「前言与附录 → 角色表入库」「设定库同步与清理」三节完成以下改动：

- 配置了文本模型时，全部正文行都交给模型，模型可以对任意一行做出决定；
- 角色表中的人物写入设定库；
- 同步时跳过存疑段落；
- 待确认元素在不再出现于任何剧集时被清理；
- 读取 v1 剧本后，第一次保存写出 v2；
- 剧本中的前言和附录参与出现位置的计算。

## 前置条件

- 01 已完成。
- 已阅读 `conversion.service.ts`（分批、`apply`、match 阶段）、`conversion-prompt.ts`、`story.service.ts`（`sync`、`occurrences` 缓存），以及 `conversion.integration.test.ts`、`story.integration.test.ts` 的现有写法。

## 步骤

- [x] T1 修改分批规则：所有正文行都进入批次，每行带上 `guess`，存疑行带 `unsure: true`；按 6000 个字符和 `max(10, floor((maxOutput − 400) / 20))` 行切分；前言和附录不进入批次。修改 `conversion-prompt.ts`：说明 12 种类型的含义、production 及其 label、`guess` 字段，并要求「只返回需要改变的行」。

  — 验证：集成测试使用 `mockUpstream`。导入 `script-sample-02.txt` 后，把所有请求中的行 id 合在一起，正好覆盖全部正文行，而且不含前言和附录中的行。上游请求的数量等于按上述规则计算出的批次数（测试中手动计算并断言）。
- [x] T2 修改 `apply`：
  - 允许对任意一行做出决定；
  - 同一原文行生成的所有段落作为一个整体，用 `retypeLine` 生成的新段落替换，并按笔记沿用 id；
  - type 为 dialogue 时，补 character 段落的条件按笔记执行；
  - 模型没有提到的存疑行，清除 review；
  - provider 错误或两次输出都不合法的批次，保留 review，并记录一条警告；
  - 现有的角色合法性和元素名称校验保持不变；
  - 每一批都提取元素。

  — 验证：模拟模型覆盖以下几点：
  1. 把非存疑的 action 行 `142`（「反打：…」）改为 production，结果被采用，id 沿用；
  2. 模型没有提到的存疑行（「片名」），review 被清除；
  3. 第一批返回 500 时，第一批的存疑行保留 review，后续批次不再调用模型，警告中写明原因；
  4. 模型夹带的 `text` 字段被丢弃；
  5. 名称不在原文中的元素被丢弃。

  每个场景都要断言上游请求次数。
- [x] T3 角色表入库：在 match 阶段、规则同步之前，按笔记规则写入 `roster`；新增数量计入 `addedElements`。

  — 验证：不配置模型时导入 `script-sample-02.txt`，结果为：`result` 为 6 场、67 段、2 处存疑；`addedElements` 为 24；设定库中已确认的人物有卢允之、影娘、卢母、道士、张小姐（带说明），待确认的人物有 14 个，另外还有孩童们、卢生，以及 3 个场景（城西卢宅·正屋、卢宅门口、卢宅正屋）；「片名」「片尾字幕卡」不是场景。

  再导入一次同一份剧本，`addedElements` 为 0，已确认人物的 description 不被覆盖。
- [x] T4 修改同步与清理：
  - `sync` 跳过带 review 的段落（由 01 的 `syncCandidates` 实现，这里只需确认行为）；
  - 新增 `pruneOrphans(projectId)`，在保存剧本和转换完成后，各执行一次（都在 `sync` 之后、同一个 `serial` 中）；
  - 出现位置的缓存加入前言和附录的匹配结果；
  - 被删除元素的 `suggestedMergeInto` 引用一并清除。

  — 验证：集成测试覆盖以下几点：
  1. 两集剧本都提到「周屿」，删掉其中一集的相关段落并保存后，元素保留；两集都删掉后，元素被删除；
  2. 已确认的元素在不出现时也保留；
  3. 只在前言中出现的待确认元素保留；
  4. 指向被删除元素的 `suggestedMergeInto` 被清除。
- [x] T5 v1 兼容与现有测试：
  - 把一份 v1 格式的剧本文件直接写到磁盘，`GET` 后返回 v2，`PUT` 后磁盘上的文件为 v2；
  - 现有测试中依赖旧规则的预期（例如「样例 01 的 sound 没有 label」「只为存疑行调用模型」），按新规格更新；
  - 原样例 01 的「10 个待确认元素」保持不变。

  — 验证：`conversion.integration.test.ts`、`story.integration.test.ts` 和 `episodes.integration.test.ts` 全部通过。

## 验证

- 预期：先运行 `pnpm --filter @frame-loom/engine... build`，再运行 `pnpm --filter @frame-loom/engine exec vitest run src/modules/scripts` 和 `pnpm --filter @frame-loom/engine typecheck`，都应通过。所有模型调用都使用 `mockUpstream`，不访问网络。
- 实际：engine... build、engine typecheck 通过；`pnpm --filter @frame-loom/engine exec vitest run src/modules/scripts` 共 19 项通过。新样例纯规则为 6 场、67 段、2 处存疑、新增 24 元素；模型 3 批覆盖 67 个正文行。

## 进度

- 2026-10-30：创建子计划草稿。
- 2026-10-30：完成全正文分类、角色表入库、跨集清理与 v1 落盘迁移集成验证。

## 发现与偏差

无。

## 交接

无。

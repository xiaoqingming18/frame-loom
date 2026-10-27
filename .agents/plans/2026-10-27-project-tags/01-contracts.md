# Plan: 标签契约

Status: done
Parent: plan.md

## 目标

`packages/contracts` 提供 engine 与画布共用的标签数据格式和规则：

- `TagColor`、`TagId`、`TagName`、`ProjectTag`、`BUILTIN_TAGS`。
- `ProjectManifest.tags` 可选字段。
- `projectTags(manifest)` 缺省解释函数。
- 新增 `CanvasNode.tagId` 可选字段，并定义 `TAGGABLE_NODE_TYPES` 常量。
- 标签接口的请求与响应 schema。

## 前置条件

- 无。

## 步骤

- [x] T1 在 `packages/contracts/src/projects.ts` 定义标签 schema 与 7 个内置标签（id、名称、颜色按笔记表格）；清单 `tags` 最多 50 个，id 与名称（不区分大小写）唯一 — 验证：单测覆盖 10 字符边界、首尾空白去除、大小写重名、51 个被拒
- [x] T2 实现 `projectTags(manifest)`：缺省时返回内置列表，空数组原样返回 — 验证：单测
- [x] T3 在 `packages/contracts/src/canvas.ts` 为 `CanvasNode` 增加 `tagId?: TagId`；新增 `TAGGABLE_NODE_TYPES = ['image', 'video']`；`CanvasDocument` 拒绝其他类型携带 `tagId` — 验证：单测覆盖分组携带 `tagId` 被拒、图片通过
- [x] T4 定义 `ProjectTagCreateRequest`、`ProjectTagUpdateRequest`（至少一个字段）、`ProjectTagUsage`、`ProjectTagDeleteRequest`（`reassign` 最多 2000 项）并导出 — 验证：`pnpm --filter @frame-loom/contracts test`、`typecheck`

## 验证

- 预期：contracts 单测、typecheck、lint 通过。
- 实际：`pnpm --filter @frame-loom/contracts test` 通过（12 个测试文件、191 项）；`pnpm --filter @frame-loom/contracts typecheck` 通过。

## 进度

- 2026-10-27：创建子计划草稿。
- 2026-10-27：完成标签 schema、默认列表、CanvasNode tagId 校验与契约测试；contracts 191 项测试和 typecheck 通过。

## 发现与偏差

无。

## 交接

无。

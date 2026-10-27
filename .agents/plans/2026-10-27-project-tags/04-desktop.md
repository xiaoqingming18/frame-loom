# Plan: 宿主与删除弹窗

Status: draft
Parent: plan.md

## 目标

desktop 项目画布注入 `host.tags` 并定义标签色 token。加载页面时清理悬空引用。删除标签走「保存 → 查询引用 → 确认或改派 → 删除」流程。

## 前置条件

- 02、03 完成。

## 步骤

- [ ] T1 在 `apps/desktop/src/renderer/src/styles/theme.css` 定义 10 色 `--tag-<color>` 与 `--tag-<color>-bg`，每色都有明暗两套值 — 验证：明暗截图对比度自查
- [ ] T2 在 `apps/desktop/src/renderer/src/lib/project-queries.ts` 增加标签查询，在 `apps/desktop/src/renderer/src/features/projects/canvas/project-canvas.tsx` 注入 `host.tags` 的 `list`、`create`、`update` — 验证：组件测试 mock engine
- [ ] T3 在 `apps/desktop/src/renderer/src/features/projects/canvas/canvas-persistence.ts` 加载页面时取标签列表，把 `tagId` 不在列表中的节点清空后再 `reset`，不标记为未保存 — 验证：`canvas-persistence.test.ts`
- [ ] T4 新增 `apps/desktop/src/renderer/src/features/projects/canvas/tag-delete-dialog.tsx`，并实现 `host.tags.remove`：
  - 先 `flush`，失败时中止。
  - 查询引用；没有引用时显示不可恢复确认框。
  - 有引用时显示引用弹窗：每行缩略图、标题、创作页名称和目标下拉，顶部「全部改为 X」，全部选好后才能删除。
  - 锁定节点照常列出并可改派，该行显示带「已锁定」可访问名称的锁定图标。
  - 确认后，当前页通过 store 一次 `apply` 直接改写 `tagId`（不经过跳过锁定节点的 `setTag`）再 `flush`，其他页作为 `reassign` 提交。
  - 收到 409 时刷新列表。

  — 验证：组件测试覆盖逐行修改、全部改为、未全部选择时禁用、409 刷新、当前页修改可撤销、锁定节点可改派
- [ ] T5 运行 desktop 全量单测 — 验证：`pnpm --filter @frame-loom/desktop test`、`typecheck`

## 验证

- 预期：desktop 单测与组件测试、typecheck、lint 通过。
- 实际：未执行。

## 进度

- 2026-10-27：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始，等待 02、03。

# Plan: 宿主与删除弹窗

Status: done
Parent: plan.md

## 目标

desktop 项目画布注入 `host.tags` 并定义标签色 token。加载页面时清理悬空引用。删除标签走「保存 → 查询引用 → 确认或改派 → 删除」流程。

## 前置条件

- 02、03 完成。

## 步骤

- [x] T1 在 `apps/desktop/src/renderer/src/styles/theme.css` 定义 10 色 `--tag-<color>` 与 `--tag-<color>-bg`，每色都有明暗两套值 — 验证：`src/main/theme.test.ts` 校验 20 组徽标文字对比度均至少 4.5:1；实际明暗截图合并到 05 验收
- [x] T2 在 `apps/desktop/src/renderer/src/lib/project-queries.ts` 增加标签查询，在 `apps/desktop/src/renderer/src/features/projects/canvas/project-canvas.tsx` 注入 `host.tags` 的 `list`、`create`、`update` — 验证：组件测试 mock engine
- [x] T3 在 `apps/desktop/src/renderer/src/features/projects/canvas/canvas-persistence.ts` 加载页面时取标签列表，把 `tagId` 不在列表中的节点清空后再 `reset`，不标记为未保存 — 验证：`canvas-persistence.test.ts`
- [x] T4 新增 `apps/desktop/src/renderer/src/features/projects/canvas/tag-delete-dialog.tsx`，并实现 `host.tags.remove`：
  - 先 `flush`，失败时中止。
  - 查询引用；没有引用时显示不可恢复确认框。
  - 有引用时显示引用弹窗：每行缩略图、标题、创作页名称和目标下拉，顶部「全部改为 X」，全部选好后才能删除。
  - 锁定节点照常列出并可改派，该行显示带「已锁定」可访问名称的锁定图标。
  - 确认后，当前页通过 store 一次 `apply` 直接改写 `tagId`（不经过跳过锁定节点的 `setTag`）再 `flush`，其他页作为 `reassign` 提交。
  - 收到 409 时刷新列表。

  — 验证：组件测试覆盖逐行修改、全部改为、未全部选择时禁用、409 刷新、当前页修改可撤销、锁定节点可改派
- [x] T5 运行 desktop 全量单测 — 验证：`pnpm --filter @frame-loom/desktop test`、`typecheck`

## 验证

- 预期：desktop 单测与组件测试、typecheck、lint 通过。
- 实际（2026-10-27）：`pnpm test` 全仓 736 项通过，其中 desktop 21 个文件、189 项；`pnpm typecheck` 与 `pnpm lint` 全仓通过。
- 标签相关测试：删除弹窗 4 项；宿主新增 5 项覆盖增改同步、保存先于引用扫描、当前页锁定节点一次改派可撤销、其他页 reassign、409 重扫与重置选择、保存失败中止；持久化新增 2 项覆盖悬空清理不产生历史／脏状态及标签加载失败重试。
- `src/main/theme.test.ts` 对 10 色明暗前景／徽标底共 20 组验证文字对比度至少 4.5:1。未执行实际明暗截图、720×560 或 Electron e2e，不以静态 token 检查替代 05 视觉验收。

## 进度

- 2026-10-27：创建子计划草稿。
- 2026-10-27：保留既有未提交实现，完成宿主标签服务、加载清理及删除引用流程复核；删除目标改用现有 NativeSelect，补齐请求校验与 8 项回归（宿主 5、持久化 2、主题 1）。全仓测试、类型与 lint 通过，子计划转 done。

## 发现与偏差

- 原明亮黄色徽标文字对比度为 4.42:1，前景改为 `#854d0e` 后通过至少 4.5:1 的主题检查；其余颜色也全部纳入检查。
- T1 的自动验收采用 token 完整性及文字对比度测试，实际明暗截图与最小窗口统一留给 05，不将其标记为人工通过。
- 当前工具未提供 `apply_patch`，PATH 中也无此命令；使用现有 `edit` 工具针对性修改，未安装替代工具。

## 交接

无。实际 Electron 删除／改派／重启、明暗截图、720×560、键盘与焦点检查由 05 承接，尚未执行。

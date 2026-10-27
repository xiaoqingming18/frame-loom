# Plan: 画布标签交互

Status: draft
Parent: plan.md

## 目标

画布包在宿主注入 `tags` 时提供以下能力：

- 右键「标签」卡片：选中态、批量打标签、移除、添加、行内编辑、删除入口。
- 节点头部徽标。
- 剪贴板和导入 JSON 时按名称匹配标签。

没有注入 `tags` 时，这些能力都不出现。

## 前置条件

- 01 完成。

## 步骤

- [ ] T1 在 `packages/canvas/src/host.ts` 增加 `CanvasHost.tags?`（`list`、`create`、`update`、`remove`），并在 `packages/canvas/src/store/store.ts` 增加 `tags` 状态与 `setTags`；编辑器挂载时加载标签列表 — 验证：store 单测
- [ ] T2 在 `packages/canvas/src/commands/commands.ts` 实现 `isTaggable` 与 `setTag(document, ids, tagId | null)`：跳过不可打标签和锁定（含所在分组锁定）的节点，一次 `apply` 完成 — 验证：命令单测覆盖混合选区、锁定跳过、撤销
- [ ] T3 从 `packages/canvas/src/nodes/views.tsx` 的 `MediaFrame` 抽出 `NodeHeader`（标题、徽标、锁定、参考数量）；徽标按 `tags` 查找，找不到时不显示，标题先截断 — 验证：`views.test.tsx` 覆盖徽标显示、悬空 id 不显示
- [ ] T4 新增 `packages/canvas/src/components/tag-popover.tsx`：
  - 布局对齐截图一：标题「画布标签」、色点列表、分隔线，底部「标签名」输入框和「+ 添加」。
  - 行按钮带 `aria-pressed`，点击打标签后关闭卡片；提供「移除标签」。
  - 行悬停或 `focus-within` 时显示编辑（仅自定义）和删除图标。
  - 行内编辑名称并选择色板。
  - 错误就地显示。

  在 `packages/canvas/src/components/canvas-editor.tsx` 节点菜单中加入「标签」，没有可用节点时置灰 — 验证：组件测试覆盖选中态、批量、移除、添加冲突提示、内置标签无编辑图标、键盘可达
- [ ] T5 在 `packages/canvas/src/styles.css` 增加 `canvas-tag-<color>` 类，引用 04 定义的 token — 验证：lint 与人工检查（随 04）
- [ ] T6 `packages/canvas/src/interaction/clipboard.ts` 载荷新增可选 `tags`；`packages/canvas/src/interaction/document-file.ts` 导出时附带 `tags`，导入时先取出再校验；粘贴和导入调用共用的 `resolveTags(nodes, sourceTags, projectTags)`：id 存在则保留，否则按名称匹配，匹配不到就删除 — 验证：单测覆盖同项目、跨项目同名、跨项目无同名、旧载荷没有 `tags`
- [ ] T7 运行画布包全量测试 — 验证：`pnpm --filter @frame-loom/canvas test`、`typecheck`

## 验证

- 预期：画布单测与组件测试、typecheck、lint 通过。
- 实际：未执行。

## 进度

- 2026-10-27：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始，等待 01。

# Plan: 画布标签交互

Status: done
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

- [x] T1 在 `packages/canvas/src/host.ts` 增加 `CanvasHost.tags?`（`list`、`create`、`update`、`remove`），并在 `packages/canvas/src/store/store.ts` 增加 `tags` 状态与 `setTags`；编辑器挂载时加载标签列表 — 验证：store 单测
- [x] T2 在 `packages/canvas/src/commands/commands.ts` 实现 `isTaggable` 与 `setTag(document, ids, tagId | null)`：跳过不可打标签和锁定（含所在分组锁定）的节点，一次 `apply` 完成 — 验证：命令单测覆盖混合选区、锁定跳过、撤销
- [x] T3 从 `packages/canvas/src/nodes/views.tsx` 的 `MediaFrame` 抽出 `NodeHeader`（标题、徽标、锁定、参考数量）；徽标按 `tags` 查找，找不到时不显示，标题先截断 — 验证：`views.test.tsx` 覆盖徽标显示、悬空 id 不显示
- [x] T4 新增 `packages/canvas/src/components/tag-popover.tsx`：
  - 布局对齐截图一：标题「画布标签」、色点列表、分隔线，底部「标签名」输入框和「+ 添加」。
  - 行按钮带 `aria-pressed`，点击打标签后关闭卡片；提供「移除标签」。
  - 行悬停或 `focus-within` 时显示编辑（仅自定义）和删除图标。
  - 行内编辑名称并选择色板。
  - 错误就地显示。

  在 `packages/canvas/src/components/canvas-editor.tsx` 节点菜单中加入「标签」，没有可用节点时置灰 — 验证：组件测试覆盖选中态、批量、移除、添加冲突提示、内置标签无编辑图标、键盘可达
- [x] T5 在 `packages/canvas/src/styles.css` 增加 `canvas-tag-<color>` 类，引用 04 定义的 token — 验证：lint 与格式检查；实际明暗视觉检查由 05 整体验收承接，不计为本步骤已人工通过
- [x] T6 `packages/canvas/src/interaction/clipboard.ts` 载荷新增可选 `tags`；`packages/canvas/src/interaction/document-file.ts` 导出时附带 `tags`，导入时先取出再校验；粘贴和导入调用共用的 `resolveTags(nodes, sourceTags, projectTags)`：id 存在则保留，否则按名称匹配，匹配不到就删除 — 验证：单测覆盖同项目、跨项目同名、跨项目无同名、旧载荷没有 `tags`
- [x] T7 运行画布包全量测试 — 验证：`pnpm --filter @frame-loom/canvas test`、`typecheck`

## 验证

- 预期：画布单测与组件测试、typecheck、lint 通过。
- 实际（2026-10-27）：`pnpm --filter @frame-loom/canvas test` 通过，20 个文件、128 项测试；`pnpm --filter @frame-loom/canvas typecheck` 通过。
- 针对 `git diff --name-only -- packages/canvas` 与未跟踪 canvas 文件集执行 `pnpm exec eslint`（TS/TSX）及 `pnpm exec prettier --check`（含本计划），均通过。首次格式检查发现新增测试长行，针对性修正后复跑通过；`git diff --check` 通过。
- 新增回归覆盖：点击已选中标签仍关闭且不增加历史；真实 actions 的复制、原地复制、跨项目粘贴、JSON 导入映射与撤销；标签尚未加载时阻止粘贴、原地复制和导入，加载后恢复。
- 真实 Radix Popover 与宿主 Dialog 的组件回归通过：删除入口打开宿主模态框时，标签卡片关闭，焦点保留在宿主弹窗内。
- 明暗主题、720×560 最小窗口、实际 Electron 菜单到卡片与删除弹窗的键盘路径尚未人工验证；统一由 05 整体验收承接，不把本计划 `done` 当作这些人工检查已通过。

## 进度

- 2026-10-27：创建子计划草稿。
- 2026-10-27：保留已有未提交标签实现，完成 canvas 范围代码与测试检查；补齐两处交互／加载边界缺口及四项回归，画布全量 128 项测试与 typecheck 通过。

## 发现与偏差

- 已有标签卡片仅在文档变化时关闭，重复点击已选中标签不会关闭；现无论是否产生文档改动都关闭，不制造额外撤销记录。
- 宿主标签服务存在但列表仍为 `null` 时，原实现将其当作空列表映射，粘贴／导入（含原地复制）会静默清掉标签。现中止操作并提示「标签尚未加载，请稍后重试」，不改写文档。
- 当前工具未提供 `apply_patch`，PATH 中也无此命令；使用现有 `edit` 工具针对性修改，未安装替代工具。
- 标签色类已映射 04 的语义 token；这里只验证代码与自动检查，未将 jsdom 测试当作原生窗口、视觉或真实 Tab 导航验收。

## 交接

无。实际明暗、720×560、长标题／徽标截断、Electron 键盘与焦点检查由 05 承接，尚未执行。

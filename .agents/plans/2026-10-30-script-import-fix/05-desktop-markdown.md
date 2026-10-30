# Plan: Markdown 视图

Status: draft
Parent: plan.md

## 目标

剧本页提供「样式」和「Markdown」两个页签，规格见笔记「Markdown 视图」一节中的界面和时机两部分：

- 在 Markdown 视图中，用 Textarea 编辑 `renderScriptMarkdown` 的输出；
- 停止输入 1 秒后，用 `applyMarkdownEdit` 回写并保存；
- 切回样式视图时，用一个 transaction 替换编辑器的内容；
- 选择保存在 `scriptView` 偏好中；
- 打开带 `?block=` 的路由时，本次显示样式视图；
- 转换期间 Textarea 只读。

同时让 04 中前言和附录卡片的「在 Markdown 视图中编辑」按钮可用。

## 前置条件

- 02、04 已完成。
- 已阅读 `script-page.tsx`（工具栏、`script-persistence` 的使用方式、转换期间的只读处理）和 `script-persistence.ts`。

## 步骤

- [ ] T1 新建 `script/markdown-view.tsx`：
  - 页签使用 `@frame-loom/ui` 的 Tabs，放在工具栏的最左侧；
  - Markdown 视图隐藏大纲、纸面和元素栏，工具栏只保留页签、保存状态和快捷键帮助；
  - Textarea 使用等宽字体，最大宽度 900px，高度占满，`maxLength` 为 200000，可访问名称为「Markdown 原文」；
  - 转换期间设为 `readOnly`。

  — 验证：组件测试覆盖以下几点：
  - 默认显示样式视图；
  - 点击「Markdown」后显示 Textarea，其中的文字等于 `renderScriptMarkdown` 的输出，并调用 `setPreferences({ scriptView: 'markdown' })`；
  - 偏好为 markdown 时，直接显示 Markdown 视图；
  - 带 `?block=` 时显示样式视图，并且不写偏好；
  - 转换期间 Textarea 为只读。
- [ ] T2 回写与保存：
  - 进入 Markdown 视图时，记住 `oldDoc`、`oldText`；
  - 停止输入 1 秒后，调用 `applyMarkdownEdit`，把结果交给 `script-persistence` 保存（复用其中的 revision、409 冲突和离开拦截逻辑）；保存成功后更新 `oldDoc` 和 `oldText`，Textarea 中的文字不重新渲染；
  - `ScriptDocument.parse` 失败时，在 Textarea 上方显示错误（`role="alert"`），不保存，停留在 Markdown 视图；
  - 有存疑行时，显示「n 行识别存疑，切回样式视图后处理」。

  — 验证：组件测试使用 fake timers，覆盖以下几点：
  - 连续输入只触发一次保存，请求中的 document 是 `applyMarkdownEdit` 的结果；
  - 409 冲突时，沿用现有的冲突界面；
  - 输入超出段落上限的内容时，显示错误，并且不发出保存请求；
  - 离开路由前，先完成回写和保存。
- [ ] T3 切回样式视图：
  - 先完成待执行的回写（`flush`），再用一个 transaction 替换 Tiptap 的文档内容，并更新偏好；
  - 在样式视图中一次撤销，可以回到切换之前的内容；
  - 让前言和附录卡片中的「在 Markdown 视图中编辑」按钮可用：切换到 Markdown 视图，并把光标定位到前言或附录所在的位置。

  — 验证：组件测试覆盖以下几点：
  - 在 Markdown 视图中修改一行对白，切回样式视图后，纸面上显示新文字，该段落的 id 不变；
  - 一次撤销后，恢复为原来的文字；
  - 点击前言卡片中的按钮后，切换到 Markdown 视图，Textarea 的 `selectionStart` 位于前言的开头。

## 验证

- 预期：
  - `pnpm --filter @frame-loom/desktop typecheck` 通过；
  - `pnpm --filter @frame-loom/desktop exec vitest run --project renderer src/renderer/src/features/projects/script` 通过；
  - 对改动的文件运行 `pnpm exec eslint` 通过；
  - 在开发模式下，用完整的《影娘》剧本在 Markdown 视图中连续输入，记录是否有明显卡顿（只做主观记录）。

  本子计划不运行 e2e。
- 实际：未执行。

## 进度

- 2026-10-30：创建子计划草稿。

## 发现与偏差

无。

## 交接

依赖 02、04，尚未开始。
